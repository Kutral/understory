# Performance Measurement Report (Wave 1.5 gate)

Measured on branch `main @ 2059d5c`, built bundle (`pnpm build` + `pnpm preview`),
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

**FAIL — frame-time leg NOT-MEASURABLE in this environment (no interactive rAF cadence under software rasteriser); post-load compiles=12 (gate 0) FAIL [software rasteriser: frame times are CPU-proxy, not iGPU-representative]**

## Drive profile

- Primary: `?autopilot=1` (shipped hook: throttle 0.7 constant, sinusoidal steering
  sweep ×0.3, UI ignored) plus a physically-held <kbd>W</kbd> key. The held key is
  required because the current autopilot hook writes `input.state` every 50 ms while
  `InputSystemImpl.poll()` re-samples sources and overwrites state every fixed tick
  (~16.6 ms), duty-cycling the autopilot values; see docs/notes/perf-and-quality.md.
- Fallback if no autopilot marker is detected: pure keyboard simulation (held W +
  32 s-period A/D sweep).

## Results


### unthrottled run

Backend: `[understory] backend: webgl2; tone mapping: AgX` · drive: ?autopilot=1 (throttle 0.7, sin steer sweep x0.3) + held KeyW; UI ignored

| Metric | Value |
|---|---|
| Frame samples (n) | 21 — **cadence degenerate (<5 fps): percentiles NOT representative** |
| p50 frame | 245.10 ms |
| **p99 frame** | **61559.40 ms** (see n above — NOT-MEASURABLE leg) |
| Worst frame | 62680.7 ms — chunk streaming / fixed-tick batch (sim 24.6ms, chunksLive 30->34) |
| Mean frame | 11819.76 ms |
| Draw calls median / max | 11 / 20 |
| Triangles median / at max-draw snapshot | 282197 / 350037 |
| Instances at max-draw snapshot | 2 |
| Heap t0 → t180s | 17.4 MB → 17.4 MB (+0.0%) |
| Boot → first interactive | 1.00 s → NOT-MEASURED |
| Shader compiles post-load | **12** (total links incl. load: 12; THREE.WebGLProgram console messages: 0) |
| Median sim / render-submit split | 26.25 ms / 13.20 ms |
| **CPU-sim proxy** (recorded in lieu of unmeasurable frame gate) | 26.25 ms median fixed-tick batch vs ≤4 ms budget line — inflated by software-rasteriser thread contention |

### throttled run

Backend: `[understory] backend: webgl2; tone mapping: AgX` · drive: ?autopilot=1 (throttle 0.7, sin steer sweep x0.3) + held KeyW; UI ignored

| Metric | Value |
|---|---|
| Frame samples (n) | 36 — **cadence degenerate (<5 fps): percentiles NOT representative** |
| p50 frame | 1822.85 ms |
| **p99 frame** | **55149.15 ms** (see n above — NOT-MEASURABLE leg) |
| Worst frame | 55454.0 ms — chunk streaming / fixed-tick batch (sim 23.9ms) |
| Mean frame | 13232.51 ms |
| Draw calls median / max | 19 / 36 |
| Triangles median / at max-draw snapshot | 260949 / 265813 |
| Instances at max-draw snapshot | 2 |
| Heap t0 → t180s | 19.6 MB → 19.6 MB (+0.0%) |
| Boot → first interactive | 3.43 s → NOT-MEASURED |
| Shader compiles post-load | **12** (total links incl. load: 12; THREE.WebGLProgram console messages: 0) |
| Median sim / render-submit split | 74.10 ms / 79.15 ms |
| **CPU-sim proxy** (recorded in lieu of unmeasurable frame gate) | 74.10 ms median fixed-tick batch vs ≤4 ms budget line — inflated by software-rasteriser thread contention |

## Method notes

- **Frame times**: injected wrapper around `window.requestAnimationFrame`
  (page.addInitScript) recording successive-callback deltas; window = drive start
  (boot marker) → t+180 s. p50/p99 linear-interpolated percentiles.
- **Heap**: `performance.memory.usedJSHeapSize` sampled every 2 s in-page (Chromium-only).
  Caveat: when rAF cadence is degenerate the main thread is mostly blocked, so the
  in-page interval also starves (~5 samples/run); a flat heap trace here is WEAK
  evidence, not the 10-minute leak-proof the budget requires.
- **Draw calls / tris / instances**: parsed from the `?debug=1` overlay DOM writes
  (`#understory-debug`, 250 ms cadence, fed by `renderer.info.render.*`). A
  `window.__understoryPerf` export would remove the DOM-parsing dependency — requested
  as a cross-dir diff (see docs/notes/perf-and-quality.md).
- **First interactive**: first frame ≥ boot marker whose next 20 rAF deltas have
  median ≤ 40 ms and max ≤ 150 ms (cadence stabilised), timestamp relative to navigation.
- **Post-load shader compiles**: `HTMLCanvasElement.prototype.getContext` wrapped;
  the webgl context's `createProgram/linkProgram/compileShader` are shadowed with
  counting wrappers carrying timestamps. Post-load = link calls strictly after the
  app's `[understory] booted` console marker. `THREE.WebGLProgram` console messages
  counted separately as a secondary channel. Caveat: counts only contexts obtained via
  `getContext('webgl…')` — valid for the WebGL2 fallback path used here.
- **CPU throttle**: CDP `Emulation.setCPUThrottlingRate(4)` applied before navigation
  (boot included). `--cpu-throttle-rate` launch flag does not exist in stock Chromium.
- **Worst-frame cause**: nearest debug-overlay sample (±300 ms) of each top-5 worst
  delta; classified chunk-streaming vs CPU-sim vs render-submit by sim/render split and
  live-chunk-count change. Function-level attribution requires a profiler attachment
  (NOT-MEASURED here); named causes are phase-level only.

## Findings requiring owner action

1. **Post-load shader compiles = 12 (gate: 0) — FAIL.** All 12 program links happen
   after boot as streamed chunks attach; the terrain material is shared and pooled, so
   the likely cause is pipeline variants per LOD-step geometry layout (steps {1,2,4,8})
   or per-chunk state in the WebGPU/WebGL backend — render-core/world owners to warm
   every variant up front (e.g. `renderer.compileAsync` over all LOD layouts at load).
2. **Frame-time gate NOT-MEASURABLE in this environment** — needs an iGPU hardware run
   before the gate can pass or fail honestly on frame times.

Raw telemetry retained at `e2e/results/<mode>-raw.json` (untracked).

