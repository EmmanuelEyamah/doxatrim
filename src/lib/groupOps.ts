import { useClipStore } from "@/stores/useClipStore";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import type { Selection } from "@/lib/selection";
import type { Clip } from "@/types/clip";
import type { AudioLayer } from "@/types/audioLayer";
import { clipEnd, clipLength, layerSpan, timelineEnd } from "@/lib/timeline";

function selected(sel: Selection): { clips: Clip[]; layers: AudioLayer[] } {
  const clips = useClipStore.getState().clips.filter((c) => sel.clips.includes(c.id));
  const layers = useAudioLayerStore.getState().layers.filter((l) => sel.layers.includes(l.id));
  return { clips, layers };
}

/** The time range the selection occupies as a whole. */
export function selectionSpan(sel: Selection): { start: number; end: number } | null {
  const { clips, layers } = selected(sel);
  if (clips.length === 0 && layers.length === 0) return null;
  const end = timelineEnd(useClipStore.getState().clips);
  let start = Infinity;
  let stop = 0;
  for (const c of clips) {
    start = Math.min(start, c.startAt);
    stop = Math.max(stop, clipEnd(c));
  }
  for (const l of layers) {
    start = Math.min(start, l.startAt);
    stop = Math.max(stop, l.startAt + layerSpan(l, end));
  }
  return { start, end: stop };
}

/**
 * Repeats the whole selection as one unit: every copy of the arrangement is
 * placed right after the previous one, tracks and lanes preserved. Returns
 * the ids of the created items so they can be selected.
 */
export function repeatSelection(sel: Selection, count: number): Selection {
  const span = selectionSpan(sel);
  if (!span || count < 1) return { clips: [], layers: [] };
  const length = span.end - span.start;
  if (length <= 0.05) return { clips: [], layers: [] };
  const { clips, layers } = selected(sel);
  const end = timelineEnd(useClipStore.getState().clips);

  const newClips: Clip[] = [];
  const newLayers: AudioLayer[] = [];
  for (let k = 1; k <= count; k++) {
    const shift = length * k;
    for (const c of clips) newClips.push({ ...c, id: crypto.randomUUID(), startAt: c.startAt + shift });
    for (const l of layers) {
      const lspan = layerSpan(l, end);
      newLayers.push({
        ...l,
        id: crypto.randomUUID(),
        startAt: l.startAt + shift,
        endAt: l.loop ? l.startAt + shift + lspan : l.endAt == null ? null : l.endAt + shift,
      });
    }
  }

  if (newClips.length > 0) {
    // Keep each copy's own positions: add without placement, then restore startAt/track.
    const store = useClipStore.getState();
    store.addClips(newClips.map((c) => ({ ...c })));
    for (const c of newClips) store.updateClip(c.id, { startAt: c.startAt, track: c.track });
  }
  if (newLayers.length > 0) {
    useAudioLayerStore.getState().insertLayers(newLayers, layers[layers.length - 1]?.id);
  }
  return { clips: newClips.map((c) => c.id), layers: newLayers.map((l) => l.id) };
}

export function removeSelection(sel: Selection) {
  if (sel.clips.length) useClipStore.getState().removeClips(sel.clips);
  if (sel.layers.length) useAudioLayerStore.getState().removeLayers(sel.layers);
}

export interface DragSnapshot {
  clips: { id: string; startAt: number; track: number }[];
  layers: { id: string; startAt: number; endAt: number | null }[];
}

export function snapshotSelection(sel: Selection): DragSnapshot {
  const { clips, layers } = selected(sel);
  return {
    clips: clips.map((c) => ({ id: c.id, startAt: c.startAt, track: c.track })),
    layers: layers.map((l) => ({ id: l.id, startAt: l.startAt, endAt: l.endAt })),
  };
}

/** Moves everything in the snapshot by `dt` seconds (and clips by `dTrack` tracks), clamped to the timeline. */
export function moveSnapshot(snap: DragSnapshot, dt: number, dTrack: number, timelineEndBefore: number) {
  const minStart = Math.min(
    ...snap.clips.map((c) => c.startAt),
    ...snap.layers.map((l) => l.startAt),
    Infinity
  );
  const shift = Math.max(dt, -minStart); // nothing can start before 0
  const minTrack = Math.min(...snap.clips.map((c) => c.track), Infinity);
  const trackShift = Math.max(dTrack, -minTrack);

  const clipStore = useClipStore.getState();
  for (const c of snap.clips) {
    clipStore.updateClip(c.id, { startAt: c.startAt + shift, track: c.track + trackShift });
  }
  const layerStore = useAudioLayerStore.getState();
  const maxStart = Math.max(0, timelineEndBefore - 0.05);
  for (const l of snap.layers) {
    const startAt = Math.min(l.startAt + shift, maxStart);
    layerStore.updateLayer(l.id, { startAt, endAt: l.endAt == null ? null : l.endAt + (startAt - l.startAt) });
  }
}

export const clipDuration = clipLength;
