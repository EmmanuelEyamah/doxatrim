export function formatTime(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

const TIME_PATTERN = /^(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/;

/** Parses "mm:ss.ms" back to seconds. Returns null if the input can't be parsed. */
export function parseTime(text: string): number | null {
  const match = TIME_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, mm, ss, ms = "0"] = match;
  const seconds = Number(ss);
  if (seconds >= 60) return null;
  const millis = Number(ms.padEnd(3, "0"));
  return Number(mm) * 60 + seconds + millis / 1000;
}
