import { useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { AudioLines, Download, Loader2, Trash2, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaPlayer } from "@/components/MediaPlayer";
import { useFFmpeg } from "@/hooks/useFFmpeg";
import { useClipStore } from "@/stores/useClipStore";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { makeGapSegment, trimSegment } from "@/lib/ffmpeg/trim";
import { concatClips, readAndCleanup } from "@/lib/ffmpeg/concat";
import { mixAudioLayers } from "@/lib/ffmpeg/mix";
import { smoothJoins } from "@/lib/ffmpeg/smooth";
import { computeEdl, isLayerActive, measuredTimeline, projectEnd } from "@/lib/timeline";
import type { OutputFormat } from "@/types/project";

type AudioFormat = "mp3" | "wav";
type ExportAs = "video" | "audio";

const LARGE_LAYER_BYTES = 500 * 1024 * 1024;

function baseName(filename: string): string {
  return filename.replace(/\.[^./]+$/, "");
}

function describeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/memory|oom|out of memory|aborted/i.test(message)) {
    return "Ran out of memory processing this file. Try a smaller file or fewer layers — large exports can exceed what the browser tab can handle.";
  }
  return message;
}

export const ExportPanel = () => {
  const clips = useClipStore((s) => s.clips);
  const joinCrossfade = useClipStore((s) => s.joinCrossfade);
  const layers = useAudioLayerStore((s) => s.layers);
  const mainVolume = useAudioLayerStore((s) => s.mainVolume);
  const { ffmpeg, loaded, loading, progress, error: loadError } = useFFmpeg();
  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [exportAs, setExportAs] = useState<ExportAs>("video");
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");

  if (clips.length === 0 && layers.length === 0) return null;

  // With no video clips at all (e.g. everything was converted to audio) the
  // project is audio-only: a silent base of the project's length + the layers.
  const projectType = clips[0]?.type ?? "audio";
  const dropVideo = projectType === "video" && exportAs === "audio";
  const outputFormat: OutputFormat = projectType === "video" && exportAs === "video" ? "mp4" : audioFormat;
  const end = projectEnd(clips, layers);
  const segments = computeEdl(clips, end);
  const gapCount = segments.filter((s) => !s.clipId).length;
  const joinCount = segments.filter((s, i) => i > 0 && s.clipId && segments[i - 1].clipId).length;
  const smoothing = joinCrossfade > 0 && joinCount > 0;
  const activeLayerCount = layers.filter((l) => isLayerActive(l, end)).length;
  const needsMix = activeLayerCount > 0 || dropVideo || mainVolume !== 1;
  const extensions = new Set(clips.map((c) => c.file.name.split(".").pop()?.toLowerCase()));
  const formatMismatch = extensions.size > 1 || gapCount > 0;
  const layerBytes = layers.reduce((sum, l) => sum + l.file.size, 0);
  const exportFilename = `${baseName(clips[0]?.file.name ?? layers[0]?.name ?? "doxatrim")} (edited).${outputFormat}`;

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
      // The concat container follows the source type; the mix stage handles
      // dropping video when exporting a video project as audio.
      const concatFormat: OutputFormat = projectType === "video" ? "mp4" : audioFormat;
      const sized = clips.find((c) => c.width && c.height);
      const dims = { width: sized?.width ?? 1280, height: sized?.height ?? 720 };

      const names: string[] = [];
      const measured: number[] = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        setStage(`Cutting ${i + 1}/${segments.length}`);
        const len = seg.end - seg.start;
        const clip = seg.clipId ? clips.find((c) => c.id === seg.clipId) : undefined;
        const piece = clip
          ? await trimSegment(ffmpeg, clip.file, seg.srcIn, seg.srcIn + len, i)
          : await makeGapSegment(ffmpeg, i, { duration: len, format: concatFormat, ...dims });
        names.push(piece.name);
        measured.push(piece.duration);
      }

      setStage("Joining");
      let outputName = await concatClips(ffmpeg, names, concatFormat);

      if (smoothing) {
        setStage(`Smoothing ${joinCount} join${joinCount > 1 ? "s" : ""}`);
        outputName = await smoothJoins(ffmpeg, {
          segments,
          measured,
          clips,
          concatOutputName: outputName,
          crossfade: joinCrossfade,
          outputFormat: concatFormat,
          audioOnly: projectType === "audio",
        });
      }

      if (needsMix) {
        setStage(activeLayerCount > 0 ? `Mixing ${activeLayerCount} layer${activeLayerCount > 1 ? "s" : ""}` : "Finishing");
        // Segment cuts are keyframe-snapped (video is never re-encoded), so the
        // exported sequence can run a little longer than the on-screen timeline.
        // Place layers against the measured export timeline, not the ideal one.
        const { actualEnd, toActual } = measuredTimeline(segments, measured);
        const placedLayers = layers.map((l) => ({
          ...l,
          startAt: toActual(l.startAt),
          endAt: l.endAt == null ? null : toActual(l.endAt),
        }));
        outputName = await mixAudioLayers(ffmpeg, {
          mainInputName: outputName,
          layers: placedLayers,
          mainVolume,
          timelineEnd: actualEnd,
          outputFormat,
          dropVideo,
        });
      }

      const data = await readAndCleanup(ffmpeg, outputName);
      const mime = outputFormat === "mp4" ? "video/mp4" : outputFormat === "wav" ? "audio/wav" : "audio/mpeg";
      setOutputUrl(URL.createObjectURL(new Blob([data], { type: mime })));
    } catch (err) {
      const message = describeError(err);
      setExportError(message);
      toast.error(message);
    } finally {
      setExporting(false);
      setStage(null);
    }
  };

  const showAudioFormat = projectType === "audio" || exportAs === "audio";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold">Export</p>
        <div className="flex items-center gap-2">
          {projectType === "video" && (
            <div className="flex rounded-lg border border-border p-1">
              <button
                type="button"
                onClick={() => setExportAs("video")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                  exportAs === "video" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Video size={14} /> Video
              </button>
              <button
                type="button"
                onClick={() => setExportAs("audio")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-colors",
                  exportAs === "audio" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <AudioLines size={14} /> Audio only
              </button>
            </div>
          )}
          {showAudioFormat && (
            <select
              value={audioFormat}
              onChange={(e) => setAudioFormat(e.target.value as AudioFormat)}
              className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="mp3">mp3</option>
              <option value="wav">wav</option>
            </select>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Renders the whole timeline — {segments.filter((s) => s.clipId).length} clip piece
        {segments.filter((s) => s.clipId).length === 1 ? "" : "s"}
        {gapCount > 0 ? `, ${gapCount} empty gap${gapCount > 1 ? "s" : ""} (black + silence)` : ""}
        {activeLayerCount > 0 ? `, ${activeLayerCount} audio layer${activeLayerCount > 1 ? "s" : ""} mixed in` : ""}
        {smoothing ? `, ${joinCount} join${joinCount > 1 ? "s" : ""} smoothed with a ${joinCrossfade.toFixed(1)}s audio crossfade` : ""}
        {dropVideo ? " — as audio only" : ""}. Video is copied as-is, never re-encoded.
      </p>

      {layerBytes > LARGE_LAYER_BYTES && (
        <p className="text-xs text-warning">
          Audio layers total {(layerBytes / 1e6).toFixed(0)} MB of source files — every layer is copied into the
          browser's ffmpeg memory during export, so very large sources can run out of memory. Audio-only files
          are much lighter.
        </p>
      )}

      {formatMismatch && (
        <p className="text-xs text-warning">
          {gapCount > 0 ? "Empty gaps or " : ""}Clips of different file types may need a re-encode to join — slower, but
          done at high quality.
        </p>
      )}

      {loadError && <p className="text-xs text-destructive">ffmpeg failed to load: {loadError}</p>}

      <button
        type="button"
        disabled={!loaded || exporting}
        onClick={handleExport}
        className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
      >
        {exporting ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {stage ?? "Exporting"}… {Math.round(progress * 100)}%
          </>
        ) : loading ? (
          "Loading ffmpeg…"
        ) : (
          `Export ${dropVideo ? "audio" : projectType}`
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
              download={exportFilename}
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
