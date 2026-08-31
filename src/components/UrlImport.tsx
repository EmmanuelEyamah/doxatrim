import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Link2, Loader2, ListVideo } from "lucide-react";
import toast from "react-hot-toast";
import { buildClipsFromFiles } from "@/lib/buildClips";
import { useClipStore } from "@/stores/useClipStore";
import type { TranscriptCue } from "@/types/clip";

const IMPORT_SERVER_URL = "http://localhost:4321";

interface DownloadedSource {
  url: string;
  filename: string;
}

interface PlaylistEntry {
  id: string;
  title: string;
  duration: number | null;
  url: string;
}

interface SelectableEntry extends PlaylistEntry {
  selected: boolean;
}

interface JobProgress {
  phase: "downloading" | "transferring";
  percent: number;
  speed: string | null;
  eta: string | null;
}

interface JobStatus {
  status: "downloading" | "done" | "error";
  percent: number;
  speed: string | null;
  eta: string | null;
  error: string | null;
}

/** Prefers the RFC 5987 UTF-8 filename (real title, accents/emoji intact) over the ASCII fallback. */
function parseFilename(disposition: string): string | null {
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      // fall through to the ASCII fallback below
    }
  }
  return /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const UrlImport = () => {
  const addClips = useClipStore((s) => s.addClips);
  const [url, setUrl] = useState("");
  const [ownsRights, setOwnsRights] = useState(false);
  const [checking, setChecking] = useState(false);
  const [entries, setEntries] = useState<SelectableEntry[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [lastDownload, setLastDownload] = useState<DownloadedSource | null>(null);

  const importing = progress !== null;
  const canCheck = url.trim().length > 0 && ownsRights && !checking && !importing;
  const selectedCount = entries.filter((e) => e.selected).length;

  const importSingleVideo = async (videoUrl: string): Promise<File> => {
    const startRes = await fetch(`${IMPORT_SERVER_URL}/api/import-jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl }),
    });
    if (!startRes.ok) {
      const body = await startRes.json().catch(() => null);
      throw new Error(body?.error || `Import failed (HTTP ${startRes.status})`);
    }
    const { jobId } = await startRes.json();

    // Poll for live progress instead of blocking silently on one long request.
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = await fetch(`${IMPORT_SERVER_URL}/api/import-jobs/${jobId}`);
      if (!statusRes.ok) throw new Error(`Lost track of the import job (HTTP ${statusRes.status})`);
      const job: JobStatus = await statusRes.json();

      if (job.status === "downloading") {
        setJobProgress({ phase: "downloading", percent: job.percent, speed: job.speed, eta: job.eta });
        continue;
      }
      if (job.status === "error") {
        throw new Error(job.error || "Import failed");
      }
      break; // done
    }

    // yt-dlp finishing doesn't mean the browser has the bytes yet — a
    // 1080p hour-long video can be several hundred MB+. Track the transfer
    // from this server to the browser too, instead of the UI going silent
    // right when it looks "almost done".
    setJobProgress({ phase: "transferring", percent: 0, speed: null, eta: null });
    const fileRes = await fetch(`${IMPORT_SERVER_URL}/api/import-jobs/${jobId}/file`);
    if (!fileRes.ok) {
      const body = await fileRes.json().catch(() => null);
      throw new Error(body?.error || `Failed to fetch the downloaded file (HTTP ${fileRes.status})`);
    }

    const disposition = fileRes.headers.get("Content-Disposition") || "";
    const filename = parseFilename(disposition) || "imported-video.mp4";
    const contentType = fileRes.headers.get("Content-Type") || "video/mp4";
    const totalBytes = Number(fileRes.headers.get("Content-Length")) || 0;
    const reader = fileRes.body?.getReader();

    if (!reader) {
      const blob = await fileRes.blob();
      return new File([blob], filename, { type: contentType });
    }

    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (totalBytes > 0) {
        setJobProgress({
          phase: "transferring",
          percent: Math.round((received / totalBytes) * 100),
          speed: null,
          eta: null,
        });
      }
    }
    return new File(chunks, filename, { type: contentType });
  };

  // Best-effort, non-blocking: captions are a bonus, not required for import
  // to succeed, and many videos simply don't have any.
  const fetchTranscriptInBackground = (clipId: string, videoUrl: string) => {
    fetch(`${IMPORT_SERVER_URL}/api/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: videoUrl }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { transcript: TranscriptCue[] } | null) => {
        if (data?.transcript?.length) {
          useClipStore.getState().setTranscript(clipId, data.transcript);
        }
      })
      .catch(() => {});
  };

  const importAndAdd = async (selected: PlaylistEntry[]) => {
    setProgress({ done: 0, total: selected.length });
    let successCount = 0;
    let lastFile: { blob: File } | null = null;

    for (const entry of selected) {
      try {
        const file = await importSingleVideo(entry.url);
        lastFile = { blob: file };
        // Re-read current clips each iteration so type-mixing validation sees
        // clips already added earlier in this same batch, not a stale list.
        const currentClips = useClipStore.getState().clips;
        const { clips: newClips, rejected } = await buildClipsFromFiles([file], currentClips);
        for (const { reason } of rejected) toast.error(`${entry.title}: ${reason}`);
        if (newClips.length > 0) {
          addClips(newClips);
          successCount++;
          fetchTranscriptInBackground(newClips[0].id, entry.url);
        }
      } catch (err) {
        toast.error(`${entry.title}: ${err instanceof Error ? err.message : "Import failed"}`);
      } finally {
        setJobProgress(null);
        setProgress((p) => (p ? { done: p.done + 1, total: p.total } : null));
      }
    }

    setProgress(null);
    setEntries([]);
    setUrl("");
    setOwnsRights(false);

    if (successCount > 0) {
      toast.success(`Imported ${successCount} video${successCount > 1 ? "s" : ""}`);
      // Only offer a "save to disk" shortcut for a single-video import — for a
      // batch, per-clip download (already on every ClipBlock) covers it.
      if (selected.length === 1 && lastFile) {
        if (lastDownload) URL.revokeObjectURL(lastDownload.url);
        setLastDownload({ url: URL.createObjectURL(lastFile.blob), filename: lastFile.blob.name });
      }
    }
  };

  const handleCheckUrl = async () => {
    if (!canCheck) return;
    setChecking(true);
    try {
      const res = await fetch(`${IMPORT_SERVER_URL}/api/playlist-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Couldn't read that URL (HTTP ${res.status})`);
      }
      const data: { entries: PlaylistEntry[]; truncated: boolean } = await res.json();
      if (data.entries.length === 0) {
        toast.error("No videos found at that URL.");
        return;
      }
      if (data.entries.length === 1) {
        await importAndAdd(data.entries);
        return;
      }
      setEntries(data.entries.map((e) => ({ ...e, selected: true })));
      if (data.truncated) toast(`Showing the first ${data.entries.length} videos in the playlist.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to read URL";
      toast.error(
        /fetch|networkerror/i.test(message)
          ? "Couldn't reach the import server — is it running? (cd server && npm run dev)"
          : message
      );
    } finally {
      setChecking(false);
    }
  };

  const toggleEntry = (id: string) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, selected: !e.selected } : e)));
  };

  const toggleAll = (selected: boolean) => {
    setEntries((prev) => prev.map((e) => ({ ...e, selected })));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <p className="text-sm font-semibold">Import from URL</p>

      {entries.length === 0 ? (
        <>
          <div className="flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Video or playlist URL — https://…"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              disabled={!canCheck}
              onClick={handleCheckUrl}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {checking || importing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Link2 size={16} />
              )}
              Import
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={ownsRights}
              onChange={(e) => setOwnsRights(e.target.checked)}
              className="accent-primary"
            />
            I own this content or have the rights to use it — DoxaTrim is an internal DOXA tool,
            not a public downloader.
          </label>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ListVideo size={14} /> {entries.length} videos found — {selectedCount} selected
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => toggleAll(true)} className="hover:text-foreground">
                Select all
              </button>
              <button type="button" onClick={() => toggleAll(false)} className="hover:text-foreground">
                Select none
              </button>
            </div>
          </div>

          <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
            {entries.map((entry) => (
              <label
                key={entry.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={entry.selected}
                  onChange={() => toggleEntry(entry.id)}
                  className="accent-primary"
                />
                <span className="flex-1 truncate">{entry.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatDuration(entry.duration)}
                </span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              disabled={selectedCount === 0 || importing}
              onClick={() => importAndAdd(entries.filter((e) => e.selected))}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
              Import {selectedCount} selected
            </button>
            <button
              type="button"
              disabled={importing}
              onClick={() => setEntries([])}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {importing && progress && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-muted-foreground">
            Importing {progress.done + 1}/{progress.total}
            {jobProgress &&
              ` — ${jobProgress.phase === "downloading" ? "downloading" : "transferring to browser"} ${jobProgress.percent}%`}
            {jobProgress?.speed && ` · ${jobProgress.speed}`}
            {jobProgress?.eta && ` · ETA ${jobProgress.eta}`}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${jobProgress?.percent ?? 0}%` }}
            />
          </div>
          {jobProgress?.phase === "downloading" && jobProgress.percent < 100 && (
            <p className="text-[11px] text-muted-foreground">
              Video and audio download as separate stages — the bar may reset partway through,
              that's normal.
            </p>
          )}
          {jobProgress?.phase === "transferring" && (
            <p className="text-[11px] text-muted-foreground">
              Download from the source finished — now moving the file to your browser.
            </p>
          )}
        </div>
      )}

      {lastDownload && (
        <a
          href={lastDownload.url}
          download={lastDownload.filename}
          className="flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <Download size={14} /> Save original to disk — reuse it later without re-downloading
        </a>
      )}
    </motion.div>
  );
};
