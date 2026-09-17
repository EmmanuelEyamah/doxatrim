const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
/** Ticks are generated this far outside the visible viewport (px). */
const OVERSCAN = 200;

export interface RulerTick {
  t: number;
  major: boolean;
}

/** Major-tick spacing in seconds for a zoom level: the smallest step at least 64 px apart. */
export function tickStepFor(pxPerSec: number): number {
  return STEPS.find((s) => s * pxPerSec >= 64) ?? STEPS[STEPS.length - 1];
}

/**
 * Ticks for the visible slice of the ruler only. A multi-hour project zoomed
 * in would otherwise mean hundreds of thousands of tick elements.
 */
export function rulerTicks(o: { pxPerSec: number; duration: number; viewportLeft: number; viewportWidth: number }): RulerTick[] {
  const step = tickStepFor(o.pxPerSec);
  const minor = step / 5;
  const from = Math.max(0, (o.viewportLeft - OVERSCAN) / o.pxPerSec);
  const to = Math.min(o.duration, (o.viewportLeft + o.viewportWidth + OVERSCAN) / o.pxPerSec);
  const ticks: RulerTick[] = [];
  for (let i = Math.floor(from / minor); i * minor <= to + 1e-6; i++) {
    ticks.push({ t: i * minor, major: i % 5 === 0 });
  }
  return ticks;
}
