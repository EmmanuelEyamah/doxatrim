export interface Selection {
  clips: string[];
  layers: string[];
}

export type ItemKind = "clip" | "layer";

export const EMPTY_SELECTION: Selection = { clips: [], layers: [] };

export const selectionCount = (s: Selection) => s.clips.length + s.layers.length;
export const isEmptySelection = (s: Selection) => selectionCount(s) === 0;

export function isSelected(s: Selection, kind: ItemKind, id: string): boolean {
  return (kind === "clip" ? s.clips : s.layers).includes(id);
}

/** Exactly one item selected → that item; otherwise null. */
export function singleItem(s: Selection): { kind: ItemKind; id: string } | null {
  if (s.clips.length === 1 && s.layers.length === 0) return { kind: "clip", id: s.clips[0] };
  if (s.layers.length === 1 && s.clips.length === 0) return { kind: "layer", id: s.layers[0] };
  return null;
}

export function only(kind: ItemKind, id: string): Selection {
  return kind === "clip" ? { clips: [id], layers: [] } : { clips: [], layers: [id] };
}

/** Click semantics: plain click replaces, modifier click toggles. */
export function selectItem(s: Selection, kind: ItemKind, id: string, additive: boolean): Selection {
  if (!additive) return only(kind, id);
  const list = kind === "clip" ? s.clips : s.layers;
  const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  return kind === "clip" ? { ...s, clips: next } : { ...s, layers: next };
}

export function union(a: Selection, b: Selection): Selection {
  return {
    clips: [...new Set([...a.clips, ...b.clips])],
    layers: [...new Set([...a.layers, ...b.layers])],
  };
}
