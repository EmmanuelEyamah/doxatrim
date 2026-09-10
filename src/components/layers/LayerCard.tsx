import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AudioLines, Repeat, Trash2, Video, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime, parseTime } from "@/lib/formatTime";
import { layerSpan } from "@/lib/timeline";
import { getClipType } from "@/lib/fileValidation";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { MediaPlayer } from "@/components/MediaPlayer";
import { TrimEditor } from "@/components/TrimEditor";
import { LANE_COLORS } from "@/components/timeline/LayerBlock";
import type { AudioLayer } from "@/types/audioLayer";

interface LayerCardProps {
  layer: AudioLayer;
  timelineEnd: number;
  /** Current project-timeline position, for "Start here" / "End here". */
  playheadTime?: number;
  className?: string;
}

export const LayerCard = ({ layer, timelineEnd: end, playheadTime, className }: LayerCardProps) => {
  const updateLayer = useAudioLayerStore((s) => s.updateLayer);
  const removeLayer = useAudioLayerStore((s) => s.removeLayer);
  const [src, setSrc] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  // Create and revoke in the same effect so a StrictMode re-run regenerates a
  // valid URL instead of leaving a revoked one on the element.
  useEffect(() => {
    const url = URL.createObjectURL(layer.file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [layer.file]);

  const span = layerSpan(layer, end);
  const segment = layer.outPoint - layer.inPoint;
  const repeats = layer.loop && segment > 0 ? Math.ceil(span / segment) : 1;
  const isVideoSource = getClipType(layer.file) === "video";

  const setStartAt = (value: number) => {
    updateLayer(layer.id, { startAt: Math.min(Math.max(0, value), Math.max(0, end - 0.05)) });
  };

  const setEndAt = (value: number | null) => {
    updateLayer(layer.id, {
      endAt: value == null ? null : Math.min(Math.max(value, layer.startAt + 0.05), end),
    });
  };

  const fieldClass = "w-24 rounded-lg border border-border bg-background px-2 py-1 text-sm";
  const chipClass =
    "rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card p-4",
        layer.muted && "opacity-60",
        className
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: LANE_COLORS[layer.colorIndex % LANE_COLORS.length] }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {isVideoSource ? (
            <Video size={16} className="shrink-0 text-muted-foreground" />
          ) : (
            <AudioLines size={16} className="shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{layer.name}</span>
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => updateLayer(layer.id, { muted: !layer.muted })}
            aria-label={layer.muted ? "Unmute layer" : "Mute layer"}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-full",
              layer.muted ? "text-destructive" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {layer.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </motion.button>
          <motion.button
            type="button"
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => removeLayer(layer.id)}
            aria-label="Remove layer"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-destructive"
          >
            <Trash2 size={16} />
          </motion.button>
        </div>
      </div>
      {isVideoSource && (
        <p className="-mt-2 text-xs text-muted-foreground">Using the audio track of this video.</p>
      )}

      {src && (
        <MediaPlayer
          ref={mediaRef}
          src={src}
          type="audio"
          trimRange={{ inPoint: layer.inPoint, outPoint: layer.outPoint }}
        />
      )}

      <TrimEditor
        duration={layer.sourceDuration}
        inPoint={layer.inPoint}
        outPoint={layer.outPoint}
        onTrimChange={(inPoint, outPoint) => updateLayer(layer.id, { inPoint, outPoint })}
        mediaRef={mediaRef}
      />

      <div className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            Start
            <input
              key={layer.startAt}
              type="text"
              defaultValue={formatTime(layer.startAt)}
              onBlur={(e) => {
                const parsed = parseTime(e.target.value);
                if (parsed !== null) setStartAt(parsed);
                else e.target.value = formatTime(layer.startAt);
              }}
              className={fieldClass}
            />
          </label>
          <button
            type="button"
            disabled={playheadTime == null}
            onClick={() => playheadTime != null && setStartAt(playheadTime)}
            className={chipClass}
          >
            Start here
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2">
            End
            <input
              key={layer.endAt ?? "auto"}
              type="text"
              placeholder="auto"
              defaultValue={layer.endAt == null ? "" : formatTime(layer.endAt)}
              onBlur={(e) => {
                if (e.target.value.trim() === "") {
                  setEndAt(null);
                  return;
                }
                const parsed = parseTime(e.target.value);
                if (parsed !== null) setEndAt(parsed);
                else e.target.value = layer.endAt == null ? "" : formatTime(layer.endAt);
              }}
              className={fieldClass}
            />
          </label>
          <button
            type="button"
            disabled={playheadTime == null || playheadTime <= layer.startAt + 0.05}
            onClick={() => playheadTime != null && setEndAt(playheadTime)}
            className={chipClass}
          >
            End here
          </button>
          <button
            type="button"
            onClick={() => updateLayer(layer.id, { loop: !layer.loop })}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
              layer.loop
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Repeat size={14} /> Loop to fill
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1 text-xs">
        <label className="flex flex-col gap-1">
          Volume — {Math.round(layer.volume * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={layer.volume}
            onChange={(e) => updateLayer(layer.id, { volume: Number(e.target.value) })}
            className="accent-primary"
          />
        </label>
        <p className="text-muted-foreground">
          {span > 0
            ? `Plays ${formatTime(layer.startAt).slice(0, 5)} → ${formatTime(layer.startAt + span).slice(0, 5)}${
                layer.loop && repeats > 1 ? ` · ×${repeats}` : ""
              }`
            : "Starts after the timeline ends — won't be heard"}
        </p>
      </div>
    </motion.div>
  );
};
