import { create } from "zustand";

interface BackgroundAudioStore {
  file: File | null;
  duration: number;
  inPoint: number;
  outPoint: number;
  volume: number; // 0-1, background track
  mainVolume: number; // 0-1, main timeline
  setFile: (file: File, duration: number) => void;
  clear: () => void;
  setTrim: (inPoint: number, outPoint: number) => void;
  setVolume: (volume: number) => void;
  setMainVolume: (volume: number) => void;
}

export const useBackgroundAudioStore = create<BackgroundAudioStore>()((set) => ({
  file: null,
  duration: 0,
  inPoint: 0,
  outPoint: 0,
  volume: 0.5,
  mainVolume: 1,
  setFile: (file, duration) => set({ file, duration, inPoint: 0, outPoint: duration }),
  clear: () => set({ file: null, duration: 0, inPoint: 0, outPoint: 0 }),
  setTrim: (inPoint, outPoint) => set({ inPoint, outPoint }),
  setVolume: (volume) => set({ volume }),
  setMainVolume: (mainVolume) => set({ mainVolume }),
}));
