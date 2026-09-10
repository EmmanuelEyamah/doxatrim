import type { Clip } from "@/types/clip";
import type { AudioLayer } from "@/types/audioLayer";

export interface ClipRange {
  id: string;
  start: number;
  end: number;
}

/** Total length of the project timeline: main clips play back to back, trimmed. */
export function timelineEnd(clips: Clip[]): number {
  return clips.reduce((sum, c) => sum + (c.outPoint - c.inPoint), 0);
}

/** Where each main clip sits on the timeline, in order. */
export function mainClipRanges(clips: Clip[]): ClipRange[] {
  let cursor = 0;
  return clips.map((c) => {
    const start = cursor;
    cursor += c.outPoint - c.inPoint;
    return { id: c.id, start, end: cursor };
  });
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

export function timelineToClipLocal(
  clips: Clip[],
  t: number
): { clipId: string; localTime: number } | null {
  const ranges = mainClipRanges(clips);
  const range = ranges.find((r) => t >= r.start && t < r.end) ?? ranges.at(-1);
  if (!range) return null;
  const clip = clips.find((c) => c.id === range.id)!;
  const offset = Math.min(Math.max(t - range.start, 0), clip.outPoint - clip.inPoint);
  return { clipId: clip.id, localTime: clip.inPoint + offset };
}

export interface MeasuredTimeline {
  actualEnd: number;
  /** Maps an in-app (ideal) timeline time to the exported file's timeline. */
  toActual: (t: number) => number;
}

/**
 * Main clips are trimmed with stream copy, which snaps each segment's head to
 * the previous keyframe — so an exported segment can run longer than the
 * in-app trim, with the extra lead-in at its start. Given each segment's
 * measured length, this maps ideal timeline times onto the export's timeline
 * so audio layers land where they were placed on screen.
 */
export function measuredTimeline(clips: Clip[], measuredDurations: number[]): MeasuredTimeline {
  const ideal = mainClipRanges(clips);
  const actualStarts: number[] = [];
  const heads: number[] = [];
  let cursor = 0;
  clips.forEach((c, k) => {
    const idealLength = c.outPoint - c.inPoint;
    const measured = measuredDurations[k] ?? idealLength;
    actualStarts.push(cursor);
    heads.push(Math.max(0, measured - idealLength));
    cursor += measured;
  });
  const actualEnd = cursor;

  const toActual = (t: number) => {
    if (clips.length === 0) return 0;
    if (t >= ideal[ideal.length - 1].end) return actualEnd;
    let k = ideal.findIndex((r) => t >= r.start && t < r.end);
    if (k === -1) k = t < 0 ? 0 : ideal.length - 1;
    const offset = Math.min(Math.max(t - ideal[k].start, 0), clips[k].outPoint - clips[k].inPoint);
    return actualStarts[k] + heads[k] + offset;
  };

  return { actualEnd, toActual };
}

export function clipLocalToTimeline(clips: Clip[], clipId: string, localTime: number): number {
  const clip = clips.find((c) => c.id === clipId);
  const range = mainClipRanges(clips).find((r) => r.id === clipId);
  if (!clip || !range) return 0;
  return range.start + Math.min(Math.max(localTime - clip.inPoint, 0), clip.outPoint - clip.inPoint);
}
