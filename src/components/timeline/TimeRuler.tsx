import { useRef } from "react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import type { TimelineScale } from "@/components/timeline/useTimelineScale";
import { usePointerDrag } from "@/components/timeline/usePointerDrag";
import { rulerTicks } from "@/components/timeline/rulerTicks";
import type { TimeRange } from "@/stores/useRangeStore";

export const RULER_HEIGHT = 24;

interface TimeRulerProps {
  duration: number;
  width: number;
  scale: TimelineScale;
  /** Visible slice of the content, in content pixels — ticks outside it aren't rendered. */
  viewport: { left: number; width: number };
  onSeek: (t: number) => void;
  /** Fires when a scrub (press or drag along the ruler) starts and ends. */
  onScrubbing?: (active: boolean) => void;
  /** Export range shown as a band with draggable In/Out handles. */
  range?: TimeRange | null;
  onRangeChange?: (range: TimeRange) => void;
}

const MIN_RANGE = 0.05;

const RangeHandle = ({
  x,
  side,
  onDrag,
  onScrubbing,
}: {
  x: number;
  side: "in" | "out";
  onDrag: (clientX: number) => void;
  onScrubbing?: (active: boolean) => void;
}) => {
  const onPointerDown = usePointerDrag({
    onStart: () => onScrubbing?.(true),
    onMove: (_dx, _dy, e) => onDrag(e.clientX),
    onEnd: () => onScrubbing?.(false),
  });
  return (
    <div
      onPointerDown={onPointerDown}
      title={side === "in" ? "Range In — drag" : "Range Out — drag"}
      className={cn(
        "absolute top-0 z-10 h-full w-2 cursor-ew-resize bg-primary",
        side === "in" ? "rounded-r-sm" : "rounded-l-sm"
      )}
      style={{ left: side === "in" ? x : x - 8 }}
    />
  );
};

export const TimeRuler = ({ duration, width, scale, viewport, onSeek, onScrubbing, range, onRangeChange }: TimeRulerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const end = Math.max(duration, scale.xToTime(width));
  const ticks = rulerTicks({ pxPerSec: scale.pxPerSec, duration: end, viewportLeft: viewport.left, viewportWidth: viewport.width });

  const timeAt = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    return rect ? Math.max(0, scale.xToTime(clientX - rect.left)) : 0;
  };
  const seekAt = (clientX: number) => onSeek(timeAt(clientX));
  const dragIn = (clientX: number) => {
    if (!range || !onRangeChange) return;
    const t = Math.min(timeAt(clientX), range.end - MIN_RANGE);
    onRangeChange({ start: t, end: range.end });
    onSeek(t);
  };
  const dragOut = (clientX: number) => {
    if (!range || !onRangeChange) return;
    const t = Math.min(Math.max(timeAt(clientX), range.start + MIN_RANGE), Math.max(duration, range.start + MIN_RANGE));
    onRangeChange({ start: range.start, end: t });
    onSeek(t);
  };

  // Press seeks, and dragging along the ruler scrubs — pointer capture keeps
  // the scrub alive even when the cursor leaves the ruler strip.
  const onPointerDown = usePointerDrag({
    onStart: (e) => {
      onScrubbing?.(true);
      seekAt(e.clientX);
    },
    onMove: (_dx, _dy, e) => seekAt(e.clientX),
    onEnd: () => onScrubbing?.(false),
  });

  return (
    <div
      ref={ref}
      className="relative shrink-0 cursor-ew-resize select-none border-b border-border bg-sidebar"
      style={{ height: RULER_HEIGHT, width }}
      onPointerDown={onPointerDown}
    >
      {range && (
        <>
          <div
            className="pointer-events-none absolute inset-y-0 bg-primary/20"
            style={{ left: scale.timeToX(range.start), width: Math.max(2, scale.timeToX(range.end) - scale.timeToX(range.start)) }}
          />
          <RangeHandle x={scale.timeToX(range.start)} side="in" onDrag={dragIn} onScrubbing={onScrubbing} />
          <RangeHandle x={scale.timeToX(range.end)} side="out" onDrag={dragOut} onScrubbing={onScrubbing} />
        </>
      )}
      {ticks.map(({ t, major }) => (
        <div
          key={t}
          className="absolute bottom-0 border-l border-foreground/25"
          style={{ left: scale.timeToX(t), height: major ? 10 : 5 }}
        >
          {major && (
            <span className="absolute left-1 top-[-14px] font-mono text-[10px] leading-none text-muted-foreground">
              {formatTime(t).slice(0, 5)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
};
