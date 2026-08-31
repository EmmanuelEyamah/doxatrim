import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";

interface MediaPlayerProps {
  src: string;
  type: "video" | "audio";
  poster?: string;
  trimRange?: { inPoint: number; outPoint: number };
  className?: string;
}

function mergeRefs<T>(...refs: Array<React.Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as React.RefObject<T | null>).current = node;
    }
  };
}

export const MediaPlayer = forwardRef<HTMLVideoElement | HTMLAudioElement, MediaPlayerProps>(
  ({ src, type, poster, trimRange, className }, forwardedRef) => {
    const localRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [muted, setMuted] = useState(false);
    const mediaRef = useMemo(
      () => mergeRefs(localRef, forwardedRef),
      [forwardedRef]
    );

    useEffect(() => {
      const el = localRef.current;
      if (!el) return;
      const onTimeUpdate = () => setCurrentTime(el.currentTime);
      const onLoadedMetadata = () => setDuration(el.duration || 0);
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);

      el.addEventListener("timeupdate", onTimeUpdate);
      el.addEventListener("loadedmetadata", onLoadedMetadata);
      el.addEventListener("play", onPlay);
      el.addEventListener("pause", onPause);

      // Blob URLs can finish loading metadata before this effect attaches its
      // listeners (no network round-trip), so the event never fires here —
      // sync from readyState immediately in case that already happened.
      if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
        onLoadedMetadata();
        onTimeUpdate();
      }
      setPlaying(!el.paused);

      return () => {
        el.removeEventListener("timeupdate", onTimeUpdate);
        el.removeEventListener("loadedmetadata", onLoadedMetadata);
        el.removeEventListener("play", onPlay);
        el.removeEventListener("pause", onPause);
      };
    }, [src]);

    const togglePlay = () => {
      const el = localRef.current;
      if (!el) return;
      if (el.paused) {
        el.play().catch((err: unknown) => {
          console.error("Playback failed:", err);
        });
      } else {
        el.pause();
      }
    };

    const toggleMute = () => {
      const el = localRef.current;
      if (!el) return;
      el.muted = !el.muted;
      setMuted(el.muted);
    };

    const seek = (time: number) => {
      const el = localRef.current;
      if (!el) return;
      el.currentTime = time;
      setCurrentTime(time);
    };

    const toggleFullscreen = () => {
      const el = containerRef.current;
      if (!el) return;
      if (document.fullscreenElement) void document.exitFullscreen();
      else void el.requestFullscreen();
    };

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
      <div
        ref={containerRef}
        className={cn(
          "flex flex-col gap-3 overflow-hidden rounded-xl border border-border bg-card p-3",
          className
        )}
      >
        {type === "video" ? (
          <video
            ref={mediaRef}
            src={src}
            poster={poster}
            preload="metadata"
            onClick={togglePlay}
            className="max-h-96 w-full cursor-pointer rounded-lg bg-black object-contain"
          />
        ) : (
          <audio ref={mediaRef} src={src} className="hidden" />
        )}

        <div className="flex items-center gap-3">
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

          <span className="w-12 shrink-0 text-xs text-muted-foreground">
            {formatTime(currentTime)}
          </span>

          <div
            className="relative h-1.5 flex-1 cursor-pointer rounded-full bg-muted"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const ratio = (e.clientX - rect.left) / rect.width;
              seek(ratio * duration);
            }}
          >
            {trimRange && duration > 0 && (
              <div
                className="absolute h-1.5 rounded-full bg-primary/25"
                style={{
                  left: `${(trimRange.inPoint / duration) * 100}%`,
                  right: `${100 - (trimRange.outPoint / duration) * 100}%`,
                }}
              />
            )}
            <div
              className="absolute h-1.5 rounded-full bg-primary"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow"
              style={{ left: `${progress}%` }}
            />
          </div>

          <span className="w-12 shrink-0 text-xs text-muted-foreground">
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

          {type === "video" && (
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
      </div>
    );
  }
);

MediaPlayer.displayName = "MediaPlayer";
