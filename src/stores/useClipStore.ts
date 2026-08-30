import { create } from "zustand";
import type { Clip } from "@/types/clip";

interface ClipStore {
  clips: Clip[];
  selectedClipId: string | null;
  addClips: (newClips: Clip[]) => void;
  removeClip: (id: string) => void;
  reorderClips: (fromIndex: number, toIndex: number) => void;
  updateTrim: (id: string, inPoint: number, outPoint: number) => void;
  selectClip: (id: string) => void;
}

export const useClipStore = create<ClipStore>()((set) => ({
  clips: [],
  selectedClipId: null,

  addClips: (newClips) =>
    set((s) => {
      const clips = [
        ...s.clips,
        ...newClips.map((clip, i) => ({ ...clip, order: s.clips.length + i })),
      ];
      return {
        clips,
        selectedClipId: s.selectedClipId ?? clips[0]?.id ?? null,
      };
    }),

  removeClip: (id) =>
    set((s) => {
      const clips = s.clips
        .filter((c) => c.id !== id)
        .map((c, i) => ({ ...c, order: i }));
      const selectedClipId =
        s.selectedClipId === id ? (clips[0]?.id ?? null) : s.selectedClipId;
      return { clips, selectedClipId };
    }),

  reorderClips: (fromIndex, toIndex) =>
    set((s) => {
      const clips = [...s.clips];
      const [moved] = clips.splice(fromIndex, 1);
      clips.splice(toIndex, 0, moved);
      return { clips: clips.map((c, i) => ({ ...c, order: i })) };
    }),

  updateTrim: (id, inPoint, outPoint) =>
    set((s) => ({
      clips: s.clips.map((c) => (c.id === id ? { ...c, inPoint, outPoint } : c)),
    })),

  selectClip: (id) => set({ selectedClipId: id }),
}));
