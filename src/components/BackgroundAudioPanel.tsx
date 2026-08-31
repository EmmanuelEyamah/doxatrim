import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Music, Trash2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { useBackgroundAudioStore } from "@/stores/useBackgroundAudioStore";
import { useClipStore } from "@/stores/useClipStore";
import { readMediaDuration } from "@/lib/media";
import { MediaPlayer } from "@/components/MediaPlayer";
import { TrimEditor } from "@/components/TrimEditor";

const ACCEPTED_EXTENSIONS = ["mp3", "wav", "m4a"];

export const BackgroundAudioPanel = () => {
  const clips = useClipStore((s) => s.clips);
  const {
    file,
    duration,
    inPoint,
    outPoint,
    volume,
    mainVolume,
    setFile,
    clear,
    setTrim,
    setVolume,
    setMainVolume,
  } = useBackgroundAudioStore();
  const [importing, setImporting] = useState(false);
  const [src, setSrc] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);

  // Only relevant once there's a main timeline to mix against.
  if (clips.length === 0) return null;

  const handleFile = async (fileList: FileList | null) => {
    const selected = fileList?.[0];
    if (!selected) return;
    const ext = selected.name.split(".").pop()?.toLowerCase();
    if (!ext || !ACCEPTED_EXTENSIONS.includes(ext)) {
      toast.error("Background track must be mp3, wav, or m4a");
      return;
    }

    setImporting(true);
    try {
      const dur = await readMediaDuration(selected, "audio");
      setFile(selected, dur);
      setSrc(URL.createObjectURL(selected));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to read audio file");
    } finally {
      setImporting(false);
    }
  };

  const handleRemove = () => {
    if (src) URL.revokeObjectURL(src);
    setSrc(null);
    clear();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
    >
      <p className="text-sm font-semibold">Background audio (optional)</p>

      {!file ? (
        <label
          htmlFor="doxatrim-bg-audio-input"
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-6 text-center"
        >
          <Upload size={20} className="text-primary" />
          <p className="text-xs text-muted-foreground">
            {importing ? "Loading…" : "Add background music or voiceover — mp3, wav, m4a"}
          </p>
          <input
            id="doxatrim-bg-audio-input"
            type="file"
            accept=".mp3,.wav,.m4a"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <Music size={14} /> {file.name}
            </span>
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-1 hover:text-destructive"
            >
              <Trash2 size={12} /> Remove
            </button>
          </div>

          {src && (
            <MediaPlayer
              ref={mediaRef}
              src={src}
              type="audio"
              trimRange={{ inPoint, outPoint }}
            />
          )}

          <TrimEditor
            duration={duration}
            inPoint={inPoint}
            outPoint={outPoint}
            onTrimChange={setTrim}
            mediaRef={mediaRef}
          />

          <p className="text-xs text-muted-foreground">
            The background track loops to fill the whole timeline and gets mixed under the main
            audio on export.
          </p>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <label className="flex flex-col gap-1">
              Main clip volume — {Math.round(mainVolume * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={mainVolume}
                onChange={(e) => setMainVolume(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              Background volume — {Math.round(volume * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
              />
            </label>
          </div>
        </div>
      )}
    </motion.div>
  );
};
