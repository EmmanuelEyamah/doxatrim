import { useEffect, useRef, useState } from "react";
import { useClipStore } from "@/stores/useClipStore";
import { useAudioLayerStore } from "@/stores/useAudioLayerStore";
import { useSequencePlayer } from "@/hooks/useSequencePlayer";
import { useMixPreview } from "@/hooks/useMixPreview";
import { clipLocalToTimeline, timelineEnd } from "@/lib/timeline";
import { TopBar } from "@/components/shell/TopBar";
import { MediaPanel } from "@/components/shell/MediaPanel";
import { Inspector } from "@/components/shell/Inspector";
import { ExportDialog } from "@/components/shell/ExportDialog";
import { SequencePreview } from "@/components/SequencePreview";
import { TranscriptModal } from "@/components/TranscriptModal";
import { MixTimeline, type Selection } from "@/components/timeline/MixTimeline";

function baseName(filename: string): string {
  return filename.replace(/\.[^./]+$/, "");
}

export const EditorShell = () => {
  const clips = useClipStore((s) => s.clips);
  const updateTrim = useClipStore((s) => s.updateTrim);
  const layers = useAudioLayerStore((s) => s.layers);
  const mainVolume = useAudioLayerStore((s) => s.mainVolume);

  const player = useSequencePlayer(clips);
  const preview = useMixPreview(player, layers, mainVolume, timelineEnd(clips));

  const [selection, setSelection] = useState<Selection>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(260);
  const prevClipCount = useRef(0);

  // Selecting a clip jumps the monitor to it; first import selects that clip.
  const { seekToClip } = player;
  useEffect(() => {
    if (selection?.kind === "clip") seekToClip(selection.id);
  }, [selection, seekToClip]);

  useEffect(() => {
    if (prevClipCount.current === 0 && clips.length > 0 && !selection) {
      setSelection({ kind: "clip", id: clips[0].id });
    }
    prevClipCount.current = clips.length;
  }, [clips, selection]);

  // Drop a selection whose target no longer exists.
  useEffect(() => {
    if (!selection) return;
    const exists =
      selection.kind === "clip"
        ? clips.some((c) => c.id === selection.id)
        : layers.some((l) => l.id === selection.id);
    if (!exists) setSelection(null);
  }, [clips, layers, selection]);

  const selectedClip = selection?.kind === "clip" ? clips.find((c) => c.id === selection.id) : undefined;
  const projectName = clips[0] ? baseName(clips[0].file.name) : "Untitled project";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TopBar projectName={projectName} canExport={clips.length > 0} onExport={() => setExportOpen(true)} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_340px]">
        <MediaPanel onLayerAdded={(id) => setSelection({ kind: "layer", id })} />

        <section className="flex min-h-0 min-w-0 flex-col items-center justify-center overflow-y-auto bg-background p-4">
          <SequencePreview
            clips={clips}
            player={player}
            attachMain={preview.attachMain}
            onBeforePlay={preview.unlock}
            className="w-full max-w-4xl"
          />
        </section>

        <Inspector
          selection={selection}
          player={player}
          onSelect={setSelection}
          onOpenTranscript={() => setTranscriptOpen(true)}
        />
      </div>

      <MixTimeline
        player={player}
        selection={selection}
        onSelect={setSelection}
        height={timelineHeight}
        onHeightChange={setTimelineHeight}
      />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      {selectedClip?.transcript && (
        <TranscriptModal
          open={transcriptOpen}
          onClose={() => setTranscriptOpen(false)}
          transcript={selectedClip.transcript}
          onSeek={(time) => player.seek(clipLocalToTimeline(clips, selectedClip.id, time))}
          onSetIn={(time) =>
            updateTrim(selectedClip.id, Math.min(time, selectedClip.outPoint - 0.05), selectedClip.outPoint)
          }
          onSetOut={(time) =>
            updateTrim(selectedClip.id, selectedClip.inPoint, Math.max(time, selectedClip.inPoint + 0.05))
          }
        />
      )}
    </div>
  );
};
