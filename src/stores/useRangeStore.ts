import { create } from "zustand";

export interface TimeRange {
  start: number;
  end: number;
}

const MIN_RANGE = 0.05;

interface RangeStore {
  /** Export range (In/Out) on the project timeline; null = whole project. */
  range: TimeRange | null;
  setRange: (range: TimeRange | null) => void;
  /** Mark In at `t`; the Out stays where it is, or falls to `projectEnd` if none was set. */
  markIn: (t: number, projectEnd: number) => void;
  /** Mark Out at `t`; the In stays where it is, or falls to 0 if none was set. */
  markOut: (t: number) => void;
  clear: () => void;
}

function normalized(start: number, end: number): TimeRange {
  const s = Math.max(0, start);
  return { start: s, end: Math.max(end, s + MIN_RANGE) };
}

export const useRangeStore = create<RangeStore>()((set, get) => ({
  range: null,
  setRange: (range) => set({ range: range ? normalized(range.start, range.end) : null }),
  markIn: (t, projectEnd) => {
    const cur = get().range;
    const end = cur && cur.end > t + MIN_RANGE ? cur.end : Math.max(projectEnd, t + MIN_RANGE);
    set({ range: normalized(t, end) });
  },
  markOut: (t) => {
    const cur = get().range;
    const start = cur && cur.start < t - MIN_RANGE ? cur.start : 0;
    set({ range: normalized(start, t) });
  },
  clear: () => set({ range: null }),
}));
