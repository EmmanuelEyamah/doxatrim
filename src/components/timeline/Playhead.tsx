import { useEffect, useRef, useState } from "react";
import { usePointerDrag } from "@/components/timeline/usePointerDrag";
import type { TimelineScale } from "@/components/timeline/useTimelineScale";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";

interface PlayheadProps {
  player: SequencePlayer;
  scale: TimelineScale;
  height: number;
  /** Fires when the user starts/stops dragging the playhead. */
  onScrubbing?: (active: boolean) => void;
}

/** Owns its own animation frame so only this element re-renders at 60fps while playing. */
export const Playhead = ({ player, scale, height, onScrubbing }: PlayheadProps) => {
  const { playing, timelineTime, getTimelineTimeNow, seek } = player;
  const [t, setT] = useState(timelineTime);
  const startTimeRef = useRef(0);

  useEffect(() => {
    if (!playing) {
      setT(timelineTime);
      return;
    }
    let raf = 0;
    const loop = () => {
      setT(getTimelineTimeNow());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, timelineTime, getTimelineTimeNow]);

  const onPointerDown = usePointerDrag({
    onStart: () => {
      startTimeRef.current = t;
      onScrubbing?.(true);
    },
    onMove: (dx) => seek(startTimeRef.current + scale.xToTime(dx)),
    onEnd: () => onScrubbing?.(false),
  });

  const x = scale.timeToX(t);

  return (
    <div className="pointer-events-none absolute top-0 z-20" style={{ left: x, height }}>
      <div
        onPointerDown={onPointerDown}
        className="pointer-events-auto absolute -top-0.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 cursor-ew-resize rounded-[2px] bg-primary shadow"
      />
      <div className="h-full w-px bg-primary" />
    </div>
  );
};
