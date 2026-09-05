import type { ClipType } from "@/types/clip";

export function readMediaDuration(file: File, type: ClipType): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(type === "video" ? "video" : "audio");
    const url = URL.createObjectURL(file);
    let settled = false;

    const finish = (duration: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(duration) ? duration : 0);
    };

    el.preload = "metadata";
    el.src = url;

    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) {
        finish(el.duration);
        return;
      }
      // Some encodes (notably MP3s without a Xing/LAME header — including
      // ffmpeg's default output, which is what yt-dlp's audio extraction
      // produces) report duration as Infinity/NaN until the browser is
      // forced to seek. This is the standard workaround; without it this
      // promise would otherwise hang forever on those files.
      el.currentTime = Number.MAX_SAFE_INTEGER;
      el.ontimeupdate = () => {
        el.ontimeupdate = null;
        el.currentTime = 0;
        finish(el.duration);
      };
    };

    el.onerror = () => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      reject(new Error(`Could not read metadata for ${file.name}`));
    };

    // Absolute fallback — never let an import hang indefinitely on a file
    // with unusual/missing metadata.
    setTimeout(() => finish(el.duration), 8000);
  });
}

export function generateVideoThumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.muted = true;
    video.src = url;

    video.onloadeddata = () => {
      video.currentTime = Math.min(1, (video.duration || 1) / 2);
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth || 160;
        canvas.height = video.videoHeight || 90;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(undefined);
          return;
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.7));
      } catch {
        resolve(undefined);
      } finally {
        URL.revokeObjectURL(url);
      }
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(undefined);
    };
  });
}
