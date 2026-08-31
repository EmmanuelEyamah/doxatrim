import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Link2, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { buildClipsFromFiles } from "@/lib/buildClips";
import { useClipStore } from "@/stores/useClipStore";

const IMPORT_SERVER_URL = "http://localhost:4321";

interface DownloadedSource {
  url: string;
  filename: string;
}

export const UrlImport = () => {
  const clips = useClipStore((s) => s.clips);
  const addClips = useClipStore((s) => s.addClips);
  const [url, setUrl] = useState("");
  const [ownsRights, setOwnsRights] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastDownload, setLastDownload] = useState<DownloadedSource | null>(null);

  const canImport = url.trim().length > 0 && ownsRights && !importing;

  const handleImport = async () => {
    if (!canImport) return;
    setImporting(true);
    try {
      const res = await fetch(`${IMPORT_SERVER_URL}/api/import-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Import failed (HTTP ${res.status})`);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = /filename="([^"]+)"/.exec(disposition);
      const filename = filenameMatch?.[1] || "imported-video.mp4";
      const file = new File([blob], filename, { type: blob.type || "video/mp4" });

      const { clips: newClips, rejected } = await buildClipsFromFiles([file], clips);
      for (const { reason } of rejected) toast.error(reason);
      if (newClips.length > 0) {
        addClips(newClips);
        setUrl("");
        setOwnsRights(false);
        toast.success("Imported from URL");

        // The downloaded file only lives in memory — a page refresh loses it
        // and re-importing means hitting YouTube again. Offer a real local
        // save so re-using this source (for more clips, later) is instant.
        if (lastDownload) URL.revokeObjectURL(lastDownload.url);
        setLastDownload({ url: URL.createObjectURL(blob), filename });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      toast.error(
        /fetch|networkerror/i.test(message)
          ? "Couldn't reach the import server — is it running? (cd server && npm run dev)"
          : message
      );
    } finally {
      setImporting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <p className="text-sm font-semibold">Import from URL</p>
      <div className="flex gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <button
          type="button"
          disabled={!canImport}
          onClick={handleImport}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {importing ? <Loader2 size={16} className="animate-spin" /> : <Link2 size={16} />}
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
        I own this content or have the rights to use it — DoxaTrim is an internal DOXA tool, not
        a public downloader.
      </label>

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
