#!/usr/bin/env node
/**
 * Renders docs/PERF.md from the collector's result JSONs.
 *
 * Usage: node scripts/perf-report.mjs [e2e/results/unthrottled.json e2e/results/throttled.json]
 * With no args, defaults to both files above; missing files are skipped with a
 * NOT-MEASURED row so the doc never shows invented numbers.
 */
import { readFileSync } from 'node:fs';

const DEFAULTS = ['e2e/results/unthrottled.json', 'e2e/results/throttled.json'];
const paths = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULTS;

const fmt = (n, digits = 2, suffix = ' ms') =>
  Number.isFinite(n) ? `${n.toFixed(digits)}${suffix}` : 'NOT-MEASURED';

const rows = [];
for (const p of paths) {
  let r;
  try {
    r = JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    rows.push({ name: p, missing: true });
    continue;
  }
  rows.push({ name: r.mode ?? p, r });
}

function tableFor(r) {
  const heap = r.heap;
  return [
    `| Frame samples (n) | ${r.frames.n} |`,
    `| p50 frame | ${fmt(r.frames.p50Ms)} |`,
    `| **p99 frame** | **${fmt(r.frames.p99Ms)}** |`,
    `| Worst frame | ${fmt(r.frames.worstMs, 1)} — ${r.worstFrameCause} |`,
    `| Mean frame | ${fmt(r.frames.meanMs)} |`,
    `| Draw calls median / max | ${fmt(r.drawStats.medianDrawCalls, 0, '')} / ${fmt(
      r.drawStats.maxDrawCalls,
      0,
      '',
    )} |`,
    `| Triangles median / at max-draw snapshot | ${fmt(
      r.drawStats.medianTriangles,
      0,
      '',
    )} / ${fmt(r.drawStats.trisAtMaxDrawCalls, 0, '')} |`,
    `| Instances at max-draw snapshot | ${fmt(r.drawStats.instancesAtMaxDrawCalls, 0, '')} |`,
    `| Heap t0 → t${Math.round(r.measuredDurationS)}s | ${
      heap.t0Mb === null ? 'NOT-MEASURED' : `${heap.t0Mb.toFixed(1)} MB`
    } → ${heap.t180Mb === null ? 'NOT-MEASURED' : `${heap.t180Mb.toFixed(1)} MB`} (${
      heap.driftPct === null ? 'drift n/a' : `${heap.driftPct >= 0 ? '+' : ''}${heap.driftPct.toFixed(1)}%`
    }) |`,
    `| Boot → first interactive | ${
      r.bootMs === null ? 'NOT-MEASURED' : `${(r.bootMs / 1000).toFixed(2)} s`
    } → ${
      r.firstInteractiveMs === null
        ? 'NOT-MEASURED'
        : `${(r.firstInteractiveMs / 1000).toFixed(2)} s`
    } |`,
    `| Shader compiles post-load | **${Number.isFinite(r.shaderCompiles.postLoadCompiles) ? r.shaderCompiles.postLoadCompiles : 'NOT-MEASURED'}** (total links incl. load: ${r.shaderCompiles.totalProgramLinks}; THREE.WebGLProgram console messages: ${r.shaderCompiles.consoleThreeWebGLProgramMessages}) |`,
    `| Median sim / render-submit split | ${fmt(r.simRenderSplit.medianSimMs)} / ${fmt(
      r.simRenderSplit.medianRenderMs,
    )} |`,
  ].join('\n');
}

const throttled = rows.map((x) => x.r).find((r) => r && r.mode === 'throttled');
const verdict =
  throttled !== undefined
    ? `${throttled.gate.verdict} — ${throttled.gate.detail}`
    : 'NOT-MEASURED (no throttled run result found)';

console.log(`# Performance Measurement Report (Wave 1.5 gate)

Measured on branch \`feat/perf-gate\` work, built bundle (\`pnpm build\` + \`pnpm preview\`),
headless Chromium. Environment: Windows host, WebGPU unavailable in headless Chromium →
three.js falls back to the WebGL2 backend running on **SwiftShader (software rasteriser)**.
Consequences, stated honestly:

- Frame times here are a **CPU-side proxy** (sim + submit + SwiftShader raster on CPU).
  They are NOT representative of a mid-range iGPU; the GPU-side half of the ≤16.6ms
  budget is **NOT-MEASURED in this environment** and needs a hardware run before ship.
- Draw calls / triangle / instance counts, heap behaviour, boot/first-interactive,
  and post-load shader-compiles ARE valid measurements.
- The authoritative gate profile is the CPU-throttled 4× run.

Gate spec: docs/PERF-BUDGET.md — p99 ≤ 20 ms over 3-minute continuous drive AND zero
post-load shader compiles.

## Verdict

**${verdict}**

## Drive profile

- Primary: \`?autopilot=1\` (shipped hook: throttle 0.7 constant, sinusoidal steering
  sweep ×0.3, UI ignored) plus a physically-held <kbd>W</kbd> key. The held key is
  required because the current autopilot hook writes \`input.state\` every 50 ms while
  \`InputSystemImpl.poll()\` re-samples sources and overwrites state every fixed tick
  (~16.6 ms), duty-cycling the autopilot values; see docs/notes/perf-and-quality.md.
- Fallback if no autopilot marker is detected: pure keyboard simulation (held W +
  32 s-period A/D sweep).

## Results

`);

for (const row of rows) {
  if (row.missing) {
    console.log(`### ${row.name}\n\nNOT-MEASURED (result file absent)\n`);
    continue;
  }
  const r = row.r;
  console.log(
    `### ${r.mode} run\n\n` +
      `Backend: \`${r.backend ?? 'unknown'}\` · drive: ${r.driveProfile}\n\n` +
      `| Metric | Value |\n|---|---|\n${tableFor(r)}\n`,
  );
}

console.log(`## Method notes

- **Frame times**: injected wrapper around \`window.requestAnimationFrame\`
  (page.addInitScript) recording successive-callback deltas; window = drive start
  (boot marker) → t+180 s. p50/p99 linear-interpolated percentiles.
- **Heap**: \`performance.memory.usedJSHeapSize\` sampled every 2 s in-page (Chromium-only).
- **Draw calls / tris / instances**: parsed from the \`?debug=1\` overlay DOM writes
  (\`#understory-debug\`, 250 ms cadence, fed by \`renderer.info.render.*\`). A
  \`window.__understoryPerf\` export would remove the DOM-parsing dependency — requested
  as a cross-dir diff (see docs/notes/perf-and-quality.md).
- **First interactive**: first frame ≥ boot marker whose next 20 rAF deltas have
  median ≤ 40 ms and max ≤ 150 ms (cadence stabilised), timestamp relative to navigation.
- **Post-load shader compiles**: \`HTMLCanvasElement.prototype.getContext\` wrapped;
  the webgl context's \`createProgram/linkProgram/compileShader\` are shadowed with
  counting wrappers carrying timestamps. Post-load = link calls strictly after the
  app's \`[understory] booted\` console marker. \`THREE.WebGLProgram\` console messages
  counted separately as a secondary channel. Caveat: counts only contexts obtained via
  \`getContext('webgl…')\` — valid for the WebGL2 fallback path used here.
- **CPU throttle**: CDP \`Emulation.setCPUThrottlingRate(4)\` applied before navigation
  (boot included). \`--cpu-throttle-rate\` launch flag does not exist in stock Chromium.
- **Worst-frame cause**: nearest debug-overlay sample (±300 ms) of each top-5 worst
  delta; classified chunk-streaming vs CPU-sim vs render-submit by sim/render split and
  live-chunk-count change. Function-level attribution requires a profiler attachment
  (NOT-MEASURED here); named causes are phase-level only.

Raw telemetry retained at \`e2e/results/<mode>-raw.json\` (untracked).
`);
