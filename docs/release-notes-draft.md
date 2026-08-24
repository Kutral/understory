# Release notes — v0.1.0 DRAFT

> ⚠️ **PRE-ALPHA — honest snapshot, not marketing copy.** Do not publish without
> re-verifying. Every claim below is backed by a measurement or artifact cited in
> [`docs/PERF.md`](PERF.md) or `docs/notes/*.md`. Rendered verification to date ran
> on the WebGL2 fallback under headless Chromium (SwiftShader) unless noted —
> see PERF.md for why that caveat matters.

**Version:** 0.1.0 · **State:** `main` integrated and green (256 unit tests) at
time of writing.

## What works

### Engine core

- Fixed-timestep 60 Hz accumulator loop (`src/contracts/frame.ts`) with
  interpolation alpha, zero-allocation phases and a MAX_TICKS guard; empty scene
  holds 60 fps @1080p with a flat heap (`docs/notes/render-core.md`).
- WebGPU-first renderer with retry-on-failure WebGL2 fallback and AgX tone
  mapping. WebGPU itself remains unproven (headless CI has no WebGPU).

### World

- Endless deterministic forest: seeded simplex FBM + domain-warped heightfield,
  warped-spline trail network on a 192 m supergrid, five Chebyshev LOD rings
  (~640 m guaranteed radius) with pooled geometry recycling, worker-pool
  generation using transferables. Same seed → byte-identical heightmaps
  (unit-tested). Chunk generation p50 ≈ 42–45 ms off-thread; trail carve via
  spatial hash ~42 ms vs ~330 ms naive (~7.9×) (`docs/notes/world-terrain.md`).

### Driving

- Soft Rapier raycast vehicle: never flips in scripted testing, recover rights a
  170° tip in ~3 s, top speed plateaus ~73 km/h under the cap, timestep
  independence proven with bit-identical steering traces at 30 vs 144 fps
  (`docs/notes/vehicle-input.md`).
- Input stack: remappable persisted keyboard, standard-mapping analog gamepad
  (0.14 smoothstep deadzone), touch overlay; sources combine safely and Recover
  is edge-latched. Remap collisions resolve by swap + explain.

### Forest life & modes (new since the Wave 2 stubs)

- **Trees** — four species placed deterministically: pine everywhere its density
  gate accepts, birch on moist low ground, oak on gentle clearing slopes, snags
  rare on dry margins (`src/flora/placement.ts`).
- **Life & particles** — pooled rain, fireflies, dust motes, falling leaves and
  birds, driven by sky/weather state, with a reduced-motion kill switch wired
  from the settings toggle through to the fx systems and camera rig.
- **The Trace** — press <kbd>M</kbd> for the plate view of the trail you've drawn.
- **Photo mode** — press <kbd>P</kbd> to pause the world and export a 2× PNG.

### Sky, atmosphere & UI

- Analytic sky model, 40-minute day cycle, weather crossfades (30–60 s fades),
  curl-noise clouds, exponential height fog, texel-snapped sun/moon shadows;
  ten fixed-seed lighting states verified 10/10 against reference shots
  (`docs/notes/sky-atmosphere-shots/`).
- Fully synthesised soundscape (zero shipped audio assets) on an immutable node
  graph: node count stable at exactly 70 across a simulated 10-minute session,
  ≈1.65 µs/update (`docs/notes/audio.md`).
- UI shell: opening line, diegetic enamel speed dial, birch-paper pause/settings
  panel (graphics tier, six-channel faders + Silence preset, key remapping,
  reduced motion, horizon lock, seed entry). Keyboard-only operable; axe-core
  reports 0 violations on opening and pause fixtures; `prefers-reduced-motion`
  and `prefers-contrast` CSS honoured (`docs/notes/ui-shell.md`).

### Measured performance ([docs/PERF.md](PERF.md) — headless WebGL2/SwiftShader)

Frame times from this environment are a CPU-side proxy, NOT
iGPU-representative; the counts below are valid measurements from 3-minute
autopilot drives (unthrottled + 4× CPU-throttled):

- Draw calls ≤ **36** observed at peak (medians 11–19).
- JS heap flat: **+0.0%** over 180 s in both runs (17.4 MB and 19.6 MB).
- Boot → first interactive ≈ **1.0 s** (unthrottled run).
- Post-load shader compiles cut **12 → 3** by a boot-time warmup pass (pumps all
  81 chunks, then `compileAsync`, before the booted marker); the residual 3 are
  attributed to early-tick sky/light-state variants (PERF.md addendum).
- Playwright e2e specs (boot/input/trace) run against `pnpm preview` in CI.

## What is not finished

- **Species render wiring merge** — birch/oak/snag each render through their own
  separately-wired path next to the original pine pipeline; one merged pipeline
  (shared materials, unified draw-call budget) is pending.
- **Residual post-load shader compiles** — 3 remain against the gate's target of
  0. Bounded and named (sky/light variants firing on the first fixed ticks), not
  yet eliminated.
- **Real-GPU frame gate** — p99 ≤ 20 ms over a 3-minute drive is NOT-MEASURED:
  SwiftShader cannot produce representative frame times. An iGPU hardware run is
  required before this gate can honestly pass or fail.
- **Undergrowth/grass** — the forest floor has trails and leaf-fall but no ground
  vegetation layer; meadows read bare up close.
- **Audio spatial upgrades** — the graph is stable but the mix is essentially
  static-stereo: no listener-relative positioning or occlusion yet, and timbre/
  balance remain unverified by human ears.
- Placeholder procedural car chassis (cylinder wheels); the estate wagon is
  future art work.
- Gamepad and touch paths are unit-tested in their pure math only — no physical
  device passes have happened.
- WebGPU backend unverified end-to-end (all rendered verification used WebGL2).
- Quality-tier feature flags expose settings hooks only.
- Deploy base path `/understory/` matches a repo *named* `understory`; no
  `origin` exists here to confirm (documented assumption, ADR 0003).
