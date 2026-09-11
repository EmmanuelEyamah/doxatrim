import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import cors from "cors";
import { vttToTranscript } from "./vtt.js";

// Internal DOXA tool — local dev server. Requires `yt-dlp` installed on the
// host (brew install yt-dlp / pip install yt-dlp). Not hardened for public
// deployment: no auth, permissive CORS, no rate limiting. Import is gated in
// the UI behind a rights-ownership checkbox — this endpoint trusts that gate,
// it does not itself verify content ownership.

const PORT = process.env.PORT || 4321;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, matches v1's stated large-file ceiling
// A flat timeout killed slow-but-still-progressing downloads (e.g. a real
// hour-long video). Instead: kill only if there's been no progress at all
// for STALL_TIMEOUT_MS, with an absolute ceiling as a last-resort safety net.
const STALL_TIMEOUT_MS = 4 * 60 * 1000; // no progress update for 4 minutes = genuinely stuck
const ABSOLUTE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour hard ceiling regardless of progress
const PLAYLIST_INFO_TIMEOUT_MS = 60 * 1000; // metadata only, no download — should be fast
const MAX_PLAYLIST_ENTRIES = 200; // guard against pasting a 5000-video channel dump
const TRANSCRIPT_TIMEOUT_MS = 60 * 1000; // captions only, no video download — should be fast
const JOB_TTL_MS = 60 * 60 * 1000; // sweep finished/errored jobs after an hour

/** @type {Map<string, ImportJob>} */
const importJobs = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, job] of importJobs) {
    if (job.status !== "downloading" && now - job.updatedAt > JOB_TTL_MS) {
      rm(job.workDir, { recursive: true, force: true }).catch(() => {});
      importJobs.delete(id);
    }
  }
}, 10 * 60 * 1000).unref();

const VIDEO_MIME = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
};

/** RFC 5987-safe Content-Disposition header value for a real (non-ASCII-safe) filename. */
function contentDisposition(filename) {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

const app = express();
app.use(cors());
app.use(express.json());

// Job-based instead of one long blocking request: a request that just waits
// for a full hour-long download gives the client nothing to show (no percent,
// no way to tell "slow" from "stuck") and forces an arbitrary flat timeout.
// This lets the client poll for live progress and only fetch bytes once done.
app.post("/api/import-jobs", async (req, res) => {
  const { url, mediaType } = req.body ?? {};

  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "A valid http(s) URL is required." });
  }
  const wantAudioOnly = mediaType === "audio";

  const id = randomUUID();
  const workDir = await mkdtemp(path.join(tmpdir(), "doxatrim-"));
  const job = {
    id,
    status: "downloading",
    percent: 0,
    speed: null,
    eta: null,
    error: null,
    workDir,
    filePath: null,
    filename: null,
    updatedAt: Date.now(),
  };
  importJobs.set(id, job);

  runYtDlp(url, workDir, wantAudioOnly, (progress) => {
    Object.assign(job, progress, { updatedAt: Date.now() });
  })
    .then(async () => {
      const files = await readdir(workDir);
      const outputFile = files[0];
      if (!outputFile) throw new Error("Download completed but produced no file.");

      const filePath = path.join(workDir, outputFile);
      const { size } = await stat(filePath);
      if (size > MAX_DOWNLOAD_BYTES) {
        throw new Error(
          `Downloaded file is ${(size / 1e9).toFixed(2)}GB, over the ${MAX_DOWNLOAD_BYTES / 1e9}GB limit.`
        );
      }

      job.status = "done";
      job.percent = 100;
      job.filePath = filePath;
      job.filename = outputFile; // yt-dlp already named this from the video's real title
      job.updatedAt = Date.now();
    })
    .catch(async (err) => {
      console.error("Import failed:", err);
      job.status = "error";
      job.error = err instanceof Error ? err.message : "Import failed.";
      job.updatedAt = Date.now();
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    });

  res.status(202).json({ jobId: id });
});

app.get("/api/import-jobs/:id", (req, res) => {
  const job = importJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Unknown job." });
  const { status, percent, speed, eta, error } = job;
  res.json({ status, percent, speed, eta, error });
});

app.get("/api/import-jobs/:id/file", async (req, res) => {
  const job = importJobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: "Unknown job." });
  if (job.status !== "done" || !job.filePath) {
    return res.status(409).json({ error: "Job is not finished yet." });
  }

  const ext = path.extname(job.filePath).slice(1).toLowerCase();
  const { size } = await stat(job.filePath);
  res.setHeader("Content-Type", VIDEO_MIME[ext] || "application/octet-stream");
  res.setHeader("Content-Disposition", contentDisposition(job.filename || `import-${randomUUID()}.${ext}`));
  // Lets the client show real transfer progress instead of going silent while
  // a large file (a 1080p hour-long video can be several hundred MB+) moves
  // from this server to the browser after the yt-dlp download itself is done.
  res.setHeader("Content-Length", String(size));
  // Content-Disposition isn't in the browser's default CORS-safelisted
  // response headers — without this, fetch()'s headers.get() silently
  // returns null for it cross-origin (curl doesn't enforce CORS at all,
  // which is why testing this with curl looked fine while the real browser
  // fell back to the generic filename every time).
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");

  const stream = createReadStream(job.filePath);
  stream.pipe(res);
  const cleanup = () => {
    rm(job.workDir, { recursive: true, force: true }).catch(() => {});
    importJobs.delete(job.id);
  };
  stream.on("close", cleanup);
  stream.on("error", (err) => {
    console.error("Stream error:", err);
    cleanup();
  });
});

app.post("/api/playlist-info", async (req, res) => {
  const { url } = req.body ?? {};

  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "A valid http(s) URL is required." });
  }

  try {
    const raw = await runYtDlpJson(url);
    const rawEntries = Array.isArray(raw.entries) ? raw.entries : [raw];
    const truncated = rawEntries.length > MAX_PLAYLIST_ENTRIES;
    const entries = rawEntries.slice(0, MAX_PLAYLIST_ENTRIES).map((e) => ({
      id: e.id,
      title: e.title || e.id,
      duration: typeof e.duration === "number" ? e.duration : null,
      url: e.url || e.webpage_url || null,
    })).filter((e) => e.url);

    res.json({
      isPlaylist: Array.isArray(raw.entries),
      playlistTitle: raw.title || null,
      entries,
      truncated,
    });
  } catch (err) {
    console.error("Playlist info failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to read URL." });
  }
});

app.post("/api/transcript", async (req, res) => {
  const { url } = req.body ?? {};

  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "A valid http(s) URL is required." });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "doxatrim-sub-"));

  try {
    await runYtDlpSubs(url, workDir);

    const files = await readdir(workDir);
    // Prefer an uploaded/official transcript over an auto-generated one if both exist.
    const vttFile =
      files.find((f) => f.endsWith(".vtt") && !f.includes("-orig")) ||
      files.find((f) => f.endsWith(".vtt"));

    if (!vttFile) {
      return res.status(404).json({ error: "No captions available for this video." });
    }

    const raw = await readFile(path.join(workDir, vttFile), "utf8");
    const transcript = vttToTranscript(raw);
    res.json({ transcript });
  } catch (err) {
    console.error("Transcript fetch failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to fetch transcript." });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

function runYtDlpSubs(url, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "yt-dlp",
      [
        "--skip-download",
        "--write-auto-sub",
        "--write-sub",
        "--sub-langs", "en.*",
        "--sub-format", "vtt",
        "-o", "%(id)s.%(ext)s",
        url,
      ],
      { cwd }
    );

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out fetching captions."));
    }, TRANSCRIPT_TIMEOUT_MS);

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        reject(new Error("yt-dlp is not installed on this server (brew install yt-dlp)."));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      // yt-dlp exits non-zero when there are simply no captions for the
      // requested language — that's not a real error, just an empty result.
      if (code === 0 || /no subtitles/i.test(stderr)) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

function runYtDlpJson(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "yt-dlp",
      ["--flat-playlist", "-J", "--no-warnings", url],
      { stdio: ["ignore", "pipe", "pipe"] }
    );

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Timed out reading playlist/video info."));
    }, PLAYLIST_INFO_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (err.code === "ENOENT") {
        reject(new Error("yt-dlp is not installed on this server (brew install yt-dlp)."));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error("Could not parse yt-dlp output."));
      }
    });
  });
}

const PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/;
const SPEED_RE = /at\s+([\d.]+\s*[KMGT]?i?B\/s)/;
const ETA_RE = /ETA\s+(\S+)/;

function runYtDlp(url, cwd, audioOnly, onProgress) {
  return new Promise((resolve, reject) => {
    const args = audioOnly
      ? [
          "--no-playlist",
          // Audio-only skips the video stream entirely — smaller, much
          // faster, and this is literally all yt-dlp needs to fetch when the
          // destination is "save it as an mp3 on my phone", not a video file.
          "-f", "bestaudio/best",
          "-x", "--audio-format", "mp3",
          "--newline",
          "-o", "%(title).200B.%(ext)s",
          url,
        ]
      : [
          "--no-playlist",
          // Capped at 1080p — a lot of YouTube source is 4K/8K, and downloading
          // full quality for a trim tool was making imports painfully slow for
          // no real benefit (nobody's exporting 4K out of DoxaTrim v1 anyway).
          //
          // Codec matters as much as resolution: left to itself yt-dlp picks
          // the smallest 1080p stream, which on YouTube is AV1 + Opus. Not
          // every browser can decode AV1 (Safari needs recent hardware), and
          // a file the browser can't decode looked like an import that hung
          // at "transferring 100%". H.264 + AAC plays everywhere and is what
          // the mp4 export path stream-copies without surprises.
          "-f", "bv*+ba/b",
          "-S", "res:1080,vcodec:h264,acodec:m4a",
          "--merge-output-format", "mp4",
          "--newline", // one progress update per line, not carriage-return overwrites
          // Named from the real video title (yt-dlp sanitizes it for the
          // filesystem automatically), not the video ID — so what you save
          // to disk actually reads as the video, not "import-<uuid>".
          "-o", "%(title).200B.%(ext)s",
          url,
        ];

    const child = spawn("yt-dlp", args, { cwd });

    let stallTimer;
    const resetStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error("Download stalled — no progress for 4 minutes."));
      }, STALL_TIMEOUT_MS);
    };
    resetStallTimer();

    const absoluteTimer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Download exceeded the 1 hour hard limit."));
    }, ABSOLUTE_TIMEOUT_MS);

    let stderr = "";
    let stdoutTail = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdoutTail = (stdoutTail + text).slice(-2000);
      const progressMatch = PROGRESS_RE.exec(text);
      if (progressMatch) {
        resetStallTimer();
        onProgress({
          percent: Math.min(99, Math.round(parseFloat(progressMatch[1]))),
          speed: SPEED_RE.exec(text)?.[1] ?? null,
          eta: ETA_RE.exec(text)?.[1] ?? null,
        });
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(stallTimer);
      clearTimeout(absoluteTimer);
      if (err.code === "ENOENT") {
        reject(new Error("yt-dlp is not installed on this server (brew install yt-dlp)."));
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => {
      clearTimeout(stallTimer);
      clearTimeout(absoluteTimer);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}: ${(stderr || stdoutTail).slice(-500)}`));
    });
  });
}

app.listen(PORT, () => {
  console.log(`DoxaTrim import server listening on http://localhost:${PORT}`);
});
