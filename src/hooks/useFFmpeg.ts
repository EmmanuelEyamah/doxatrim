import { useEffect, useState } from "react";
import type { FFmpeg, ProgressEvent } from "@ffmpeg/ffmpeg";
import { getFFmpeg } from "@/lib/ffmpeg/instance";

interface UseFFmpegResult {
  ffmpeg: FFmpeg | null;
  loaded: boolean;
  loading: boolean;
  progress: number;
  error: string | null;
}

/** Binds a component to the shared ffmpeg core: load state plus live job progress. */
export function useFFmpeg(): UseFFmpegResult {
  const [ffmpeg, setFFmpeg] = useState<FFmpeg | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let attached: FFmpeg | null = null;
    const onProgress = ({ progress: p }: ProgressEvent) => {
      if (!cancelled) setProgress(p);
    };

    getFFmpeg()
      .then((ff) => {
        if (cancelled) return;
        attached = ff;
        ff.on("progress", onProgress);
        setFFmpeg(ff);
        setLoading(false);
      })
      .catch((err: unknown) => {
        console.error("ffmpeg load failed:", err);
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
        setError(message || "Failed to load ffmpeg (see console for details)");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      attached?.off("progress", onProgress);
    };
  }, []);

  return { ffmpeg, loaded: ffmpeg !== null, loading, progress, error };
}
