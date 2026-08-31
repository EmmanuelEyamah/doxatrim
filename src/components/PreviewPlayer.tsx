import { forwardRef, useEffect, useState } from "react";
import { MediaPlayer } from "@/components/MediaPlayer";
import type { Clip } from "@/types/clip";

interface PreviewPlayerProps {
  clip: Clip;
}

export const PreviewPlayer = forwardRef<HTMLVideoElement | HTMLAudioElement, PreviewPlayerProps>(
  ({ clip }, ref) => {
    const [src, setSrc] = useState<string | null>(null);

    // Create and revoke the object URL in the same effect. If React (e.g.
    // StrictMode's dev-only double-invoke) tears this down and re-runs it,
    // this regenerates a fresh, valid URL instead of leaving a revoked one
    // behind on the <video>/<audio> element.
    useEffect(() => {
      const url = URL.createObjectURL(clip.file);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }, [clip.file]);

    if (!src) return null;

    return (
      <MediaPlayer
        ref={ref}
        src={src}
        type={clip.type}
        poster={clip.thumbnailUrl}
        trimRange={{ inPoint: clip.inPoint, outPoint: clip.outPoint }}
      />
    );
  }
);

PreviewPlayer.displayName = "PreviewPlayer";
