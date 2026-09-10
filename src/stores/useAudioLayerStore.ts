import { create } from "zustand";
import type { AudioLayer } from "@/types/audioLayer";
import { layerSpan } from "@/lib/timeline";

const MIN_PIECE = 0.05;

interface AudioLayerStore {
  layers: AudioLayer[];
  mainVolume: number; // 0..1, the main timeline's own audio
  selectedLayerId: string | null;
  addLayer: (file: File, sourceDuration: number, name?: string) => AudioLayer;
  removeLayer: (id: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<AudioLayer, "id" | "file">>) => void;
  setMainVolume: (volume: number) => void;
  selectLayer: (id: string | null) => void;
  /** Cuts a layer in two at a timeline time. A looped layer restarts its loop at the cut. */
  splitLayer: (id: string, at: number, timelineEnd: number) => void;
  /** Places `count` copies back to back after the layer, on new lanes. */
  duplicateLayer: (id: string, count: number, timelineEnd: number) => void;
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

  splitLayer: (id, at, timelineEnd) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx === -1) return {};
      const layer = s.layers[idx];
      const span = layerSpan(layer, timelineEnd);
      const local = at - layer.startAt;
      if (local <= MIN_PIECE || local >= span - MIN_PIECE) return {};

      const head: AudioLayer = layer.loop
        ? { ...layer, endAt: at }
        : { ...layer, outPoint: layer.inPoint + local, endAt: null };
      const tail: AudioLayer = layer.loop
        ? { ...layer, id: crypto.randomUUID(), startAt: at }
        : { ...layer, id: crypto.randomUUID(), startAt: at, inPoint: layer.inPoint + local };

      return {
        layers: [...s.layers.slice(0, idx), head, tail, ...s.layers.slice(idx + 1)],
        selectedLayerId: head.id,
      };
    }),

  duplicateLayer: (id, count, timelineEnd) =>
    set((s) => {
      const idx = s.layers.findIndex((l) => l.id === id);
      if (idx === -1 || count < 1) return {};
      const layer = s.layers[idx];
      const span = layerSpan(layer, timelineEnd);
      if (span <= MIN_PIECE) return {};
      const copies: AudioLayer[] = Array.from({ length: count }, (_, k) => {
        const startAt = layer.startAt + span * (k + 1);
        return {
          ...layer,
          id: crypto.randomUUID(),
          startAt,
          endAt: layer.loop ? startAt + span : layer.endAt == null ? null : startAt + span,
          colorIndex: (layer.colorIndex + k + 1) % 5,
        };
      });
      return { layers: [...s.layers.slice(0, idx + 1), ...copies, ...s.layers.slice(idx + 1)] };
    }),
}));
