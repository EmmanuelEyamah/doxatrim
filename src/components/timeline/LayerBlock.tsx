import { useRef } from "react";
import { motion } from "framer-motion";
import { Repeat, Video } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import { layerSpan } from "@/lib/timeline";
import { snapTime } from "@/lib/snap";
import { getClipType } from "@/lib/fileValidation";
import type { AudioLayer } from "@/types/audioLayer";
import { usePointerDrag } from "@/components/timeline/usePointerDrag";
import type { TimelineScale } from "@/components/timeline/useTimelineScale";

export const AUDIO_LANE_HEIGHT = 48;
export const LANE_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-5)", "var(--chart-4)", "var(--chart-2)"];

const SNAP_PX = 8;

interface LayerBlockProps {
  layer: AudioLayer;
  timelineEnd: number;
  scale: TimelineScale;
  selected: boolean;
  snapEnabled: boolean;
  /** Timeline seconds worth snapping to (clip boundaries, other layers, playhead). */
  snapTargets: number[];
  onSelect: () => void;
  onChange: (patch: Partial<Omit<AudioLayer, "id" | "file">>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export const LayerBlock = ({
  layer,
  timelineEnd,
  scale,
  selected,
  snapEnabled,
  snapTargets,
  onSelect,
  onChange,
  onContextMenu,
}: LayerBlockProps) => {
  const startRef = useRef({ startAt: 0, inPoint: 0, outPoint: 0, endAt: null as number | null, span: 0 });
  const span = layerSpan(layer, timelineEnd);
  const segment = layer.outPoint - layer.inPoint;
  const isVideoSource = getClipType(layer.file) === "video";

  const snap = (t: number, shiftKey: boolean) =>
    snapEnabled && !shiftKey ? snapTime(t, snapTargets, SNAP_PX / scale.pxPerSec) : t;

  const capture = () => {
    startRef.current = {
      startAt: layer.startAt,
      inPoint: layer.inPoint,
      outPoint: layer.outPoint,
      endAt: layer.endAt,
      span,
    };
    onSelect();
  };

  // Body: move the whole block along the timeline.
  const onBodyDown = usePointerDrag({
    onStart: capture,
    onMove: (dx, _dy, e) => {
      const s = startRef.current;
      const raw = s.startAt + scale.xToTime(dx);
      const startAt = Math.max(0, Math.min(snap(raw, e.shiftKey), Math.max(0, timelineEnd - 0.05)));
      const shift = startAt - s.startAt;
      onChange({ startAt, endAt: s.endAt == null ? null : Math.min(timelineEnd, s.endAt + shift) });
    },
  });

  // Left edge: trim the head — inPoint and startAt move together so the audio stays aligned.
  const onLeftDown = usePointerDrag({
    onStart: capture,
    onMove: (dx, _dy, e) => {
      const s = startRef.current;
      const rawStart = snap(s.startAt + scale.xToTime(dx), e.shiftKey);
      let delta = rawStart - s.startAt;
      delta = Math.max(delta, -s.inPoint, -s.startAt);
      delta = Math.min(delta, s.outPoint - s.inPoint - 0.05);
      onChange({ startAt: s.startAt + delta, inPoint: s.inPoint + delta });
    },
  });

  // Right edge: looped → where the loop stops; play-once → the source outPoint.
  const onRightDown = usePointerDrag({
    onStart: capture,
    onMove: (dx, _dy, e) => {
      const s = startRef.current;
      const rawEnd = snap(s.startAt + s.span + scale.xToTime(dx), e.shiftKey);
      if (layer.loop) {
        onChange({ endAt: Math.min(timelineEnd, Math.max(s.startAt + 0.05, rawEnd)) });
      } else {
        const outPoint = s.inPoint + (rawEnd - s.startAt);
        onChange({
          outPoint: Math.min(layer.sourceDuration, Math.max(s.inPoint + 0.05, outPoint)),
          endAt: null,
        });
      }
    },
  });

  const left = scale.timeToX(layer.startAt);
  const width = Math.max(scale.timeToX(span), 6);
  const color = LANE_COLORS[layer.colorIndex % LANE_COLORS.length];

  const repeatMarks: number[] = [];
  if (layer.loop && segment > 0.01) {
    for (let t = segment; t < span; t += segment) repeatMarks.push(t);
  }

  return (
    <motion.div
      layout
      onPointerDown={onBodyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={onSelect}
      onContextMenu={onContextMenu}
      className={cn(
        "group absolute top-1 bottom-1 cursor-grab select-none overflow-hidden rounded-md border active:cursor-grabbing",
        selected ? "border-primary ring-2 ring-primary/40" : "border-transparent",
        layer.muted && "opacity-50"
      )}
      style={{ left, width, backgroundColor: color }}
    >
      <div className="absolute inset-0 bg-black/25" />
      {repeatMarks.map((t) => (
        <div key={t} className="absolute top-0 bottom-0 w-px bg-white/45" style={{ left: scale.timeToX(t) }} />
      ))}
      <div className="absolute inset-x-2 top-1/2 flex -translate-y-1/2 items-center gap-1.5 text-[11px] font-semibold leading-none text-white">
        {layer.loop && <Repeat size={11} className="shrink-0" />}
        {isVideoSource && <Video size={11} className="shrink-0" />}
        <span className="truncate drop-shadow">{layer.name}</span>
        <span className="ml-auto shrink-0 font-mono opacity-80">{formatTime(span).slice(0, 5)}</span>
      </div>
      <div
        onPointerDown={onLeftDown}
        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30"
      />
      <div
        onPointerDown={onRightDown}
        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30"
      />
    </motion.div>
  );
};
