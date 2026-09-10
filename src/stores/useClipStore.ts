import { create } from "zustand";
import type { Clip, TranscriptCue } from "@/types/clip";
import { clipLength, nextFreeStart } from "@/lib/timeline";

const MIN_PIECE = 0.05;

export interface ClipPlacement {
  track?: number;
  startAt?: number;
}

interface ClipStore {
  clips: Clip[];
  /** Audio crossfade at every cut between clips, in seconds (0 = hard cuts). Applied on export. */
  joinCrossfade: number;
  setJoinCrossfade: (seconds: number) => void;
  /** Adds clips; without a placement each one is appended after the last clip on V1. */
  addClips: (newClips: Clip[], placement?: ClipPlacement) => void;
  removeClip: (id: string) => void;
  removeClips: (ids: string[]) => void;
  updateTrim: (id: string, inPoint: number, outPoint: number) => void;
  updateClip: (id: string, patch: Partial<Omit<Clip, "id" | "file">>) => void;
  setTranscript: (id: string, transcript: TranscriptCue[]) => void;
  /** Cuts a clip in two at a source-local time; both halves keep the same file. */
  splitClip: (id: string, localTime: number) => void;
  /** Places `count` copies back to back after the clip, on its track. */
  duplicateClip: (id: string, count?: number) => void;
}

const withOrder = (clips: Clip[]) => clips.map((c, i) => ({ ...c, order: i }));

export const useClipStore = create<ClipStore>()((set) => ({
  clips: [],
  joinCrossfade: 0,
  setJoinCrossfade: (seconds) => set({ joinCrossfade: Math.max(0, Math.min(2, seconds)) }),

  addClips: (newClips, placement) =>
    set((s) => {
      const track = placement?.track ?? 0;
      let cursor = placement?.startAt ?? nextFreeStart(s.clips, track);
      const placed = newClips.map((c) => {
        const clip = { ...c, track, startAt: cursor };
        cursor += clipLength(clip);
        return clip;
      });
      return { clips: withOrder([...s.clips, ...placed]) };
    }),

  removeClip: (id) => set((s) => ({ clips: withOrder(s.clips.filter((c) => c.id !== id)) })),

  removeClips: (ids) =>
    set((s) => {
      const gone = new Set(ids);
      return { clips: withOrder(s.clips.filter((c) => !gone.has(c.id))) };
    }),

  updateTrim: (id, inPoint, outPoint) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, inPoint, outPoint } : c)),
    })),

  updateClip: (id, patch) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

  setTranscript: (id, transcript) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, transcript } : c)),
    })),

  splitClip: (id, localTime) =>
    set((s) => {
      const idx = s.clips.findIndex((c) => c.id === id);
      if (idx === -1) return {};
      const clip = s.clips[idx];
      if (localTime <= clip.inPoint + MIN_PIECE || localTime >= clip.outPoint - MIN_PIECE) return {};
      const head = { ...clip, outPoint: localTime };
      const tail = {
        ...clip,
        id: crypto.randomUUID(),
        inPoint: localTime,
        startAt: clip.startAt + (localTime - clip.inPoint),
      };
      return { clips: withOrder([...s.clips.slice(0, idx), head, tail, ...s.clips.slice(idx + 1)]) };
    }),

  duplicateClip: (id, count = 1) =>
    set((s) => {
      const idx = s.clips.findIndex((c) => c.id === id);
      if (idx === -1 || count < 1) return {};
      const clip = s.clips[idx];
      const len = clipLength(clip);
      const copies = Array.from({ length: count }, (_, k) => ({
        ...clip,
        id: crypto.randomUUID(),
        startAt: clip.startAt + len * (k + 1),
      }));
      return { clips: withOrder([...s.clips.slice(0, idx + 1), ...copies, ...s.clips.slice(idx + 1)]) };
    }),
}));
