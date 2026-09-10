import { useState } from "react";
import { motion } from "framer-motion";
import { Upload } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { ACCEPT_MEDIA } from "@/lib/fileValidation";
import { importFiles } from "@/lib/importFiles";
import { useSettingsStore } from "@/stores/useSettingsStore";

interface ImportZoneProps {
  compact?: boolean;
  className?: string;
}

export const ImportZone = ({ compact = false, className }: ImportZoneProps) => {
  const autoAddImports = useSettingsStore((s) => s.autoAddImports);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setImporting(true);
    try {
      const { assets, rejected } = await importFiles(Array.from(fileList), {
        origin: "local",
        addToTimeline: autoAddImports,
      });
      for (const { file, reason } of rejected) toast.error(`${file.name}: ${reason}`);
      if (assets.length > 0 && !autoAddImports) {
        toast.success(`Added ${assets.length} file${assets.length > 1 ? "s" : ""} to the media bin`);
      }
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
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card text-center transition-colors",
        compact ? "p-5" : "p-10 gap-3",
        isDragging && "border-primary bg-primary/5",
        className
      )}
    >
      <Upload size={compact ? 20 : 28} className="text-primary" />
      <p className={cn("font-semibold", compact ? "text-xs" : "text-sm")}>
        {importing ? "Importing…" : "Drag & drop video or audio files"}
      </p>
      <p className="text-xs text-muted-foreground">
        mp4, mov, webm, mp3, wav, m4a — or click to browse
      </p>
      <input
        id="doxatrim-file-input"
        type="file"
        multiple
        accept={ACCEPT_MEDIA}
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </motion.label>
  );
};
