import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Search, X } from "lucide-react";
import { formatTime } from "@/lib/formatTime";
import type { TranscriptCue } from "@/types/clip";

interface TranscriptModalProps {
  open: boolean;
  onClose: () => void;
  transcript: TranscriptCue[];
  onSeek: (time: number) => void;
  onSetIn: (time: number) => void;
  onSetOut: (time: number) => void;
}

export const TranscriptModal = ({
  open,
  onClose,
  transcript,
  onSeek,
  onSetIn,
  onSetOut,
}: TranscriptModalProps) => {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return transcript;
    return transcript.filter((cue) => cue.text.toLowerCase().includes(q));
  }, [transcript, query]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="flex h-[85vh] w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border bg-card p-6"
          >
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold">Transcript</p>
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the transcript…"
                autoFocus
                className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>

            <div className="flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No matches for "{query}"
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {filtered.map((cue, i) => (
                    <div
                      key={i}
                      className="group flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-muted"
                    >
                      <button
                        type="button"
                        onClick={() => onSeek(cue.start)}
                        className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-mono text-primary hover:bg-primary hover:text-primary-foreground"
                      >
                        {formatTime(cue.start).slice(0, 5)}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSeek(cue.start)}
                        className="flex-1 text-left text-sm"
                      >
                        {cue.text}
                      </button>
                      <div className="hidden shrink-0 gap-1 group-hover:flex">
                        <button
                          type="button"
                          onClick={() => onSetIn(cue.start)}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Set in
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetOut(cue.start)}
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Set out
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
