import { Download, Music, Trash2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/formatTime";
import type { Clip } from "@/types/clip";

interface ClipBlockProps {
  clip: Clip;
  index: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
}

export const ClipBlock = ({
  clip,
  index,
  isSelected,
  onSelect,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
}: ClipBlockProps) => {
  const trimmedDuration = clip.outPoint - clip.inPoint;

  const downloadSource = () => {
    const url = URL.createObjectURL(clip.file);
    const a = document.createElement("a");
    a.href = url;
    a.download = clip.file.name;
    a.click();
    // Give the browser a moment to pick up the blob before revoking it.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <motion.div
      layout
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onClick={onSelect}
      whileHover={{ scale: 1.02 }}
      className={cn(
        "flex w-40 shrink-0 cursor-grab flex-col gap-2 rounded-xl border bg-card p-2 active:cursor-grabbing",
        isSelected ? "border-primary shadow-lg shadow-primary/20" : "border-border"
      )}
    >
      <div className="flex h-20 items-center justify-center overflow-hidden rounded-lg bg-muted">
        {clip.thumbnailUrl ? (
          <img src={clip.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Music size={24} className="text-muted-foreground" />
        )}
      </div>
      <p className="truncate text-xs font-semibold">{clip.file.name}</p>
      <p className="text-xs text-muted-foreground">
        {formatTime(trimmedDuration)} / {formatTime(clip.originalDuration)}
      </p>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            downloadSource();
          }}
          title="Save the original source file to disk"
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Download size={12} />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-border py-1 text-xs text-muted-foreground hover:text-destructive"
        >
          <Trash2 size={12} /> Remove
        </button>
      </div>
    </motion.div>
  );
};
