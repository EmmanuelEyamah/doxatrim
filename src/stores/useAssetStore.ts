import { create } from "zustand";
import type { Asset } from "@/types/asset";
import type { TranscriptCue } from "@/types/clip";
import { useClipStore } from "@/stores/useClipStore";

interface AssetStore {
  assets: Asset[];
  addAssets: (assets: Asset[]) => void;
  removeAsset: (id: string) => void;
  setTranscript: (id: string, transcript: TranscriptCue[]) => void;
}

export const useAssetStore = create<AssetStore>()((set) => ({
  assets: [],

  addAssets: (newAssets) => set((s) => ({ assets: [...s.assets, ...newAssets] })),

  // Timeline clips placed from the asset keep working — they hold their own File reference.
  removeAsset: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),

  setTranscript: (id, transcript) => {
    set((s) => ({ assets: s.assets.map((a) => (a.id === id ? { ...a, transcript } : a)) }));
    const clipStore = useClipStore.getState();
    for (const clip of clipStore.clips) {
      if (clip.assetId === id) clipStore.setTranscript(clip.id, transcript);
    }
  },
}));
