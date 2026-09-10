import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AudioLines,
  Maximize,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import { mainClipRanges } from "@/lib/timeline";
import type { Clip } from "@/types/clip";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";

interface SequencePreviewProps {
  clips: Clip[];
  player: SequencePlayer;
  attachMain: (el: HTMLMediaElement | null) => void;
  onBeforePlay: () => void;
  className?: string;
}

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** The project monitor: one player that runs the whole sequence, with transport. */
export const SequencePreview = ({ clips, player, attachMain, onBeforePlay, className }: SequencePreviewProps) => {
  const [muted, setMuted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const elRef = useRef<HTMLMediaElement | null>(null);
  const projectType = clips[0]?.type ?? "video";
  const activeClip = clips.find((c) => c.id === player.activeClipId) ?? clips[0];
  const ranges = mainClipRanges(clips);
  const { attachElement, playing, timelineTime, duration } = player;

  const mediaRef = useCallback(
    (el: HTMLMediaElement | null) => {
      elRef.current = el;
      attachElement(el);
      attachMain(el);
    },
    [attachElement, attachMain]
  );

  const togglePlay = useCallback(() => {
    if (playing) {
      player.pause();
    } else {
      onBeforePlay();
      player.play();
    }
  }, [playing, player, onBeforePlay]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget(e.target)) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  const toggleMute = () => {
    const el = elRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen();
  };

  const progress = duration > 0 ? (timelineTime / duration) * 100 : 0;

  return (
    <motion.div
      ref={containerRef}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className={cn("flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-3", className)}
    >
      <div className="relative flex aspect-video max-h-[60vh] w-full items-center justify-center overflow-hidden rounded-lg bg-black">
        {projectType === "video" ? (
          <video
            ref={mediaRef}
            preload="auto"
            playsInline
            poster={activeClip?.thumbnailUrl}
            onClick={togglePlay}
            className="h-full w-full cursor-pointer object-contain"
          />
        ) : (
          <>
            <audio ref={mediaRef} preload="auto" className="hidden" />
            <AudioLines size={48} className="text-primary/60" />
          </>
        )}
        {clips.length === 0 && (
          <p className="absolute text-xs text-muted-foreground">Import a clip to start</p>
        )}
      </div>

      <div className="flex items-center gap-2">
        <motion.button
          type="button"
          onClick={() => player.stepClip(-1)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Previous clip"
        >
          <SkipBack size={16} />
        </motion.button>
        <motion.button
          type="button"
          onClick={togglePlay}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </motion.button>
        <motion.button
          type="button"
          onClick={() => player.stepClip(1)}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label="Next clip"
        >
          <SkipForward size={16} />
        </motion.button>

        <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
          {formatTime(timelineTime)}
        </span>

        <div
          className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-muted"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            player.seek(((e.clientX - rect.left) / rect.width) * duration);
          }}
        >
          {ranges.slice(1).map((r) => (
            <div
              key={r.id}
              className="absolute top-0 h-1.5 w-px bg-foreground/40"
              style={{ left: `${(r.start / duration) * 100}%` }}
            />
          ))}
          <div className="absolute h-1.5 rounded-full bg-primary" style={{ width: `${progress}%` }} />
          <div
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow"
            style={{ left: `${progress}%` }}
          />
        </div>

        <span className="w-20 shrink-0 text-right font-mono text-xs text-muted-foreground">
          {formatTime(duration)}
        </span>

        <motion.button
          type="button"
          onClick={toggleMute}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </motion.button>

        {projectType === "video" && (
          <motion.button
            type="button"
            onClick={toggleFullscreen}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Fullscreen"
          >
            <Maximize size={16} />
          </motion.button>
        )}
      </div>
    </motion.div>
  );
};
