import { useState } from "react";
import { motion } from "framer-motion";
import { Loader2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { cn } from "@/lib/utils";
import { ACCEPT_MEDIA } from "@/lib/fileValidation";
import { importFiles } from "@/lib/importFiles";
import { useSettingsStore } from "@/stores/useSettingsStore";

interface ImportZoneProps {
  /** Slim single-row control for side panels instead of the large drop area. */
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

  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(true);
    },
    onDragLeave: () => setIsDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      void handleFiles(e.dataTransfer.files);
    },
  };

  const input = (
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
  );

  if (compact) {
    return (
      <label
        htmlFor="doxatrim-file-input"
        {...dragProps}
        className={cn(
          "flex h-9 cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 text-xs transition-colors hover:border-primary/60 hover:bg-primary/5",
          isDragging && "border-primary bg-primary/10",
          className
        )}
      >
        {importing ? (
          <Loader2 size={14} className="shrink-0 animate-spin text-primary" />
        ) : (
          <Upload size={14} className="shrink-0 text-primary" />
        )}
        <span className="font-semibold">{importing ? "Importing…" : "Import media"}</span>
        <span className="truncate text-muted-foreground">— drop files or click</span>
        {input}
      </label>
    );
  }

  return (
    <motion.label
      htmlFor="doxatrim-file-input"
      whileHover={{ scale: 1.01 }}
      {...dragProps}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-card p-10 text-center transition-colors",
        isDragging && "border-primary bg-primary/5",
        className
      )}
    >
      <Upload size={28} className="text-primary" />
      <p className="text-sm font-semibold">{importing ? "Importing…" : "Drag & drop video or audio files"}</p>
      <p className="text-xs text-muted-foreground">mp4, mov, webm, mp3, wav, m4a — or click to browse</p>
      {input}
    </motion.label>
  );
};
