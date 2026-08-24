# render-core notes (agent A)

Branch `feat/render-core`. Owns `src/core/*`, `tests/*core*`, this file.

## What shipped

| Piece | File | Notes |
|---|---|---|
| RenderCore | `src/core/renderer.ts` | WebGPU-first, retry-on-failure WebGL2 fallback, AgX tone mapping, explicit sRGB output |
| GameLoop | `src/core/loop.ts` | 60Hz accumulator per `contracts/frame.ts`, MAX_TICKS_PER_FRAME guard, interpolation alpha, per-phase ms timing |
| EventBus / SignalStore | `src/core/event-bus.ts`, `src/core/signal-store.ts` | Real dependency-tracked store replaces stub; wired via `services.ts` |
| QualityManager | `src/core/quality.ts`, `src/core/quality-tiers.ts` | low/medium/high/ultra/auto; auto = adaptive DPR on rolling 40-frame average of 16.6ms budget |
| DebugHud | `src/core/debug.ts` | `?debug=1` overlay: fps, ms breakdown, draw calls, tris, instances, JS heap, chunks, backend |

## Tone mapping: chose AgX over Neutral

The art direction is a calm, naturalistic forest; sky agent D will produce very
high dynamic range (low sun through canopy). AgX keeps hue stable as highlights
compress (bright foliage/sun glints desaturate toward neutral instead of
skewing orange/white like filmic or blowing out like Neutral's brighter knee).
Cost difference at our scale is negligible (one LUT-ish curve per output
pixel), and both backends implement it identically in r185 (`AgXToneMapping = 6`).
Exposure left at 1.0; D can tune via `toneMappingExposure` without touching core.

## Color space handling

- `renderer.outputColorSpace = SRGBColorSpace` set explicitly (is the default,
  pinned so nobody flips it accidentally).
- Working color space stays linear-sRGB (three default); TSL nodes operate linear.
- Default framebuffer created opaque (`alpha:false`) — cheaper composite.
- Contract for other agents: color textures upload with `SRGBColorSpace`,
  data textures keep `NoColorSpace`. Tone mapping applies only to lit output.

## What I tried / what failed

1. **three's silent WebGPU→WebGL2 fallback** exists already (`getFallback` in
   WebGPURenderer) when `navigator.gpu` is absent. It does NOT cover thrown
   init failures (device request rejected, context loss at boot), so RenderCore
   still wraps `init()` in try/catch and retries on a fresh renderer with
   `forceWebGL:true`. Both paths converge on probing
   `renderer.backend.isWebGPUBackend`.
2. **Signal-store stub had no dependency tracking** — every effect re-queued
   itself forever and never subscribed to anything. Replaced with a tracked
   implementation (dynamic deps, flush-drain, no sync cascades).
   First implementation had a real bug my own tests caught: signals subscribed
   the raw user fn instead of the wrapper, so dep cleanup/unsubscribe never
   matched. Fixed; regression-tested in `tests/core-signals.test.ts`.
3. **Adaptive-DPR warmup bug**: first version required 60 warmup samples but
   the ring buffer holds 40 → auto could never trigger. Warmup now equals one
   full window pass. Caught by `tests/core-quality.test.ts`.
4. **`renderer.info.instances` does not exist** in three r185 (drawCalls and
   triangles do). DebugStats requires an instance count, so DebugHud takes it
   via `setInstanceCount()` from whoever owns instanced meshes; until flora/
   world wire that it reports 0 honestly rather than guessing.
5. **Headless Chromium has no WebGPU**, which conveniently exercised the
   fallback path end-to-end (see measurements).

## Measured numbers (this machine, not CI)

Environment: Windows 11, Intel UHD Graphics iGPU (ANGLE D3D11), Playwright
Chromium 151 **headless shell** — no WebGPU available, so these numbers are
WebGL2-backend numbers at 1920×1080. A WebGPU-backend run on a real browser
was NOT possible here; do not treat GPU-side claims as proven for WebGPU.

- Backend detection log: `[understory] backend: webgl2; tone mapping: AgX`
- FPS: three consecutive 10s rAF windows after load: **60.1 / 60.1 / 60.1**
  (vsync-capped; empty scene, StubWorld ground plane)
- JS heap (`performance.memory.usedJSHeapSize`, sampled every 2s for ~64s):
  **9.5 MB flat, min = max = 9.5 MB** — no drift. (10-minute trace pending
  integration; loop allocates nothing per frame by construction.)
- Page errors: none. Build: `pnpm verify` green (typecheck+lint+31 tests+build);
  bundle 771 kB / 211 kB gzip (pre-splitting, includes Rapier).
- Screenshot: `C:\Users\eswar\understory-render-core.png` — scene renders,
  overlay visible top-left showing backend `webgl2`.

## Honest gaps

- Overlay shows live-updating zeros today because `src/main.ts` (read-only for
  me) calls `hud.update()` once with a static object and never feeds loop/
  renderer stats. Exact requested diff is in my handoff summary.
- `uiMs` is reported as 0 until the UI shell lands; the field is plumbed.
- Auto-tier currently adapts DPR only; feature flags never change mid-drive
  (deliberate: zero post-load shader compiles). Tier *switching* rebuilds
  pipelines by design — J should warm pipelines on tier change.
- No 60s+ WebGPU-backend heap trace (environment lacks WebGPU).

## Requested diffs outside my ownership

See final report: `src/main.ts` boot wiring (QualityManager, live DebugHud,
signals.flush, remove `setPixelRatio` from the resize handler).
