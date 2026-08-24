/**
 * Node-side collector for the Wave 1.5 performance gate.
 *
 * One `collectRun()` = boot the built app with ?debug=1 (& ?autopilot=1 when
 * available), hold a continuous drive for RUN_DURATION_MS, then serialise the
 * in-page instrumentation (see collector-init.ts) and reduce it with the pure
 * helpers in perf-stats.ts.
 *
 * Drive strategy (v1, documented in docs/PERF.md):
 *  - Primary: ?autopilot=1 (throttle 0.7, sinusoidal steer sweep, UI ignored)
 *    PLUS a physically-held KeyW. Rationale: the shipped autopilot hook writes
 *    input.state every 50 ms but InputSystemImpl.poll() re-samples sources and
 *    overwrites state every fixed tick (~16.6 ms), so the autopilot values are
 *    duty-cycled; the held key guarantees genuinely continuous motion.
 *  - Fallback (no autopilot marker seen): pure Playwright keyboard driving —
 *    KeyW held, steering swept by toggling KeyA/KeyD on a sine schedule,
 *    matching the v1 keyboard-simulation contract.
 */
import type { Page } from '@playwright/test';
import { COLLECTOR_INIT_SCRIPT } from './collector-init';
import {
  classifyWorstFrame,
  evaluateGate,
  findFirstInteractive,
  heapDriftPct,
  nearestSample,
  percentile,
  summarizeFrames,
  type FrameSummary,
  type OverlaySample,
} from './perf-stats';

export const RUN_DURATION_MS = 180_000;
export const CPU_THROTTLE_RATE = 4;

interface InPagePerf {
  tStart: number;
  bootMarkerAt: number | null;
  backendMsg: string | null;
  rafT: number[];
  rafD: number[];
  heap: { t: number; used: number }[];
  overlay: OverlaySample[];
  gl: { programsLinked: number[]; shadersCompiled: number; contextsSeen: string[] };
  consoleCompileSniffs: number;
  consoleTail: string[];
}

declare global {
  interface Window {
    __understoryPerf?: InPagePerf;
  }
}

export interface WorstFrameEvidence {
  deltaMs: number;
  cause: string;
  near: OverlaySample | null;
}

export interface RunResult {
  mode: 'unthrottled' | 'throttled';
  backend: string | null;
  gpuValid: boolean;
  autopilotEngaged: boolean;
  driveProfile: string;
  bootMs: number | null;
  firstInteractiveMs: number | null;
  frames: FrameSummary;
  drawStats: {
    medianDrawCalls: number;
    maxDrawCalls: number;
    trisAtMaxDrawCalls: number;
    instancesAtMaxDrawCalls: number;
    medianTriangles: number;
  };
  heap: { t0Mb: number | null; t180Mb: number | null; driftPct: number | null };
  shaderCompiles: {
    totalProgramLinks: number;
    postLoadCompiles: number;
    consoleThreeWebGLProgramMessages: number;
    method: string;
  };
  worstFrames: WorstFrameEvidence[];
  worstFrameCause: string;
  simRenderSplit: { medianSimMs: number; medianRenderMs: number };
  gate: { verdict: 'PASS' | 'FAIL'; detail: string };
  measuredDurationS: number;
}

/** Installs instrumentation + optional 4x CPU throttling BEFORE app boot. */
export async function preparePage(page: Page, mode: 'unthrottled' | 'throttled'): Promise<void> {
  await page.addInitScript(COLLECTOR_INIT_SCRIPT);
  if (mode === 'throttled') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
  }
}

async function getPerf(page: Page): Promise<InPagePerf> {
  return await page.evaluate(() => window.__understoryPerf) as InPagePerf;
}

/**
 * Runs one full measurement pass on an already-prepared page. Navigates, waits
 * for boot, drives continuously for RUN_DURATION_MS, then reduces telemetry.
 */
export async function collectRun(
  page: Page,
  mode: 'unthrottled' | 'throttled',
): Promise<RunResult> {
  await page.goto('/?debug=1&autopilot=1');

  // Boot completion = the app's own '[understory] booted' marker (console-wrapped).
  await page.waitForFunction(() => window.__understoryPerf?.bootMarkerAt !== null, undefined, {
    timeout: 120_000,
  });
  const perfAtBoot = await getPerf(page);
  const autopilotEngaged = perfAtBoot.consoleTail.some((t) => t.includes('autopilot engaged'));

  // Start driving: any keydown starts the game; holding W keeps throttle high
  // even against the autopilot/poll duty-cycling described above.
  await page.keyboard.down('KeyW');
  const driveStart = Date.now();

  let fallbackSweepStep = 0;
  while (Date.now() - driveStart < RUN_DURATION_MS) {
    await page.waitForTimeout(1000);
    if (!autopilotEngaged) {
      // v1 keyboard steering sweep: 32 s period, hold A/D while sine > 0.3.
      fallbackSweepStep++;
      const phase = Math.floor((fallbackSweepStep % 32) / 4); // 8 slots of 4 s
      if (phase === 1) await page.keyboard.down('KeyA');
      else await page.keyboard.up('KeyA');
      if (phase === 5) await page.keyboard.down('KeyD');
      else await page.keyboard.up('KeyD');
    }
  }
  await page.keyboard.up('KeyW');

  const perf = await getPerf(page);
  const driveProfile = autopilotEngaged
    ? '?autopilot=1 (throttle 0.7, sin steer sweep x0.3) + held KeyW; UI ignored'
    : 'keyboard fallback: held KeyW + 32 s-period A/D sweep';

  // ---- reduce ---------------------------------------------------------------
  const bootIdx = firstIndexAtOrAfter(perf.rafT, perf.bootMarkerAt ?? 0);
  const settleIdx = bootIdx ?? 0;
  const tti = findFirstInteractive(perf.rafT, perf.rafD, settleIdx);

  // Measurement window = frames from drive start to end (drop boot warm-up).
  const driveStartTime = perf.bootMarkerAt ?? 0;
  const winStartIdx = firstIndexAtOrAfter(perf.rafT, driveStartTime);
  const deltas = winStartIdx === null ? perf.rafD : perf.rafD.slice(winStartIdx);
  const frames = summarizeFrames(deltas);

  // Heap t0/t180: first sample at/after drive start vs last sample.
  const heapWin = perf.heap.filter((h) => h.t >= driveStartTime);
  const t0 = heapWin[0] ?? null;
  const tN = heapWin[heapWin.length - 1] ?? null;

  // Draw-call stats across the drive window's overlay samples.
  const ovWin = perf.overlay.filter((o) => o.t >= driveStartTime);
  const callsArr = ovWin.map((o) => o.drawCalls).filter((n) => Number.isFinite(n));
  const maxCall = ovWin.reduce<OverlaySample | null>(
    (best, o) => (best === null || o.drawCalls > best.drawCalls ? o : best),
    null,
  );

  // Worst frames + named causes (nearest overlay sample within ±300 ms).
  const ranked = [...perf.rafD]
    .map((d, i) => ({ d, i }))
    .sort((a, b) => b.d - a.d)
    .slice(0, 5)
    .filter(({ i }) => winStartIdx === null || i >= winStartIdx);
  const worstFrames: WorstFrameEvidence[] = ranked.map(({ d, i }) => {
    const t = perf.rafT[i] ?? 0;
    const near = nearestSample(perf.overlay, t, 300);
    const prev = near === null ? null : prevOverlay(perf.overlay, near.t);
    return { deltaMs: d, cause: classifyWorstFrame(d, near, prev), near };
  });
  const worstTop = worstFrames[0] ?? null;

  const postLoadCompiles =
    perf.bootMarkerAt === null
      ? NaN
      : perf.gl.programsLinked.filter((t) => t > perf.bootMarkerAt!).length;

  const backend = perf.backendMsg?.replace(/^\[understory\]\s*/, '') ?? null;
  const gpuValid = !/webgl2/i.test(backend ?? '') /* SwiftShader WebGL2 = software */;
  const simArr = ovWin.map((o) => o.simMs).filter(Number.isFinite);
  const renderArr = ovWin.map((o) => o.renderMs).filter(Number.isFinite);

  const gate = evaluateGate({
    p99Ms: frames.p99Ms,
    postLoadCompiles,
    // In this environment headless Chromium renders via SwiftShader (software),
    // so rAF deltas measure CPU-side cost only. Recorded as proxy either way.
    gpuValid: false,
  });

  return {
    mode,
    backend: perf.backendMsg,
    gpuValid,
    autopilotEngaged,
    driveProfile,
    bootMs: perf.bootMarkerAt,
    firstInteractiveMs: tti,
    frames,
    drawStats: {
      medianDrawCalls: callsArr.length ? percentile(callsArr, 50) : NaN,
      maxDrawCalls: maxCall?.drawCalls ?? NaN,
      trisAtMaxDrawCalls: maxCall?.triangles ?? NaN,
      instancesAtMaxDrawCalls: maxCall?.instances ?? NaN,
      medianTriangles: percentile(
        ovWin.map((o) => o.triangles).filter(Number.isFinite),
        50,
      ),
    },
    heap: {
      t0Mb: t0 ? t0.used / 1048576 : null,
      t180Mb: tN ? tN.used / 1048576 : null,
      driftPct: t0 && tN ? heapDriftPct(t0.used, tN.used) : null,
    },
    shaderCompiles: {
      totalProgramLinks: perf.gl.programsLinked.length,
      postLoadCompiles,
      consoleThreeWebGLProgramMessages: perf.consoleCompileSniffs,
      method:
        'getContext() wrapper shadowing createProgram/linkProgram/compileShader with timestamps; ' +
        "post-load = linkProgram calls after the '[understory] booted' console marker; " +
        "'THREE.WebGLProgram' console messages counted separately as a secondary sniffing channel",
    },
    worstFrames,
    worstFrameCause: worstTop ? worstTop.cause : 'no frames captured',
    simRenderSplit: {
      medianSimMs: simArr.length ? percentile(simArr, 50) : NaN,
      medianRenderMs: renderArr.length ? percentile(renderArr, 50) : NaN,
    },
    gate,
    measuredDurationS: Math.round((RUN_DURATION_MS / 1000) * 10) / 10,
  };
}

function firstIndexAtOrAfter(times: readonly number[], t: number): number | null {
  for (let i = 0; i < times.length; i++) {
    if (times[i]! >= t) return i;
  }
  return null;
}

function prevOverlay(samples: readonly OverlaySample[], t: number): OverlaySample | null {
  let prev: OverlaySample | null = null;
  for (const s of samples) {
    if (s.t >= t) break;
    prev = s;
  }
  return prev;
}
