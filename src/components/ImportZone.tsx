import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { getClipType, validateFiles } from "@/lib/fileValidation";
import { generateVideoThumbnail, readMediaDuration } from "@/lib/media";
import { useClipStore } from "@/stores/useClipStore";
import type { Clip } from "@/types/clip";

export const ImportZone = () => {
  const clips = useClipStore((s) => s.clips);
  const addClips = useClipStore((s) => s.addClips);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const { accepted, rejected } = validateFiles(files, clips);

    for (const { file, reason } of rejected) {
      toast.error(`${file.name}: ${reason}`);
    }
    if (accepted.length === 0) return;

    setImporting(true);
    try {
      const newClips = await Promise.all(
        accepted.map(async (file, i): Promise<Clip> => {
          const type = getClipType(file)!;
          const duration = await readMediaDuration(file, type);
          const thumbnailUrl =
            type === "video" ? await generateVideoThumbnail(file) : undefined;
          return {
            id: crypto.randomUUID(),
            file,
            type,
            originalDuration: duration,
            inPoint: 0,
            outPoint: duration,
            thumbnailUrl,
            order: clips.length + i,
          };
        })
      );
      addClips(newClips);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to import file");
    } finally {
      setImporting(false);
    }
  };

  return (
    <motion.label
      htmlFor="doxatrim-file-input"
      whileHover={{ scale: 1.01 }}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        void handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card p-10 text-center transition-colors",
        isDragging && "border-primary bg-primary/5"
      )}
    >
      <Upload size={28} className="text-primary" />
      <p className="text-sm font-semibold">
        {importing ? "Importing…" : "Drag & drop video or audio files"}
      </p>
      <p className="text-xs text-muted-foreground">
        mp4, mov, webm, mp3, wav, m4a — or click to browse
      </p>
      <input
        id="doxatrim-file-input"
        ref={inputRef}
        type="file"
        multiple
        accept=".mp4,.mov,.webm,.mp3,.wav,.m4a"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </motion.label>
  );
};
