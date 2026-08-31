import { useEffect } from "react";
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
  mediaRef: React.RefObject<HTMLVideoElement | HTMLAudioElement | null>;
}

export const TrimEditor = ({ duration, inPoint, outPoint, onTrimChange, mediaRef }: TrimEditorProps) => {
  const safeDuration = duration || 0.01;

  // Loop playback: stop at outPoint, snap back to inPoint.
  useEffect(() => {
    const el = mediaRef.current;
    if (!el) return;
    const handleTimeUpdate = () => {
      if (el.currentTime >= outPoint) {
        el.currentTime = inPoint;
        el.pause();
      }
    };
    el.addEventListener("timeupdate", handleTimeUpdate);
    return () => el.removeEventListener("timeupdate", handleTimeUpdate);
  }, [mediaRef, inPoint, outPoint]);

  const setIn = (value: number) => {
    onTrimChange(Math.min(Math.max(0, value), outPoint - 0.05), outPoint);
  };

  const setOut = (value: number) => {
    onTrimChange(inPoint, Math.max(Math.min(safeDuration, value), inPoint + 0.05));
  };

  const setInAtPlayhead = () => {
    if (mediaRef.current) setIn(mediaRef.current.currentTime);
  };

  const setOutAtPlayhead = () => {
    if (mediaRef.current) setOut(mediaRef.current.currentTime);
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
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

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">
          In
          <input
            key={inPoint}
            type="text"
            defaultValue={formatTime(inPoint)}
            onBlur={(e) => {
              const parsed = parseTime(e.target.value);
              if (parsed !== null) setIn(parsed);
              else e.target.value = formatTime(inPoint);
            }}
            className="w-24 rounded-lg border border-border bg-background px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={setInAtPlayhead}
          className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground"
        >
          Set in at playhead
        </button>

        <label className="flex items-center gap-2">
          Out
          <input
            key={outPoint}
            type="text"
            defaultValue={formatTime(outPoint)}
            onBlur={(e) => {
              const parsed = parseTime(e.target.value);
              if (parsed !== null) setOut(parsed);
              else e.target.value = formatTime(outPoint);
            }}
            className="w-24 rounded-lg border border-border bg-background px-2 py-1"
          />
        </label>
        <button
          type="button"
          onClick={setOutAtPlayhead}
          className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground"
        >
          Set out at playhead
        </button>
      </div>
    </div>
  );
};
