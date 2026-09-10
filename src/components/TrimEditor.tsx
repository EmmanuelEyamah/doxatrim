import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatTime, parseTime } from "@/lib/formatTime";

const THUMB_CLASS =
  "pointer-events-none absolute inset-0 h-2 w-full appearance-none bg-transparent " +
  "[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 " +
  "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary " +
  "[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 " +
  "[&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary";

interface TrimEditorProps {
  duration: number;
  inPoint: number;
  outPoint: number;
  onTrimChange: (inPoint: number, outPoint: number) => void;
  /** Element whose playhead drives "set at playhead" and (optionally) range-constrained playback. */
  mediaRef?: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
  /** Overrides `mediaRef` for reading the playhead (source-local seconds); return null when unavailable. */
  getPlayheadTime?: () => number | null;
  /** Pause at outPoint and snap back to inPoint. Off when a sequence player owns playback. */
  constrainPlayback?: boolean;
  /** Dense, chrome-less layout for inspector panels. */
  bare?: boolean;
}

export const TrimEditor = ({
  duration,
  inPoint,
  outPoint,
  onTrimChange,
  mediaRef,
  getPlayheadTime,
  constrainPlayback = true,
  bare = false,
}: TrimEditorProps) => {
  const safeDuration = duration || 0.01;

  useEffect(() => {
    const el = mediaRef?.current;
    if (!constrainPlayback || !el) return;
    const handleTimeUpdate = () => {
      if (el.currentTime >= outPoint) {
        el.currentTime = inPoint;
        el.pause();
      }
    };
    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => el.removeEventListener("timeupdate", handleTimeUpdate);
  }, [mediaRef, inPoint, outPoint, constrainPlayback]);

  const readPlayhead = (): number | null => {
    if (getPlayheadTime) return getPlayheadTime();
    return mediaRef?.current?.currentTime ?? null;
  };

  const setIn = (value: number) => {
    onTrimChange(Math.min(Math.max(0, value), outPoint - 0.05), outPoint);
  };

  const setOut = (value: number) => {
    onTrimChange(inPoint, Math.max(Math.min(safeDuration, value), inPoint + 0.05));
  };

  const fieldClass = cn(
    "rounded-md border border-border bg-background font-mono outline-none focus:border-primary",
    bare ? "h-7 w-24 px-2 text-xs" : "w-24 px-2 py-1 text-sm"
  );
  const chipClass = cn(
    "rounded-md border border-border text-muted-foreground hover:text-foreground",
    bare ? "h-7 px-2 text-[11px]" : "px-2 py-1 text-xs"
  );

  const timeField = (value: number, apply: (v: number) => void, label: string) => (
    <input
      key={value}
      type="text"
      aria-label={label}
      defaultValue={formatTime(value)}
      onBlur={(e) => {
        const parsed = parseTime(e.target.value);
        if (parsed !== null) apply(parsed);
        else e.target.value = formatTime(value);
      }}
      className={fieldClass}
    />
  );

  return (
    <div className={cn("flex flex-col", bare ? "gap-3" : "gap-4 rounded-xl border border-border bg-card p-4")}>
      <div className="relative h-2 rounded-full bg-muted">
        <div
          className="absolute h-2 rounded-full bg-primary"
          style={{
            left: `${(inPoint / safeDuration) * 100}%`,
            right: `${100 - (outPoint / safeDuration) * 100}%`,
          }}
        />
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.01}
          value={inPoint}
          onChange={(e) => setIn(Number(e.target.value))}
          className={THUMB_CLASS}
          aria-label="In point"
        />
        <input
          type="range"
          min={0}
          max={safeDuration}
          step={0.01}
          value={outPoint}
          onChange={(e) => setOut(Number(e.target.value))}
          className={THUMB_CLASS}
          aria-label="Out point"
        />
      </div>

      <div className={cn("grid items-center gap-x-2 gap-y-2", bare ? "grid-cols-[2.5rem_auto_1fr] text-xs" : "grid-cols-[2rem_auto_1fr] text-sm")}>
        <span className="text-muted-foreground">In</span>
        {timeField(inPoint, setIn, "In point")}
        <button
          type="button"
          onClick={() => {
            const t = readPlayhead();
            if (t != null) setIn(t);
          }}
          className={cn(chipClass, "justify-self-start")}
        >
          Set at playhead
        </button>

        <span className="text-muted-foreground">Out</span>
        {timeField(outPoint, setOut, "Out point")}
        <button
          type="button"
          onClick={() => {
            const t = readPlayhead();
            if (t != null) setOut(t);
          }}
          className={cn(chipClass, "justify-self-start")}
        >
          Set at playhead
        </button>
      </div>
    </div>
  );
};
