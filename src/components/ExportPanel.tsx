import { useState } from "react";
import { motion } from "framer-motion";
import toast from "react-hot-toast";
import { AudioLines, Download, Loader2, Trash2, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaPlayer } from "@/components/MediaPlayer";
import { Switch } from "@/components/Switch";
import { useFFmpeg } from "@/hooks/useFFmpeg";
import { useClipStore } from "@/stores/useClipStore";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { makeGapSegment, trimSegment } from "@/lib/ffmpeg/trim";
import { concatClips, readAndCleanup } from "@/lib/ffmpeg/concat";
import { mixAudioLayers } from "@/lib/ffmpeg/mix";
import { smoothJoins } from "@/lib/ffmpeg/smooth";
import { useRangeStore } from "@/stores/useRangeStore";
import { formatTime } from "@/lib/formatTime";
import { computeEdl, isLayerActive, measuredTimeline, projectEnd, sliceEdl, sliceLayers } from "@/lib/timeline";
import type { OutputFormat } from "@/types/project";

type AudioFormat = "mp3" | "wav";
type ExportAs = "video" | "audio";
type Scope = "range" | "project";

const LARGE_LAYER_BYTES = 500 * 1024 * 1024;

function baseName(filename: string): string {
  return filename.replace(/\.[^./]+$/, "");
}

/** hh.mm.ss — colons aren't allowed in file names on every OS. */
function fileTime(t: number): string {
  return formatTime(t).slice(0, 8).replace(/:/g, ".");
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
  const allLayers = useAudioLayerStore((s) => s.layers);
  const mainVolume = useAudioLayerStore((s) => s.mainVolume);
  const markedRange = useRangeStore((s) => s.range);
  const { ffmpeg, loaded, loading, progress, error: loadError } = useFFmpeg();
  const [scope, setScope] = useState<Scope>("range");
  const [skipLeadingGap, setSkipLeadingGap] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [exportAs, setExportAs] = useState<ExportAs>("video");
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("mp3");

  if (clips.length === 0 && allLayers.length === 0) return null;

  // With no video clips at all (e.g. everything was converted to audio) the
  // project is audio-only: a silent base of the project's length + the layers.
  const projectType = clips[0]?.type ?? "audio";
  const dropVideo = projectType === "video" && exportAs === "audio";
  const outputFormat: OutputFormat = projectType === "video" && exportAs === "video" ? "mp4" : audioFormat;
  const fullEnd = projectEnd(clips, allLayers);
  const fullSegments = computeEdl(clips, fullEnd);

  // A marked In/Out range exports just that stretch of the project — the way
  // to pull ten minutes out of a seven-hour recording without deleting the
  // rest. The EDL and the layers are sliced and re-based so the range starts at 0.
  // Empty timeline before the first clip or layer — typically a clip whose
  // head was trimmed in place — would export as dead silence. Skip it unless
  // the user asks for it (a marked range is explicit and always honoured).
  const contentStart = Math.min(
    fullEnd,
    ...clips.map((c) => c.startAt),
    ...allLayers.filter((l) => isLayerActive(l, fullEnd)).map((l) => l.startAt)
  );
  const leadingGap = contentStart > 0.01 ? contentStart : 0;
  const markedScope = markedRange && scope === "range";
  const range = markedScope
    ? { start: Math.min(markedRange.start, fullEnd), end: Math.min(markedRange.end, fullEnd) }
    : leadingGap > 0 && skipLeadingGap
      ? { start: leadingGap, end: fullEnd }
      : null;
  const usingRange = !!range && range.end - range.start > 0.01;
  const end = usingRange ? range!.end - range!.start : fullEnd;
  const segments = usingRange ? sliceEdl(fullSegments, range!.start, range!.end) : fullSegments;
  const layers = usingRange ? sliceLayers(allLayers, range!.start, range!.end, fullEnd) : allLayers;
  const gapCount = segments.filter((s) => !s.clipId).length;
  const joinCount = segments.filter((s, i) => i > 0 && s.clipId && segments[i - 1].clipId).length;
  const smoothing = joinCrossfade > 0 && joinCount > 0;
  const activeLayerCount = layers.filter((l) => isLayerActive(l, end)).length;
  const needsMix = activeLayerCount > 0 || dropVideo || mainVolume !== 1;
  const extensions = new Set(clips.map((c) => c.file.name.split(".").pop()?.toLowerCase()));
  const formatMismatch = extensions.size > 1 || gapCount > 0;
  const layerBytes = layers.reduce((sum, l) => sum + l.file.size, 0);
  const exportFilename = `${baseName(clips[0]?.file.name ?? allLayers[0]?.name ?? "doxatrim")} ${
    markedScope && usingRange ? `(${fileTime(range!.start)}-${fileTime(range!.end)})` : "(edited)"
  }.${outputFormat}`;

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

      {markedRange && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex rounded-lg border border-border p-1">
            <button
              type="button"
              onClick={() => setScope("range")}
              className={cn(
                "rounded-md px-3 py-1 font-semibold transition-colors",
                scope === "range" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Range · {formatTime(markedRange.start).slice(0, 8)} – {formatTime(markedRange.end).slice(0, 8)}
            </button>
            <button
              type="button"
              onClick={() => setScope("project")}
              className={cn(
                "rounded-md px-3 py-1 font-semibold transition-colors",
                scope === "project" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Whole project · {formatTime(fullEnd).slice(0, 8)}
            </button>
          </div>
          <span className="text-muted-foreground">Set the range on the timeline with I / O or “= selection”.</span>
        </div>
      )}

      {leadingGap > 0 && !markedScope && (
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={skipLeadingGap} onChange={setSkipLeadingGap} label="Skip empty timeline before the first clip" />
          <span>
            Skip the {formatTime(leadingGap).slice(0, 8)} of empty timeline before the first clip
            {skipLeadingGap ? " — the export starts where the sound starts." : " — off: the export begins with that much silence."}
          </span>
        </label>
      )}

      <p className="text-xs text-muted-foreground">
        {markedScope && usingRange ? `Renders ${formatTime(end).slice(0, 8)} of the project` : usingRange ? `Renders ${formatTime(end).slice(0, 8)}` : "Renders the whole timeline"} — {segments.filter((s) => s.clipId).length} clip piece
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
