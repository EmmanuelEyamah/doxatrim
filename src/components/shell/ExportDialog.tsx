import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExportPanel } from "@/components/ExportPanel";

interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Stays mounted while closed (just hidden) so ffmpeg stays loaded and a
 * finished export's preview/download survive closing and reopening.
 */
export const ExportDialog = ({ open, onClose }: ExportDialogProps) => (
  <div
    className={cn("fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4", !open && "hidden")}
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card p-2 shadow-2xl"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      >
        <X size={18} />
      </button>
      <ExportPanel />
    </div>
  </div>
);
