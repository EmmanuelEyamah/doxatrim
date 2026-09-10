import { useCallback, useMemo, useState } from "react";

export const MIN_PX_PER_SEC = 4;
export const MAX_PX_PER_SEC = 400;
const ZOOM_STEP = 1.35;

export interface TimelineScale {
  pxPerSec: number;
  timeToX: (t: number) => number;
  xToTime: (x: number) => number;
  zoomIn: () => void;
  zoomOut: () => void;
  setPxPerSec: (v: number) => void;
  /** Zoom so `duration` fills `width` pixels. */
  fit: (width: number, duration: number) => void;
}

export function useTimelineScale(initial = 40): TimelineScale {
  const [pxPerSec, setPxPerSecState] = useState(initial);

  const setPxPerSec = useCallback((v: number) => {
    setPxPerSecState(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, v)));
  }, []);

  const fit = useCallback(
    (width: number, duration: number) => {
      if (width <= 0 || duration <= 0) return;
      setPxPerSec((width - 24) / duration);
    },
    [setPxPerSec]
  );

  return useMemo(
    () => ({
      pxPerSec,
      timeToX: (t: number) => t * pxPerSec,
      xToTime: (x: number) => x / pxPerSec,
      zoomIn: () => setPxPerSec(pxPerSec * ZOOM_STEP),
      zoomOut: () => setPxPerSec(pxPerSec / ZOOM_STEP),
      setPxPerSec,
      fit,
    }),
    [pxPerSec, setPxPerSec, fit]
  );
}
