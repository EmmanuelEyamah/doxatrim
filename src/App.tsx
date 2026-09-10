import { useEffect } from "react";
import { Toaster } from "react-hot-toast";
import { EditorShell } from "@/components/shell/EditorShell";
import { useSettingsStore } from "@/stores/useSettingsStore";

function App() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <>
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
      <EditorShell />
    </>
  );
}

export default App;
