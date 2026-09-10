import { create } from "zustand";
import type { AudioLayer } from "@/types/audioLayer";

interface AudioLayerStore {
  layers: AudioLayer[];
  mainVolume: number; // 0..1, the main timeline's own audio
  selectedLayerId: string | null;
  addLayer: (file: File, sourceDuration: number, name?: string) => AudioLayer;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<AudioLayer, "id" | "file">>) => void;
  setMainVolume: (volume: number) => void;
  selectLayer: (id: string | null) => void;
}

export const useAudioLayerStore = create<AudioLayerStore>()((set, get) => ({
  layers: [],
  mainVolume: 1,
  selectedLayerId: null,

  addLayer: (file, sourceDuration, name) => {
    const layer: AudioLayer = {
      id: crypto.randomUUID(),
      file,
      name: name ?? file.name,
      sourceDuration,
      inPoint: 0,
      outPoint: sourceDuration,
      startAt: 0,
      loop: false,
      endAt: null,
      volume: 0.7,
      muted: false,
      colorIndex: get().layers.length % 5,
    };
    set((s) => ({ layers: [...s.layers, layer], selectedLayerId: layer.id }));
    return layer;
  },

  removeLayer: (id) =>
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
      selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
    })),

  updateLayer: (id, patch) =>
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    })),

  setMainVolume: (mainVolume) => set({ mainVolume }),

  selectLayer: (id) => set({ selectedLayerId: id }),
}));
