import { formatTime } from "@/lib/formatTime";
import type { TimelineScale } from "@/components/timeline/useTimelineScale";

export const RULER_HEIGHT = 24;
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

interface TimeRulerProps {
  duration: number;
  width: number;
  scale: TimelineScale;
  onSeek: (t: number) => void;
}

export function tickStepFor(pxPerSec: number): number {
  return STEPS.find((s) => s * pxPerSec >= 64) ?? STEPS[STEPS.length - 1];
}

export const TimeRuler = ({ duration, width, scale, onSeek }: TimeRulerProps) => {
  const step = tickStepFor(scale.pxPerSec);
  const minor = step / 5;
  const end = Math.max(duration, scale.xToTime(width));
  const ticks: { t: number; major: boolean }[] = [];
  for (let t = 0; t <= end + 1e-6; t += minor) {
    const isMajor = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ticks.push({ t, major: isMajor });
  }

  return (
    <div
      className="relative shrink-0 cursor-pointer select-none border-b border-border bg-sidebar"
      style={{ height: RULER_HEIGHT, width }}
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(scale.xToTime(e.clientX - rect.left));
      }}
    >
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
