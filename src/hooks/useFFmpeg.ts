import { useEffect, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { loadFFmpeg } from "@/lib/ffmpeg/loadFFmpeg";

interface UseFFmpegResult {
  ffmpeg: FFmpeg | null;
  loaded: boolean;
  loading: boolean;
  progress: number;
  error: string | null;
}

export function useFFmpeg(): UseFFmpegResult {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ffmpeg = new FFmpeg();
    ffmpegRef.current = ffmpeg;

    ffmpeg.on("progress", ({ progress: p }) => {
      if (!cancelled) setProgress(p);
    });

    setLoading(true);
    loadFFmpeg(ffmpeg)
      .then(() => {
        if (!cancelled) {
          setLoaded(true);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        console.error("ffmpeg load failed:", err);
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : JSON.stringify(err, Object.getOwnPropertyNames(err ?? {}));
          setError(message || "Failed to load ffmpeg (see console for details)");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      ffmpeg.terminate();
      ffmpegRef.current = null;
    };
  }, []);

  return { ffmpeg: ffmpegRef.current, loaded, loading, progress, error };
}
