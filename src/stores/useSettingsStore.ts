import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark";

const getInitialTheme = (): Theme => {
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  if (window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
  return "light";
};

interface SettingsStore {
  theme: Theme;
  /** Imports land in the media bin; with this on they're also placed on the timeline right away. */
  autoAddImports: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setAutoAddImports: (value: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: getInitialTheme(),
      autoAddImports: true,
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
    }),
    { name: "settings-storage" }
  )
);
