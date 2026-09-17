import type { Clip } from "@/types/clip";
import type { AudioLayer } from "@/types/audioLayer";

const EPS = 1e-4;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const clipLength = (c: Clip) => c.outPoint - c.inPoint;
export const clipEnd = (c: Clip) => c.startAt + clipLength(c);

/** Where the last video clip ends. */
export function timelineEnd(clips: Clip[]): number {
  return clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/**
 * Where the project ends: the last clip, or a later audio layer that has a
 * definite extent (an explicit End, or a play-once file). Loop-to-fill layers
 * without an End fill whatever the timeline is and never extend it.
 */
export function projectEnd(clips: Clip[], layers: AudioLayer[]): number {
  let end = timelineEnd(clips);
  for (const l of layers) {
    const segment = l.outPoint - l.inPoint;
    const own = l.endAt != null ? l.endAt : l.loop ? 0 : l.startAt + segment;
    end = Math.max(end, own);
  }
  return end;
}

export function trackCount(clips: Clip[]): number {
  return clips.reduce((max, c) => Math.max(max, c.track + 1), 1);
}

/** Where the next appended clip should go on a track: right after the last clip there. */
export function nextFreeStart(clips: Clip[], track: number): number {
  return clips.filter((c) => c.track === track).reduce((max, c) => Math.max(max, clipEnd(c)), 0);
}

/**
 * The clip that is visible at time `t`: highest track wins where clips
 * overlap; on the same track the one that started later wins (a cut).
 */
export function topClipAt(clips: Clip[], t: number): Clip | null {
  let best: Clip | null = null;
  for (const c of clips) {
    if (t < c.startAt - EPS || t >= clipEnd(c) - EPS) continue;
    if (!best || c.track > best.track || (c.track === best.track && c.startAt > best.startAt)) best = c;
  }
  return best;
}

/** One contiguous stretch of the rendered timeline: a piece of a clip, or a gap (black + silence). */
export interface EdlSegment {
  start: number;
  end: number;
  clipId: string | null;
  srcIn: number; // source-local seconds where this piece begins (clip segments only)
}

/**
 * Resolves positioned, possibly overlapping clips into the flat sequence the
 * player and the exporter actually play: cut points at every clip start/end,
 * the top clip between each pair, gaps where nothing is placed.
 */
export function computeEdl(clips: Clip[], extendTo = 0): EdlSegment[] {
  const points = new Set<number>([0]);
  for (const c of clips) {
    points.add(round3(c.startAt));
    points.add(round3(clipEnd(c)));
  }
  // Audio layers may run past the last clip: the timeline continues as a gap.
  if (extendTo > 0) points.add(round3(extendTo));
  if (points.size < 2) return [];
  const sorted = [...points].sort((a, b) => a - b);
  const segments: EdlSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (end - start < EPS) continue;
    const top = topClipAt(clips, start + (end - start) / 2);
    if (!top) {
      segments.push({ start, end, clipId: null, srcIn: 0 });
      continue;
    }
    const srcIn = top.inPoint + (start - top.startAt);
    const prev = segments[segments.length - 1];
    const continuesPrev =
      prev &&
      prev.clipId === top.id &&
      Math.abs(prev.end - start) < EPS &&
      Math.abs(prev.srcIn + (prev.end - prev.start) - srcIn) < 1e-3;
    if (continuesPrev) prev.end = end;
    else segments.push({ start, end, clipId: top.id, srcIn });
  }
  return segments;
}

/**
 * The part of an EDL between `start` and `end`, re-based so `start` becomes 0.
 * Used to export just a marked range of a long project.
 */
export function sliceEdl(segments: EdlSegment[], start: number, end: number): EdlSegment[] {
  const out: EdlSegment[] = [];
  for (const seg of segments) {
    const a = Math.max(seg.start, start);
    const b = Math.min(seg.end, end);
    if (b - a < EPS) continue;
    out.push({
      start: round3(a - start),
      end: round3(b - start),
      clipId: seg.clipId,
      srcIn: seg.clipId ? seg.srcIn + (a - seg.start) : 0,
    });
  }
  return out;
}

/**
 * Audio layers as they play inside [start, end], re-based so `start` is 0 —
 * each keeps the exact sound it made at that point of the full project. A
 * looped layer entered mid-cycle becomes a play-once head (the rest of that
 * cycle) followed by the loop proper, so its phase is preserved.
 */
export function sliceLayers(layers: AudioLayer[], start: number, end: number, projectEnd: number): AudioLayer[] {
  const out: AudioLayer[] = [];
  for (const l of layers) {
    const segment = l.outPoint - l.inPoint;
    if (segment <= EPS) continue;
    const span = layerSpan(l, projectEnd);
    const a = Math.max(l.startAt, start);
    const b = Math.min(l.startAt + span, end);
    if (b - a < 0.01) continue;
    const offset = a - l.startAt; // how far into the layer the range enters it
    const localStart = a - start;
    const localEnd = b - start;

    if (!l.loop) {
      out.push({ ...l, inPoint: l.inPoint + offset, startAt: localStart, endAt: localEnd, loop: false });
      continue;
    }

    const phase = offset % segment;
    const headLength = Math.min(segment - phase, localEnd - localStart);
    if (phase > EPS) {
      out.push({ ...l, id: `${l.id}:head`, inPoint: l.inPoint + phase, startAt: localStart, endAt: localStart + headLength, loop: false });
    }
    const loopStart = phase > EPS ? localStart + headLength : localStart;
    if (localEnd - loopStart > 0.01) {
      out.push({ ...l, startAt: loopStart, endAt: localEnd, loop: true });
    }
  }
  return out;
}

export function segmentAt(segments: EdlSegment[], t: number): number {
  const idx = segments.findIndex((s) => t >= s.start && t < s.end);
  return idx === -1 ? Math.max(0, segments.length - 1) : idx;
}

/** How long a layer occupies on the timeline, given the timeline's end. */
export function layerSpan(layer: AudioLayer, end: number): number {
  const remaining = end - layer.startAt;
  if (remaining <= 0) return 0;
  const untilEndAt = layer.endAt == null ? Infinity : layer.endAt - layer.startAt;
  const span = layer.loop
    ? Math.min(untilEndAt, remaining)
    : Math.min(layer.outPoint - layer.inPoint, untilEndAt, remaining);
  return Math.max(0, span);
}

export function isLayerActive(layer: AudioLayer, end: number): boolean {
  return !layer.muted && layer.outPoint - layer.inPoint > 0.01 && layerSpan(layer, end) > 0.01;
}

/** The visible clip at `t` and the matching source-local time. */
export function timelineToClipLocal(clips: Clip[], t: number): { clipId: string; localTime: number } | null {
  const clip = topClipAt(clips, t);
  if (!clip) return null;
  const offset = Math.min(Math.max(t - clip.startAt, 0), clipLength(clip));
  return { clipId: clip.id, localTime: clip.inPoint + offset };
}

export function clipLocalToTimeline(clips: Clip[], clipId: string, localTime: number): number {
  const clip = clips.find((c) => c.id === clipId);
  if (!clip) return 0;
  return clip.startAt + Math.min(Math.max(localTime - clip.inPoint, 0), clipLength(clip));
}

export interface MeasuredTimeline {
  actualEnd: number;
  /** Maps an in-app (ideal) timeline time to the exported file's timeline. */
  toActual: (t: number) => number;
}

/**
 * Exported segments are trimmed with stream copy, which snaps a segment's head
 * to the previous keyframe — so it can run longer than intended, with the
 * extra lead-in at its start. Given each segment's measured length, this maps
 * ideal timeline times onto the export's timeline so audio layers land where
 * they were placed on screen.
 */
export function measuredTimeline(segments: EdlSegment[], measuredDurations: number[]): MeasuredTimeline {
  const actualStarts: number[] = [];
  const heads: number[] = [];
  let cursor = 0;
  segments.forEach((s, k) => {
    const ideal = s.end - s.start;
    const measured = measuredDurations[k] ?? ideal;
    actualStarts.push(cursor);
    heads.push(Math.max(0, measured - ideal));
    cursor += measured;
  });
  const actualEnd = cursor;

  const toActual = (t: number) => {
    if (segments.length === 0) return 0;
    const last = segments[segments.length - 1];
    if (t >= last.end) return actualEnd;
    let k = segments.findIndex((s) => t >= s.start && t < s.end);
    if (k === -1) k = t < 0 ? 0 : segments.length - 1;
    const offset = Math.min(Math.max(t - segments[k].start, 0), segments[k].end - segments[k].start);
    return actualStarts[k] + heads[k] + offset;
  };

  return { actualEnd, toActual };
}
