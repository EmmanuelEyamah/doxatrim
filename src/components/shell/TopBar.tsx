import { motion } from "framer-motion";
import { FileOutput } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/ThemeToggle";
import logoDark from "@/assets/logo-dark.png";

interface TopBarProps {
  projectName: string;
  canExport: boolean;
  onExport: () => void;
}

export const TopBar = ({ projectName, canExport, onExport }: TopBarProps) => (
  <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-sidebar px-4">
    <div className="flex min-w-0 items-center gap-3">
      <img src={logoDark} alt="DoxaTrim" className="h-7 w-7 rounded-md" />
      <span className="text-sm font-black tracking-tight">DoxaTrim</span>
      <span className="text-muted-foreground/50">/</span>
      <span className="truncate text-sm text-muted-foreground">{projectName}</span>
    </div>
    <div className="flex items-center gap-2">
      <ThemeToggle className="h-8 w-8 p-0" />
      <motion.button
        type="button"
        whileHover={{ scale: canExport ? 1.03 : 1 }}
        whileTap={{ scale: canExport ? 0.97 : 1 }}
        disabled={!canExport}
        onClick={onExport}
        className={cn(
          "flex h-8 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground",
          "disabled:cursor-not-allowed disabled:opacity-40"
        )}
      >
        <FileOutput size={16} /> Export
      </motion.button>
    </div>
  </header>
);
