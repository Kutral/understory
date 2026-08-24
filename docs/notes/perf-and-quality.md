# Perf & Quality (agent J) — Wave 1.5 gate build log

Branch worked on: `main` (shared worktree; harness committed as `183d736` after the
orchestrator integrated camera rig + docs). Measurements are taken from a separate
linked worktree pinned to `183d736`, built with `pnpm build`, served by
`pnpm preview`. Deliverables owned: `e2e/*`, `scripts/perf-report.mjs`,
`tests/perf-gate-stats.test.ts`, `docs/PERF.md`, this file. All numbers live in
`docs/PERF.md`; nothing here is asserted without a run behind it.

## What was built

- `e2e/collector-init.ts` — in-page instrumentation injected via
  `page.addInitScript` **before app code**:
  - rAF wrapper recording every successive-callback delta (frame times),
  - `performance.memory` sampler every 2 s (heap t0/t180),
  - `HTMLCanvasElement.prototype.getContext` wrapper that shadows
    `createProgram`/`linkProgram`/`compileShader` with timestamp-counting wrappers,
  - console wrappers capturing the `[understory] booted` marker, the backend line,
    `THREE.WebGLProgram` messages (secondary compile-sniffing channel), and a tail
    buffer used to detect `autopilot engaged`,
  - MutationObserver parsing the `?debug=1` overlay (`renderer.info.render.*`,
    sim/render ms, chunksLive) at its native 250 ms cadence.
- `e2e/perf-collector.ts` — one `collectRun()` = navigate (`/?debug=1&autopilot=1`),
  wait for boot marker, hold a continuous drive for exactly 180 s, serialise and
  reduce telemetry with pure helpers.
- `e2e/perf-stats.ts` — pure, unit-tested statistics (percentiles,
  first-interactive cadence detection, worst-frame cause classification,
  heap drift, gate evaluation).
- `e2e/perf.spec.ts` — two sequential runs: unthrottled and CPU-throttled 4× via
  CDP `Emulation.setCPUThrottlingRate(4)` applied before navigation (boot included).
  (`--cpu-throttle-rate` does not exist in stock Chromium; CDP is the available path.)
- `scripts/perf-report.mjs` — renders `docs/PERF.md` mechanically from
  `e2e/results/*.json`; missing runs render as NOT-MEASURED rows so the doc can
  never contain invented numbers.
- `tests/perf-gate-stats.test.ts` — 16 vitest cases over the pure helpers (all pass).

## Drive strategy actually used

Primary: the shipped `?autopilot=1` hook **plus a physically-held <kbd>W</kbd> key**.
Reason: the current hook writes `input.state.throttle/steer` from a `setInterval`
(50 ms), but `InputSystemImpl.poll()` re-samples all sources and overwrites
`input.state` every fixed tick (~16.6 ms). Between two interval writes, ~2 ticks run
with zeroed input, so the shipped hook's effective throttle is duty-cycled (~⅓ mean),
not a constant 0.7. The held key guarantees genuinely continuous motion either way.
Keyboard-only fallback (held W + sine-scheduled A/D sweep) is implemented and used
automatically if no `autopilot engaged` marker appears.

### Cross-dir diff request 1 — make ?autopilot=1 a real InputSource (src/main.ts)

Recommended instead of poking `input.state` directly; makes throttle truly constant
and removes the poll-clobbering race:

```diff
--- a/src/main.ts
+++ b/src/main.ts
@@ imports
+import type { InputSource } from './vehicle/input';
+
@@ where `input` exists, before ui.mount()
+  if (new URLSearchParams(location.search).has('autopilot')) {
+    let sweep = 0;
+    const autopilot: InputSource = {
+      name: 'autopilot',
+      sample: () => {
+        sweep += 1 / 60;
+        return { steer: Math.sin(sweep * 0.6) * 0.3, throttle: 0.7, brake: 0, recover: false };
+      },
+    };
+    input.addSource(autopilot); // polled once per tick; wins by max()-merge
+    console.info('[understory] autopilot engaged');
+  }
```

(`InputSystemImpl.addSource` already exists; remove the current setInterval block.)

## Cross-dir diff requests / findings (NOT applied by me)

### Diff A — src/main.ts: two Vector3 allocations + one clone per rendered frame — RESOLVED ON MAIN

The chase-cam math in the render callback used to allocate every frame (~60 Hz):
`chaseTarget.position.clone()` + `new THREE.Vector3(0, 2.6, -7.5)`. The camera-rig
integration (`323bd06 feat(camera)`) replaced that block with `rig.render(_alpha)`,
which no longer performs these per-frame allocations — verified by reading
`src/main.ts` at `183d736`. No diff needed; kept here for the audit trail.

Optional second hunk (same file, still open): `dbg?.update({ ... })` builds a fresh
`DebugStats` object literal per frame and calls `world.stats()` (another object
literal) each frame; hoist a module-level mutable stats record and only refresh
fields. Low priority — two small short-lived objects, debug-only path.

### Diff B — src/world/chunk-streamer.ts: per-tick Set + string keys

`update()` runs every fixed tick and allocates `new Set<string>()` plus ~121
template-literal key strings per call even when the car has not crossed a chunk
boundary:

```diff
--- a/src/world/chunk-streamer.ts
+++ b/src/world/chunk-streamer.ts
@@
   private readonly pool: GeometryPool;
   private readonly live = new Map<string, LiveChunk>();
   private readonly pending = new Map<string, PendingReq>();
+  /** Reused scratch set — update() runs per tick and must not allocate. */
+  private readonly wantKeys = new Set<string>();
+  /** Memoised desired set: rings depend only on the car's chunk coordinates. */
+  private wantCache: Array<{ cx: number; cz: number; step: number }> | null = null;
+  private wantCacheCx = NaN;
+  private wantCacheCz = NaN;
@@
   update(carX: number, carZ: number): void {
-    const want = desiredChunks(carX, carZ);
-    const wantKeys = new Set<string>();
+    const ccx = Math.floor(carX / CHUNK_SIZE_M);
+    const ccz = Math.floor(carZ / CHUNK_SIZE_M);
+    if (!this.wantCache || ccx !== this.wantCacheCx || ccz !== this.wantCacheCz) {
+      this.wantCache = desiredChunks(carX, carZ).map(({ key, step }) => ({
+        cx: key.cx, cz: key.cz, step,
+      }));
+      this.wantCacheCx = ccx;
+      this.wantCacheCz = ccz;
+    }
+    const wantKeys = this.wantKeys;
+    wantKeys.clear();
```
…and iterate `wantCache` using a cached `keyOf(cx, cz)` string map, or switch the
`live`/`pending` maps to integer keys (`(cx + 512) * 1024 + (cz + 512)`), which also
removes the per-entry template-string allocations. Left unapplied because it touches
agent B's ownership; behaviour is byte-equivalent (desired set is purely
chunk-coordinate-derived).

### Requested export (nice-to-have) — `window.__understoryPerf` debug hook

v1 reads draw calls/triangles/instances/sim/render by parsing the `?debug=1` overlay
DOM text (works, but couples the collector to display formatting). A one-line export
in `main.ts` after renderer init would decouple it:

```diff
--- a/src/main.ts
+++ b/src/main.ts
@@ after `render.renderer` exists
+  // Perf-harness hook (also handy in devtools): live renderer.info view.
+  (window as unknown as { __understoryRenderer?: unknown }).__understoryRenderer =
+    render.renderer;
```

## Verification protocol notes

- Every number in `docs/PERF.md` is produced by `scripts/perf-report.mjs` reading
  collector output; raw rAF/overlay/heap series retained in
  `e2e/results/<mode>-raw.json` (committed — they are only ~4-5 KB each because the
  degenerate cadence produces so few samples).
- This environment (headless Chromium, Windows) renders through SwiftShader
  software rasterisation: frame-time gates are CPU-proxy only; GPU half of the
  budget is honestly NOT-MEASURED here and needs a hardware iGPU run.
- Function-level attribution of the single worst frame needs an attached profiler
  (CDP `Profiler` over SwiftShader distorts badly); the report names the *phase*
  (chunk streaming / CPU sim / render submit) from correlated overlay samples
  instead of inventing a function name.

## Measured outcome (2026-08-24, main @ 183d736; render path identical at 2059d5c)

Full tables in `docs/PERF.md`. Headline, both runs (`?autopilot=1` + held KeyW,
180 s window):

| | unthrottled | CPU 4× throttled |
|---|---|---|
| rAF frames captured in 180 s | 21 (<5 fps → percentiles not representative) | 36 |
| p50 / worst frame delta | 245 ms / 62.7 s | 1823 ms / 55.5 s |
| Post-load shader compiles | **12** (gate 0 → FAIL leg) | **12** |
| Median sim / render-submit | 26.3 / 13.2 ms | 74.1 / 79.2 ms |
| Draw calls median / max | 11 / 20 | 19 / 36 |
| Triangles at max-draw snapshot | 350 037 | 265 813 |
| Heap t0 → t180 | 17.4 MB → 17.4 MB (weak evidence: interval starved) | 19.6 → 19.6 MB |
| Boot marker | 1.0 s | 3.4 s |

**Gate verdict recorded in docs/PERF.md: FAIL** — compiles leg fails (12 > 0);
frame-time leg NOT-MEASURABLE here (SwiftShader cannot sustain interactive cadence;
a 320×180 probe still showed multi-second stalls). CPU-sim proxy medians recorded
per gate spec caveat.

Environment note: flora (`FloraWorld`) landed at `2059d5c` but nothing instantiates
it yet (verified by search), so the rendered scene at measurement time equals main's
wired path. **Re-run this collector after flora wiring lands** — it is a single
`pnpm e2e` away.

## Re-measure procedure

```
pnpm build && pnpm e2e            # runs e2e/perf.spec.ts (~16 min: 2 × 3-min drive)
node scripts/perf-report.mjs > docs/PERF.md
```
