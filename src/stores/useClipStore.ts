import { create } from "zustand";
import type { Clip, TranscriptCue } from "@/types/clip";

const MIN_PIECE = 0.05;

interface ClipStore {
  clips: Clip[];
  selectedClipId: string | null;
  addClips: (newClips: Clip[]) => void;
  removeClip: (id: string) => void;
  reorderClips: (fromIndex: number, toIndex: number) => void;
  updateTrim: (id: string, inPoint: number, outPoint: number) => void;
  selectClip: (id: string) => void;
  setTranscript: (id: string, transcript: TranscriptCue[]) => void;
  /** Cuts a clip in two at a source-local time; both halves keep the same file. */
  splitClip: (id: string, localTime: number) => void;
  /** Inserts `count` copies right after the clip. */
  duplicateClip: (id: string, count?: number) => void;
}

const reorder = (clips: Clip[]) => clips.map((c, i) => ({ ...c, order: i }));

export const useClipStore = create<ClipStore>()((set) => ({
  clips: [],
  selectedClipId: null,

  addClips: (newClips) =>
    set((s) => {
      const clips = reorder([...s.clips, ...newClips]);
      return {
        clips,
        selectedClipId: s.selectedClipId ?? clips[0]?.id ?? null,
      };
    }),

  removeClip: (id) =>
    set((s) => {
      const clips = reorder(s.clips.filter((c) => c.id !== id));
      const selectedClipId =
        s.selectedClipId === id ? (clips[0]?.id ?? null) : s.selectedClipId;
      return { clips, selectedClipId };
    }),

  reorderClips: (fromIndex, toIndex) =>
    set((s) => {
      const clips = [...s.clips];
      const [moved] = clips.splice(fromIndex, 1);
      clips.splice(toIndex, 0, moved);
      return { clips: reorder(clips) };
    }),

  updateTrim: (id, inPoint, outPoint) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, inPoint, outPoint } : c)),
    })),

  selectClip: (id) => set({ selectedClipId: id }),

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
      const tail = { ...clip, id: crypto.randomUUID(), inPoint: localTime };
      return { clips: reorder([...s.clips.slice(0, idx), head, tail, ...s.clips.slice(idx + 1)]) };
    }),

  duplicateClip: (id, count = 1) =>
    set((s) => {
      const idx = s.clips.findIndex((c) => c.id === id);
      if (idx === -1 || count < 1) return {};
      const copies = Array.from({ length: count }, () => ({ ...s.clips[idx], id: crypto.randomUUID() }));
      return { clips: reorder([...s.clips.slice(0, idx + 1), ...copies, ...s.clips.slice(idx + 1)]) };
    }),
}));
