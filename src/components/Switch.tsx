import { cn } from "@/lib/utils";

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  className?: string;
}

export const Switch = ({ checked, onChange, label, className }: SwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={cn(
      "relative h-4 w-7 shrink-0 rounded-full transition-colors",
      checked ? "bg-primary" : "bg-muted-foreground/40",
      className
    )}
  >
    <span
      className={cn(
        "absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform",
        checked && "translate-x-3"
      )}
    />
  </button>
);
