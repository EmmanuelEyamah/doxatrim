/** Snaps `t` to the nearest target within `threshold` seconds, if any. */
export function snapTime(t: number, targets: number[], threshold: number): number {
  let best = t;
  let bestDist = threshold;
  for (const target of targets) {
    const d = Math.abs(target - t);
    if (d < bestDist) {
      best = target;
      bestDist = d;
    }
  }
  return best;
}
