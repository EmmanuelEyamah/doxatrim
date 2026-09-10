import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Clip } from "@/types/clip";
import { mainClipRanges, timelineEnd } from "@/lib/timeline";

const BOUNDARY_EPS = 0.03;
const EMIT_INTERVAL_MS = 40;

export interface SequencePlayer {
  /** Callback ref for the single <video>/<audio> element that plays the project. */
  attachElement: (el: HTMLMediaElement | null) => void;
  timelineTime: number;
  playing: boolean;
  duration: number;
  activeClipId: string | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  seekToClip: (clipId: string) => void;
  stepClip: (delta: 1 | -1) => void;
  /** Live timeline position computed from the element (not throttled state). */
  getTimelineTimeNow: () => number;
  /** Clip-local element time if `clipId` is the clip currently loaded, else null. */
  localTimeFor: (clipId: string) => number | null;
}

/**
 * Drives the project timeline through one media element: plays main clips
 * back to back (each from its inPoint to its outPoint), swapping the
 * element's source at clip boundaries, and exposes a single timeline clock
 * that the timeline UI and the audio-layer preview engine key off.
 */
export function useSequencePlayer(clips: Clip[]): SequencePlayer {
  const elRef = useRef<HTMLMediaElement | null>(null);
  const urls = useRef(new Map<string, string>());
  const clipsRef = useRef(clips);
  const rangesRef = useRef(mainClipRanges(clips));
  const durationRef = useRef(timelineEnd(clips));
  const activeIndexRef = useRef(-1);
  const wantPlayingRef = useRef(false);
  const pendingRef = useRef<{ localTime: number; autoplay: boolean } | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastEmitRef = useRef(0);
  const detachRef = useRef<(() => void) | null>(null);

  const [timelineTime, setTimelineTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);

  const ranges = useMemo(() => mainClipRanges(clips), [clips]);
  const duration = useMemo(() => timelineEnd(clips), [clips]);
  clipsRef.current = clips;
  rangesRef.current = ranges;
  durationRef.current = duration;

  const urlFor = useCallback((clip: Clip) => {
    let url = urls.current.get(clip.id);
    if (!url) {
      url = URL.createObjectURL(clip.file);
      urls.current.set(clip.id, url);
    }
    return url;
  }, []);

  const getTimelineTimeNow = useCallback(() => {
    const el = elRef.current;
    const idx = activeIndexRef.current;
    const cs = clipsRef.current;
    if (!el || idx < 0 || idx >= cs.length) return 0;
    const clip = cs[idx];
    const local = Math.min(Math.max(el.currentTime - clip.inPoint, 0), clip.outPoint - clip.inPoint);
    return rangesRef.current[idx].start + local;
  }, []);

  const stopLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const loadClip = useCallback(
    (index: number, localTime: number, autoplay: boolean) => {
      const el = elRef.current;
      const cs = clipsRef.current;
      if (!el || index < 0 || index >= cs.length) return;
      const clip = cs[index];
      const url = urlFor(clip);
      activeIndexRef.current = index;
      setActiveClipId(clip.id);
      if (el.src !== url) {
        pendingRef.current = { localTime, autoplay };
        el.src = url;
        el.load();
      } else {
        el.currentTime = localTime;
        if (autoplay) void el.play().catch(() => {});
        else el.pause();
      }
    },
    [urlFor]
  );

  const frame = useCallback(() => {
    rafRef.current = null;
    const el = elRef.current;
    const cs = clipsRef.current;
    const idx = activeIndexRef.current;
    if (!el || idx < 0 || idx >= cs.length) return;
    const clip = cs[idx];

    // pendingRef guards the gap right after a src swap, when currentTime can
    // still read the previous clip's position and would advance twice.
    if (!pendingRef.current && el.currentTime >= clip.outPoint - BOUNDARY_EPS) {
      if (idx + 1 < cs.length) {
        loadClip(idx + 1, cs[idx + 1].inPoint, true);
      } else {
        el.pause();
        wantPlayingRef.current = false;
        setPlaying(false);
        setTimelineTime(durationRef.current);
        return;
      }
    }

    const now = performance.now();
    if (now - lastEmitRef.current >= EMIT_INTERVAL_MS) {
      lastEmitRef.current = now;
      setTimelineTime(getTimelineTimeNow());
    }
    if (wantPlayingRef.current) rafRef.current = requestAnimationFrame(frame);
  }, [loadClip, getTimelineTimeNow]);

  const play = useCallback(() => {
    const el = elRef.current;
    const cs = clipsRef.current;
    if (!el || cs.length === 0) return;
    wantPlayingRef.current = true;
    setPlaying(true);
    if (activeIndexRef.current < 0 || getTimelineTimeNow() >= durationRef.current - BOUNDARY_EPS) {
      loadClip(0, cs[0].inPoint, true);
    } else {
      void el.play().catch(() => {});
    }
    if (rafRef.current == null) rafRef.current = requestAnimationFrame(frame);
  }, [loadClip, frame, getTimelineTimeNow]);

  const pause = useCallback(() => {
    wantPlayingRef.current = false;
    setPlaying(false);
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
      const cs = clipsRef.current;
      const rs = rangesRef.current;
      if (cs.length === 0) return;
      const clamped = Math.min(Math.max(t, 0), durationRef.current);
      let idx = rs.findIndex((r) => clamped >= r.start && clamped < r.end);
      if (idx === -1) idx = cs.length - 1;
      const clip = cs[idx];
      const local = clip.inPoint + Math.min(clamped - rs[idx].start, clip.outPoint - clip.inPoint);
      loadClip(idx, local, wantPlayingRef.current);
      setTimelineTime(clamped);
    },
    [loadClip]
  );

  const seekToClip = useCallback(
    (clipId: string) => {
      const idx = clipsRef.current.findIndex((c) => c.id === clipId);
      if (idx !== -1) seek(rangesRef.current[idx].start);
    },
    [seek]
  );

  const stepClip = useCallback(
    (delta: 1 | -1) => {
      const cs = clipsRef.current;
      if (cs.length === 0) return;
      const target = Math.min(Math.max(activeIndexRef.current + delta, 0), cs.length - 1);
      seek(rangesRef.current[target].start);
    },
    [seek]
  );

  const localTimeFor = useCallback((clipId: string) => {
    const el = elRef.current;
    const idx = activeIndexRef.current;
    if (!el || idx < 0 || clipsRef.current[idx]?.id !== clipId) return null;
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

      if (activeIndexRef.current < 0 && clipsRef.current.length > 0) {
        loadClip(0, clipsRef.current[0].inPoint, false);
      }
    },
    [getTimelineTimeNow, loadClip]
  );

  // React to clips changing (add/remove/reorder/trim): keep the active clip by
  // id, release object URLs for removed clips, and reset when the sequence empties.
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

    if (clips.length === 0) {
      activeIndexRef.current = -1;
      setActiveClipId(null);
      wantPlayingRef.current = false;
      setPlaying(false);
      stopLoop();
      el.removeAttribute("src");
      el.load();
      setTimelineTime(0);
      return;
    }

    const idx = activeClipId ? clips.findIndex((c) => c.id === activeClipId) : -1;
    if (idx === -1) {
      wantPlayingRef.current = false;
      setPlaying(false);
      stopLoop();
      loadClip(0, clips[0].inPoint, false);
      setTimelineTime(0);
    } else {
      activeIndexRef.current = idx;
      if (!wantPlayingRef.current) setTimelineTime(getTimelineTimeNow());
    }
  }, [clips, activeClipId, loadClip, stopLoop, getTimelineTimeNow]);

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
    play,
    pause,
    toggle,
    seek,
    seekToClip,
    stepClip,
    getTimelineTimeNow,
    localTimeFor,
  };
}
