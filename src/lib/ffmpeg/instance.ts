import { FFmpeg } from "@ffmpeg/ffmpeg";
import { loadFFmpeg } from "@/lib/ffmpeg/loadFFmpeg";

let instance: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

/** One ffmpeg core for the whole app (export, bounce-to-audio, …), loaded on first use. */
export function getFFmpeg(): Promise<FFmpeg> {
  if (instance) return Promise.resolve(instance);
  if (!loading) {
    const ff = new FFmpeg();
    loading = loadFFmpeg(ff)
      .then(() => {
        instance = ff;
        return ff;
      })
      .catch((err) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}
