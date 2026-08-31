import { useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { Download, Loader2, Trash2 } from "lucide-react";
import { MediaPlayer } from "@/components/MediaPlayer";
import { useFFmpeg } from "@/hooks/useFFmpeg";
import { useClipStore } from "@/stores/useClipStore";
import { trimClip } from "@/lib/ffmpeg/trim";
import { concatClips, readAndCleanup } from "@/lib/ffmpeg/concat";
import { mixBackgroundAudio } from "@/lib/ffmpeg/mix";
import { useBackgroundAudioStore } from "@/stores/useBackgroundAudioStore";
import type { OutputFormat } from "@/types/project";

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/memory|oom|out of memory|aborted/i.test(message)) {
    return "Ran out of memory processing this file. Try a smaller file or fewer clips — large exports can exceed what the browser tab can handle.";
  }
  return message;
}

export const ExportPanel = () => {
  const clips = useClipStore((s) => s.clips);
  const backgroundAudio = useBackgroundAudioStore();
  const { ffmpeg, loaded, loading, progress, error: loadError } = useFFmpeg();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [audioFormat, setAudioFormat] = useState<"mp3" | "wav">("mp3");

  if (clips.length === 0) return null;

  const projectType = clips[0].type;
  const outputFormat: OutputFormat = projectType === "audio" ? audioFormat : "mp4";
  const extensions = new Set(clips.map((c) => c.file.name.split(".").pop()?.toLowerCase()));
  const formatMismatch = extensions.size > 1;

  const clearOutput = () => {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null);
    setExportError(null);
  };

  const handleExport = async () => {
    if (!ffmpeg) return;
    setExporting(true);
    setExportError(null);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null);

    try {
      const segments: string[] = [];
      for (let i = 0; i < clips.length; i++) {
        segments.push(await trimClip(ffmpeg, clips[i], i));
      }
      let outputName = await concatClips(ffmpeg, segments, outputFormat);

      if (backgroundAudio.file) {
        const mainDuration = clips.reduce((sum, c) => sum + (c.outPoint - c.inPoint), 0);
        outputName = await mixBackgroundAudio(ffmpeg, {
          mainInputName: outputName,
          backgroundFile: backgroundAudio.file,
          bgInPoint: backgroundAudio.inPoint,
          bgOutPoint: backgroundAudio.outPoint,
          mainVolume: backgroundAudio.mainVolume,
          bgVolume: backgroundAudio.volume,
          mainDuration,
          outputFormat,
        });
      }

      const data = await readAndCleanup(ffmpeg, outputName);
      const mime =
        outputFormat === "mp4" ? "video/mp4" : outputFormat === "wav" ? "audio/wav" : "audio/mpeg";
      setOutputUrl(URL.createObjectURL(new Blob([data], { type: mime })));
    } catch (err) {
      const message = describeError(err);
      setExportError(message);
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Export</p>
        {projectType === "audio" && (
          <select
            value={audioFormat}
            onChange={(e) => setAudioFormat(e.target.value as "mp3" | "wav")}
            className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="mp3">mp3</option>
            <option value="wav">wav</option>
          </select>
        )}
      </div>

      {formatMismatch && (
        <p className="text-xs text-warning">
          Clips have different file types — export will re-encode to match, which is slower.
        </p>
      )}

      {loadError && (
        <p className="text-xs text-destructive">ffmpeg failed to load: {loadError}</p>
      )}

      <button
        type="button"
        disabled={!loaded || exporting}
        onClick={handleExport}
        className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {exporting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Exporting… {Math.round(progress * 100)}%
          </>
        ) : loading ? (
          "Loading ffmpeg…"
        ) : (
          "Export"
        )}
      </button>

      {exportError && <p className="text-xs text-destructive">{exportError}</p>}

      {outputUrl && (
        <div className="flex flex-col items-center gap-2 border-t border-border pt-3">
          <MediaPlayer
            src={outputUrl}
            type={outputFormat === "mp4" ? "video" : "audio"}
            className="w-full border-0 bg-transparent p-0"
          />
          <div className="flex items-center gap-2">
            <a
              href={outputUrl}
              download={`doxatrim-export.${outputFormat}`}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold"
            >
              <Download size={16} /> Download
            </a>
            <button
              type="button"
              onClick={clearOutput}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-destructive"
            >
              <Trash2 size={16} /> Remove
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};
