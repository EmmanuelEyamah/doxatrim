import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark";

const getInitialTheme = (): Theme => {
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
};

export const PANEL_LIMITS = { left: [220, 560], right: [260, 600] } as const;

interface SettingsStore {
  theme: Theme;
  /** Imports land in the media bin; with this on they're also placed on the timeline right away. */
  autoAddImports: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setAutoAddImports: (value: boolean) => void;
  setLeftPanelWidth: (px: number) => void;
  setRightPanelWidth: (px: number) => void;
}

const clamp = (v: number, [min, max]: readonly [number, number]) => Math.min(max, Math.max(min, v));

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: getInitialTheme(),
      autoAddImports: true,
      leftPanelWidth: 320,
      rightPanelWidth: 340,
      toggleTheme: () =>
        set((s) => {
          const next = s.theme === "light" ? "dark" : "light";
          document.documentElement.classList.toggle("dark", next === "dark");
          document.documentElement.style.colorScheme = next;
          return { theme: next };
        }),
      setTheme: (theme) => {
        document.documentElement.classList.toggle("dark", theme === "dark");
        document.documentElement.style.colorScheme = theme;
        set({ theme });
      },
      setAutoAddImports: (autoAddImports) => set({ autoAddImports }),
      setLeftPanelWidth: (px) => set({ leftPanelWidth: clamp(px, PANEL_LIMITS.left) }),
      setRightPanelWidth: (px) => set({ rightPanelWidth: clamp(px, PANEL_LIMITS.right) }),
    }),
    { name: "settings-storage" }
  )
);
