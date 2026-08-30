import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useFFmpeg } from "@/hooks/useFFmpeg";
import logoDark from "@/assets/logo-dark.png";

// TEMPORARY — proves the ffmpeg.wasm worker + core actually execute before any
// UI depends on it. Remove once the real trim/export pipeline (steps 12-14) lands.
function FFmpegDebugTest() {
  const { ffmpeg, loaded, loading, error } = useFFmpeg();
  const [result, setResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const runTest = async () => {
    if (!ffmpeg) return;
    setRunning(true);
    setResult(null);
    try {
      await ffmpeg.exec([
        "-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=1",
        "-t", "1", "out.mp4",
      ]);
      const data = await ffmpeg.readFile("out.mp4");
      setResult(`OK — produced ${data.length} bytes`);
    } catch (err) {
      setResult(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm">
      <p className="text-muted-foreground">
        crossOriginIsolated: {String(window.crossOriginIsolated)}
        {!window.crossOriginIsolated && " — restart `npm run dev` to pick up COOP/COEP headers"}
      </p>
      <p className="text-muted-foreground">
        ffmpeg core: {error ? `error — ${error}` : loading ? "loading…" : loaded ? "loaded" : "idle"}
      </p>
      <button
        type="button"
        disabled={!loaded || running}
        onClick={runTest}
        className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
      >
        {running ? "Running test…" : "Test ffmpeg"}
      </button>
      {result && <p className="text-muted-foreground">{result}</p>}
    </div>
  );
}

function App() {
  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <motion.img
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        src={logoDark}
        alt="DoxaTrim"
        className="h-20 w-20 rounded-2xl"
      />
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
        className="text-3xl font-black tracking-tight"
      >
        DoxaTrim
      </motion.h1>
      <p className="text-sm text-muted-foreground">
        Scaffold ready — build the import zone next.
      </p>
      <FFmpegDebugTest />
    </div>
  );
}

export default App;
