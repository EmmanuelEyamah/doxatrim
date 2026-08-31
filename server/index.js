import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import cors from "cors";

// Internal DOXA tool — local dev server. Requires `yt-dlp` installed on the
// host (brew install yt-dlp / pip install yt-dlp). Not hardened for public
// deployment: no auth, permissive CORS, no rate limiting. Import is gated in
// the UI behind a rights-ownership checkbox — this endpoint trusts that gate,
// it does not itself verify content ownership.

const PORT = process.env.PORT || 4321;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB, matches v1's stated large-file ceiling
// yt-dlp now runs a JS-challenge-solving step against YouTube's bot detection
// before it can even start downloading, on top of the download itself — 5
// minutes proved too tight for a real video and killed working downloads.
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes

const VIDEO_MIME = {
  mp4: "video/mp4",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
};

const app = express();
app.use(cors());
app.use(express.json());

app.post("/api/import-url", async (req, res) => {
  const { url } = req.body ?? {};

  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "A valid http(s) URL is required." });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "doxatrim-"));

  try {
    await runYtDlp(url, workDir);

    const files = await readdir(workDir);
    const outputFile = files[0];
    if (!outputFile) {
      throw new Error("Download completed but produced no file.");
    }

    const filePath = path.join(workDir, outputFile);
    const { size } = await stat(filePath);
    if (size > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `Downloaded file is ${(size / 1e9).toFixed(2)}GB, over the ${MAX_DOWNLOAD_BYTES / 1e9}GB limit.`
      );
    }

    const ext = path.extname(outputFile).slice(1).toLowerCase();
    res.setHeader("Content-Type", VIDEO_MIME[ext] || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="import-${randomUUID()}.${ext}"`);
    res.setHeader("Content-Length", String(size));

    const stream = createReadStream(filePath);
    stream.pipe(res);
    stream.on("close", () => {
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    });
    stream.on("error", (err) => {
      console.error("Stream error:", err);
      rm(workDir, { recursive: true, force: true }).catch(() => {});
    });
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    console.error("Import failed:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Import failed." });
  }
});

function runYtDlp(url, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "yt-dlp",
      [
        "--no-playlist",
        "-f", "bv*+ba/b",
        "--merge-output-format", "mp4",
        "-o", "%(id)s.%(ext)s",
        url,
      ],
      { cwd }
    );

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Download timed out."));
    }, DOWNLOAD_TIMEOUT_MS);

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
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${code}: ${stderr.slice(-500)}`));
    });
  });
}

app.listen(PORT, () => {
  console.log(`DoxaTrim import server listening on http://localhost:${PORT}`);
});
