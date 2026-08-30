import { useState } from "react";
import { useClipStore } from "@/stores/useClipStore";
import { ClipBlock } from "@/components/ClipBlock";
import { formatTime } from "@/lib/formatTime";

export const ClipTimeline = () => {
  const clips = useClipStore((s) => s.clips);
  const selectedClipId = useClipStore((s) => s.selectedClipId);
  const selectClip = useClipStore((s) => s.selectClip);
  const removeClip = useClipStore((s) => s.removeClip);
  const reorderClips = useClipStore((s) => s.reorderClips);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  if (clips.length === 0) {
    return (
      <p className="text-center text-sm text-muted-foreground">
        No clips yet — import a file to get started.
      </p>
    );
  }

  const totalDuration = clips.reduce((sum, c) => sum + (c.outPoint - c.inPoint), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Timeline</p>
        <p className="text-sm text-muted-foreground">Total: {formatTime(totalDuration)}</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {clips.map((clip, index) => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            index={index}
            isSelected={clip.id === selectedClipId}
            onSelect={() => selectClip(clip.id)}
            onRemove={() => removeClip(clip.id)}
            onDragStart={setDragIndex}
            onDragOver={setOverIndex}
            onDrop={() => {
              if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
                reorderClips(dragIndex, overIndex);
              }
              setDragIndex(null);
              setOverIndex(null);
            }}
          />
        ))}
      </div>
    </div>
  );
};
