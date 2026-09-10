import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "@/types/clip";
import { computeEdl, segmentAt, timelineEnd, type EdlSegment } from "@/lib/timeline";

const BOUNDARY_EPS = 0.03;
const EMIT_INTERVAL_MS = 40;

export interface SequencePlayer {
  /** Callback ref for the single <video>/<audio> element that plays the project. */
  attachElement: (el: HTMLMediaElement | null) => void;
  timelineTime: number;
  playing: boolean;
  duration: number;
  activeClipId: string | null;
  /** True while the playhead is over empty timeline (rendered as black + silence). */
  inGap: boolean;
  segments: EdlSegment[];
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  seekToClip: (clipId: string) => void;
  stepSegment: (delta: 1 | -1) => void;
  /** Live timeline position computed from the element/gap clock (not throttled state). */
  getTimelineTimeNow: () => number;
  /** Clip-local element time if `clipId` is the clip currently loaded, else null. */
  localTimeFor: (clipId: string) => number | null;
}

interface GapClock {
  startedAt: number; // performance.now() when the clock last (re)started
  offset: number; // seconds already elapsed before that
  running: boolean;
}

/**
 * Plays the project through one media element by walking the EDL: each
 * segment is a piece of a clip (element plays its file from srcIn) or a gap
 * (element paused, a wall-clock timer advances the playhead). Exposes a single
 * timeline clock the timeline UI and the audio-layer preview engine key off.
 */
export function useSequencePlayer(clips: Clip[], extendTo = 0): SequencePlayer {
  const elRef = useRef<HTMLMediaElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const clipsRef = useRef(clips);
  const segmentsRef = useRef<EdlSegment[]>([]);
  const durationRef = useRef(0);
  const segIndexRef = useRef(-1);
  const gapRef = useRef<GapClock | null>(null);
  const wantPlayingRef = useRef(false);
  const pendingRef = useRef<{ localTime: number; autoplay: boolean } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);
  const detachRef = useRef<(() => void) | null>(null);

  const [timelineTime, setTimelineTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [inGap, setInGap] = useState(false);

  const segments = useMemo(() => computeEdl(clips, extendTo), [clips, extendTo]);
  const duration = useMemo(() => Math.max(timelineEnd(clips), extendTo), [clips, extendTo]);
  clipsRef.current = clips;
  segmentsRef.current = segments;
  durationRef.current = duration;

  const urlFor = useCallback((clip: Clip) => {
    let url = urls.current.get(clip.id);
    if (!url) {
      url = URL.createObjectURL(clip.file);
      urls.current.set(clip.id, url);
    }
    return url;
  }, []);

  const gapElapsed = (g: GapClock) => g.offset + (g.running ? (performance.now() - g.startedAt) / 1000 : 0);

  const getTimelineTimeNow = useCallback(() => {
    const seg = segmentsRef.current[segIndexRef.current];
    if (!seg) return 0;
    if (!seg.clipId) {
      const g = gapRef.current;
      return seg.start + Math.min(g ? gapElapsed(g) : 0, seg.end - seg.start);
    }
    const el = elRef.current;
    if (!el) return seg.start;
    return seg.start + Math.min(Math.max(el.currentTime - seg.srcIn, 0), seg.end - seg.start);
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const loadSegment = useCallback(
    (index: number, offsetInSeg: number, autoplay: boolean) => {
      const el = elRef.current;
      const segs = segmentsRef.current;
      if (!el || index < 0 || index >= segs.length) return;
      const seg = segs[index];
      segIndexRef.current = index;

      if (!seg.clipId) {
        el.pause();
        pendingRef.current = null;
        gapRef.current = { startedAt: performance.now(), offset: offsetInSeg, running: autoplay };
        setInGap(true);
        setActiveClipId(null);
        return;
      }

      gapRef.current = null;
      setInGap(false);
      const clip = clipsRef.current.find((c) => c.id === seg.clipId)!;
      setActiveClipId(clip.id);
      const url = urlFor(clip);
      const target = seg.srcIn + offsetInSeg;
      if (el.src !== url) {
        pendingRef.current = { localTime: target, autoplay };
        el.src = url;
        el.load();
      } else {
        el.currentTime = target;
        if (autoplay) void el.play().catch(() => {});
        else el.pause();
      }
    },
    [urlFor]
  );

  const finish = useCallback(() => {
    elRef.current?.pause();
    if (gapRef.current) gapRef.current.running = false;
    wantPlayingRef.current = false;
    setPlaying(false);
    setTimelineTime(durationRef.current);
  }, []);

  const frame = useCallback(() => {
    rafRef.current = null;
    const segs = segmentsRef.current;
    const idx = segIndexRef.current;
    const seg = segs[idx];
    if (!seg) return;

    const advance = () => {
      if (idx + 1 < segs.length) loadSegment(idx + 1, 0, wantPlayingRef.current);
      else finish();
    };

    if (!seg.clipId) {
      const g = gapRef.current;
      if (g && gapElapsed(g) >= seg.end - seg.start - BOUNDARY_EPS) {
        advance();
        if (!wantPlayingRef.current) return;
      }
    } else {
      const el = elRef.current;
      // pendingRef guards the gap right after a src swap, when currentTime can
      // still read the previous clip's position and would advance twice.
      if (el && !pendingRef.current && el.currentTime >= seg.srcIn + (seg.end - seg.start) - BOUNDARY_EPS) {
        advance();
        if (!wantPlayingRef.current) return;
      }
    }

    const now = performance.now();
    if (now - lastEmitRef.current >= EMIT_INTERVAL_MS) {
      lastEmitRef.current = now;
      setTimelineTime(getTimelineTimeNow());
    }
    if (wantPlayingRef.current) rafRef.current = requestAnimationFrame(frame);
  }, [loadSegment, finish, getTimelineTimeNow]);

  const play = useCallback(() => {
    const el = elRef.current;
    if (!el || segmentsRef.current.length === 0) return;
    wantPlayingRef.current = true;
    setPlaying(true);
    if (segIndexRef.current < 0 || getTimelineTimeNow() >= durationRef.current - BOUNDARY_EPS) {
      loadSegment(0, 0, true);
    } else if (gapRef.current) {
      gapRef.current = { ...gapRef.current, startedAt: performance.now(), running: true };
    } else {
      void el.play().catch(() => {});
    }
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(frame);
  }, [loadSegment, frame, getTimelineTimeNow]);

  const pause = useCallback(() => {
    wantPlayingRef.current = false;
    setPlaying(false);
    const g = gapRef.current;
    if (g && g.running) gapRef.current = { startedAt: performance.now(), offset: gapElapsed(g), running: false };
    elRef.current?.pause();
    stopLoop();
    setTimelineTime(getTimelineTimeNow());
  }, [stopLoop, getTimelineTimeNow]);

  const toggle = useCallback(() => {
    if (wantPlayingRef.current) pause();
    else play();
  }, [play, pause]);

  const seek = useCallback(
    (t: number) => {
      const segs = segmentsRef.current;
      if (segs.length === 0) return;
      const clamped = Math.min(Math.max(t, 0), durationRef.current);
      const idx = segmentAt(segs, clamped);
      loadSegment(idx, Math.min(clamped - segs[idx].start, segs[idx].end - segs[idx].start), wantPlayingRef.current);
      setTimelineTime(clamped);
    },
    [loadSegment]
  );

  const seekToClip = useCallback(
    (clipId: string) => {
      const clip = clipsRef.current.find((c) => c.id === clipId);
      if (clip) seek(clip.startAt);
    },
    [seek]
  );

  const stepSegment = useCallback(
    (delta: 1 | -1) => {
      const segs = segmentsRef.current;
      if (segs.length === 0) return;
      const target = Math.min(Math.max(segIndexRef.current + delta, 0), segs.length - 1);
      seek(segs[target].start);
    },
    [seek]
  );

  const localTimeFor = useCallback((clipId: string) => {
    const el = elRef.current;
    const seg = segmentsRef.current[segIndexRef.current];
    if (!el || !seg || seg.clipId !== clipId) return null;
    return el.currentTime;
  }, []);

  const attachElement = useCallback(
    (el: HTMLMediaElement | null) => {
      detachRef.current?.();
      detachRef.current = null;
      elRef.current = el;
      if (!el) return;

      const onLoaded = () => {
        const p = pendingRef.current;
        if (!p) return;
        pendingRef.current = null;
        el.currentTime = p.localTime;
        if (p.autoplay) void el.play().catch(() => {});
        setTimelineTime(getTimelineTimeNow());
      };
      el.addEventListener("loadedmetadata", onLoaded);
      detachRef.current = () => el.removeEventListener("loadedmetadata", onLoaded);

      if (segIndexRef.current < 0 && segmentsRef.current.length > 0) loadSegment(0, 0, false);
    },
    [getTimelineTimeNow, loadSegment]
  );

  // Clips changed (add/remove/move/trim): release URLs of removed clips and
  // re-resolve the current position against the new EDL.
  useEffect(() => {
    const ids = new Set(clips.map((c) => c.id));
    for (const [id, url] of urls.current) {
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        urls.current.delete(id);
      }
    }
    const el = elRef.current;
    if (!el) return;

    if (segments.length === 0) {
      segIndexRef.current = -1;
      gapRef.current = null;
      setActiveClipId(null);
      setInGap(false);
      wantPlayingRef.current = false;
      setPlaying(false);
      stopLoop();
      el.removeAttribute("src");
      el.load();
      setTimelineTime(0);
      return;
    }

    const t = segIndexRef.current < 0 ? 0 : Math.min(getTimelineTimeNow(), duration);
    const idx = segmentAt(segments, t);
    const seg = segments[idx];
    const offset = Math.min(Math.max(t - seg.start, 0), seg.end - seg.start);
    // Only reload when the resolved segment actually differs from what's playing.
    const current = segmentsRef.current[segIndexRef.current];
    const same =
      current && seg.clipId === current.clipId && seg.clipId !== null &&
      Math.abs(seg.srcIn + offset - (elRef.current?.currentTime ?? -1)) < 0.25;
    if (!same) loadSegment(idx, offset, wantPlayingRef.current);
    else segIndexRef.current = idx;
    setTimelineTime(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments]);

  useEffect(
    () => () => {
      stopLoop();
      detachRef.current?.();
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      urls.current.clear();
    },
    [stopLoop]
  );

  return {
    attachElement,
    timelineTime,
    playing,
    duration,
    activeClipId,
    inGap,
    segments,
    play,
    pause,
    toggle,
    seek,
    seekToClip,
    stepSegment,
    getTimelineTimeNow,
    localTimeFor,
  };
}
