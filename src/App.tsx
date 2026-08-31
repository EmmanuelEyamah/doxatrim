import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Toaster } from "react-hot-toast";
import { FileText } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ImportZone } from "@/components/ImportZone";
import { UrlImport } from "@/components/UrlImport";
import { ClipTimeline } from "@/components/ClipTimeline";
import { PreviewPlayer } from "@/components/PreviewPlayer";
import { TrimEditor } from "@/components/TrimEditor";
import { TranscriptModal } from "@/components/TranscriptModal";
import { ExportPanel } from "@/components/ExportPanel";
import { BackgroundAudioPanel } from "@/components/BackgroundAudioPanel";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useClipStore } from "@/stores/useClipStore";
import logoDark from "@/assets/logo-dark.png";

function App() {
  const theme = useSettingsStore((s) => s.theme);
  const clips = useClipStore((s) => s.clips);
  const selectedClipId = useClipStore((s) => s.selectedClipId);
  const updateTrim = useClipStore((s) => s.updateTrim);
  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
          },
        }}
      />

      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <img src={logoDark} alt="DoxaTrim" className="h-8 w-8 rounded-lg" />
          <span className="text-lg font-black tracking-tight">DoxaTrim</span>
        </div>
        <ThemeToggle />
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <ImportZone />
        </motion.div>

        <UrlImport />

        <ClipTimeline />

        {selectedClip && (
          <motion.div
            key={selectedClip.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex flex-col gap-4"
          >
            <PreviewPlayer ref={mediaRef} clip={selectedClip} />
            <TrimEditor
              duration={selectedClip.originalDuration}
              inPoint={selectedClip.inPoint}
              outPoint={selectedClip.outPoint}
              onTrimChange={(inPoint, outPoint) => updateTrim(selectedClip.id, inPoint, outPoint)}
              mediaRef={mediaRef}
            />
            {selectedClip.transcript && selectedClip.transcript.length > 0 && (
              <button
                type="button"
                onClick={() => setTranscriptOpen(true)}
                className="flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                <FileText size={14} /> View transcript
              </button>
            )}
          </motion.div>
        )}

        {selectedClip?.transcript && (
          <TranscriptModal
            open={transcriptOpen}
            onClose={() => setTranscriptOpen(false)}
            transcript={selectedClip.transcript}
            onSeek={(time) => {
              if (mediaRef.current) mediaRef.current.currentTime = time;
            }}
            onSetIn={(time) =>
              updateTrim(selectedClip.id, Math.min(time, selectedClip.outPoint - 0.05), selectedClip.outPoint)
            }
            onSetOut={(time) =>
              updateTrim(selectedClip.id, selectedClip.inPoint, Math.max(time, selectedClip.inPoint + 0.05))
            }
          />
        )}

        <BackgroundAudioPanel />
        <ExportPanel />
      </main>
    </div>
  );
}

export default App;
