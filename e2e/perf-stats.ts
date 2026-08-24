/**
 * Pure statistics helpers for the Wave 1.5 performance gate collector.
 * No Playwright / DOM / Node imports so these are unit-testable under vitest
 * (tests/perf-stats.test.ts) and shared between the e2e spec and the report
 * script.
 */

export interface FrameSummary {
  /** Sampled frame count. */
  n: number;
  p50Ms: number;
  p99Ms: number;
  worstMs: number;
  meanMs: number;
}

/** Percentile of an UNsorted copy-safe array, linear-interpolated (n=1 safe). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (rank - lo);
}

export function summarizeFrames(deltasMs: readonly number[]): FrameSummary {
  if (deltasMs.length === 0) {
    return { n: 0, p50Ms: NaN, p99Ms: NaN, worstMs: NaN, meanMs: NaN };
  }
  return {
    n: deltasMs.length,
    p50Ms: percentile(deltasMs, 50),
    p99Ms: percentile(deltasMs, 99),
    worstMs: Math.max(...deltasMs),
    meanMs: deltasMs.reduce((a, b) => a + b, 0) / deltasMs.length,
  };
}

/**
 * Time-to-first-interactive: the first frame AT OR AFTER `fromIdx` whose next
 * `window` consecutive rAF deltas settle (median <= medianMaxMs and no single
 * delta worse than maxMs). Returned value is the frame's performance.now()-base
 * timestamp in ms; null if cadence never stabilised.
 */
export function findFirstInteractive(
  rafTimesMs: readonly number[],
  deltasMs: readonly number[],
  fromIdx: number,
  window = 20,
  medianMaxMs = 40,
  maxMs = 150,
): number | null {
  const n = deltasMs.length;
  for (let i = Math.max(0, fromIdx); i + window <= n; i++) {
    const win = deltasMs.slice(i, i + window);
    const med = percentile(win, 50);
    const worst = Math.max(...win);
    if (med <= medianMaxMs && worst <= maxMs) return rafTimesMs[i] ?? null;
  }
  return null;
}

/** Overlay telemetry snapshot parsed from the ?debug=1 DOM overlay. */
export interface OverlaySample {
  /** performance.now()-base ms of the overlay write. */
  t: number;
  drawCalls: number;
  triangles: number;
  instances: number;
  frameMs: number;
  simMs: number;
  renderMs: number;
  chunksLive: number;
  fps: number;
}

/**
 * Named cause for the worst frame, from the debug-overlay sample nearest it.
 * Classification (documented in docs/PERF.md):
 *  - streaming active (pending chunks) or chunk-count change nearby -> chunk streaming
 *  - otherwise CPU-sim-dominated (simMs >= renderMs) -> CPU sim
 *  - otherwise -> render submit (CPU-side; GPU time invisible here)
 */
export function classifyWorstFrame(
  worstDeltaMs: number,
  sample: OverlaySample | null,
  prevSample: OverlaySample | null,
): string {
  if (sample === null) return 'unattributed (no overlay sample near worst frame)';
  const chunksChanged = prevSample !== null && sample.chunksLive !== prevSample.chunksLive;
  if (sample.simMs >= 8 || chunksChanged) {
    return `chunk streaming / fixed-tick batch (sim ${sample.simMs.toFixed(1)}ms${
      chunksChanged ? `, chunksLive ${prevSample!.chunksLive}->${sample.chunksLive}` : ''
    })`;
  }
  if (sample.renderMs >= sample.simMs) {
    return `render submit (render ${sample.renderMs.toFixed(1)}ms vs sim ${sample.simMs.toFixed(
      1,
    )}ms)`;
  }
  return `CPU sim (sim ${sample.simMs.toFixed(1)}ms vs render ${sample.renderMs.toFixed(1)}ms)`;
}

export function nearestSample<T extends { t: number }>(
  samples: readonly T[],
  tMs: number,
  toleranceMs: number,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const s of samples) {
    const d = Math.abs(s.t - tMs);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return bestDist <= toleranceMs ? best : null;
}

/** Heap growth t0->t180 as a percentage of t0 (null when heap unavailable). */
export function heapDriftPct(t0Bytes: number, tNBytes: number): number | null {
  if (!(t0Bytes > 0)) return null;
  return ((tNBytes - t0Bytes) / t0Bytes) * 100;
}

/**
 * Gate evaluation for the Wave 1.5 blocking gate (docs/PERF-BUDGET.md):
 * p99 <= 20ms over a 3-minute continuous drive AND zero post-load shader
 * compiles. `gpuValid` false marks software-rasteriser environments where the
 * frame-time numbers are CPU-proxy only (verdict then carries the caveat).
 */
export function evaluateGate(input: {
  p99Ms: number;
  postLoadCompiles: number;
  gpuValid: boolean;
}): { verdict: 'PASS' | 'FAIL'; detail: string } {
  const frameOk = input.p99Ms <= 20;
  const compilesOk = input.postLoadCompiles === 0;
  const caveat = input.gpuValid
    ? ''
    : ' [software rasteriser: frame times are CPU-proxy, not iGPU-representative]';
  const parts: string[] = [
    `p99=${input.p99Ms.toFixed(2)}ms (gate <=20ms) ${frameOk ? 'OK' : 'FAIL'}`,
    `post-load compiles=${input.postLoadCompiles} (gate 0) ${compilesOk ? 'OK' : 'FAIL'}`,
  ];
  return {
    verdict: frameOk && compilesOk ? 'PASS' : 'FAIL',
    detail: `${parts.join('; ')}${caveat}`,
  };
}
