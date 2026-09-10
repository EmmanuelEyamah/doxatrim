import { useCallback, useEffect, useRef } from "react";
import { MixPreviewEngine } from "@/lib/audioEngine";
import type { AudioLayer } from "@/types/audioLayer";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";

export interface MixPreview {
  /** Callback ref for the main media element, so its audio runs through the mix graph. */
  attachMain: (el: HTMLMediaElement | null) => void;
  /** Call synchronously inside the play click, before `player.play()`. */
  unlock: () => void;
}

/** Binds the Web Audio preview engine to the sequence player's clock and the layer store. */
export function useMixPreview(
  player: SequencePlayer,
  layers: AudioLayer[],
  mainVolume: number,
  timelineEnd: number
): MixPreview {
  const engineRef = useRef<MixPreviewEngine | null>(null);
  if (!engineRef.current) engineRef.current = new MixPreviewEngine();
  const engine = engineRef.current;

  useEffect(() => () => engine.destroy(), [engine]);

  useEffect(() => {
    engine.syncLayers(layers, timelineEnd);
    engine.sync(player.getTimelineTimeNow(), player.playing);
  }, [engine, layers, timelineEnd, player.playing, player.getTimelineTimeNow]);

  useEffect(() => {
    engine.setMainVolume(mainVolume);
  }, [engine, mainVolume]);

  // Throttled state updates cover pause/seek; the per-frame loop below keeps
  // loop wraps and play-once stops tight while playing.
  useEffect(() => {
    engine.sync(player.timelineTime, player.playing);
  }, [engine, player.timelineTime, player.playing]);

  useEffect(() => {
    if (!player.playing) return;
    let raf = 0;
    const loop = () => {
      engine.sync(player.getTimelineTimeNow(), true);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, player.playing, player.getTimelineTimeNow]);

  const attachMain = useCallback((el: HTMLMediaElement | null) => engine.attachMain(el), [engine]);
  const unlock = useCallback(() => engine.unlock(), [engine]);

  return { attachMain, unlock };
}
