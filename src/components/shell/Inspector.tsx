import { motion } from "framer-motion";
import { AudioLines, Download, FileText, Layers, SlidersHorizontal, Trash2 } from "lucide-react";
import { formatTime } from "@/lib/formatTime";
import { downloadFile } from "@/lib/download";
import { timelineEnd } from "@/lib/timeline";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useClipStore } from "@/stores/useClipStore";
import type { SequencePlayer } from "@/hooks/useSequencePlayer";
import { TrimEditor } from "@/components/TrimEditor";
import { LayerCard } from "@/components/layers/LayerCard";
import type { Selection } from "@/components/timeline/MixTimeline";

interface InspectorProps {
  selection: Selection;
  player: SequencePlayer;
  onSelect: (selection: Selection) => void;
  onOpenTranscript: () => void;
}

const actionClass =
  "flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground";

export const Inspector = ({ selection, player, onSelect, onOpenTranscript }: InspectorProps) => {
  const clips = useClipStore((s) => s.clips);
  const updateTrim = useClipStore((s) => s.updateTrim);
  const removeClip = useClipStore((s) => s.removeClip);
  const layers = useAudioLayerStore((s) => s.layers);
  const addLayer = useAudioLayerStore((s) => s.addLayer);
  const end = timelineEnd(clips);

  const clip = selection?.kind === "clip" ? clips.find((c) => c.id === selection.id) : undefined;
  const layer = selection?.kind === "layer" ? layers.find((l) => l.id === selection.id) : undefined;

  return (
    <aside className="flex min-h-0 flex-col border-l border-sidebar-border bg-sidebar">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-sidebar-border px-3 text-xs font-semibold">
        <SlidersHorizontal size={14} className="text-primary" />
        {clip ? "Clip" : layer ? "Audio layer" : "Project"}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {clip && (
          <motion.div
            key={clip.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex flex-col gap-3"
          >
            <div>
              <p className="truncate text-sm font-semibold" title={clip.file.name}>
                {clip.file.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {clip.type} · trimmed {formatTime(clip.outPoint - clip.inPoint)} of{" "}
                {formatTime(clip.originalDuration)}
              </p>
            </div>

            <TrimEditor
              duration={clip.originalDuration}
              inPoint={clip.inPoint}
              outPoint={clip.outPoint}
              onTrimChange={(inPoint, outPoint) => updateTrim(clip.id, inPoint, outPoint)}
              getPlayheadTime={() => player.localTimeFor(clip.id)}
              constrainPlayback={false}
            />
            <p className="text-[11px] text-muted-foreground">
              Tip: with this clip playing in the monitor, press <kbd className="rounded border border-border px-1">I</kbd> /{" "}
              <kbd className="rounded border border-border px-1">O</kbd> to mark in/out at the playhead.
            </p>

            <div className="flex flex-wrap gap-2">
              {clip.transcript && clip.transcript.length > 0 && (
                <button type="button" onClick={onOpenTranscript} className={actionClass}>
                  <FileText size={14} /> Transcript
                </button>
              )}
              <button
                type="button"
                onClick={() => onSelect({ kind: "layer", id: addLayer(clip.file, clip.originalDuration).id })}
                className={actionClass}
              >
                <AudioLines size={14} /> Use as audio layer
              </button>
              <button
                type="button"
                onClick={() => downloadFile(clip.file, clip.file.name)}
                className={actionClass}
              >
                <Download size={14} /> Save source
              </button>
              <button
                type="button"
                onClick={() => {
                  removeClip(clip.id);
                  onSelect(null);
                }}
                className={`${actionClass} hover:text-destructive`}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </motion.div>
        )}

        {layer && (
          <LayerCard
            key={layer.id}
            layer={layer}
            timelineEnd={end}
            playheadTime={player.timelineTime}
            className="border-0 bg-transparent p-0"
          />
        )}

        {!clip && !layer && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex flex-col gap-3 text-xs text-muted-foreground"
          >
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="mb-2 text-sm font-semibold text-foreground">Project</p>
              <dl className="grid grid-cols-2 gap-y-1">
                <dt>Duration</dt>
                <dd className="text-right font-mono text-foreground">{formatTime(end)}</dd>
                <dt>Clips</dt>
                <dd className="text-right font-mono text-foreground">{clips.length}</dd>
                <dt>Audio layers</dt>
                <dd className="text-right font-mono text-foreground">{layers.length}</dd>
              </dl>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-border bg-card p-3">
              <Layers size={14} className="mt-0.5 shrink-0 text-primary" />
              <p>
                Select a clip or an audio layer on the timeline to edit it here. Drag media from the bin
                onto the video lane to add a clip, or below it to add an audio layer at that point.
              </p>
            </div>
          </motion.div>
        )}
      </div>
    </aside>
  );
};
