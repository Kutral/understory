# Release notes — DRAFT

> ⚠️ **DRAFT** — written by agent L2 (`feat/docs-deploy`) as a pre-alpha status
> snapshot for orchestrator review ahead of Wave 4. Every claim below is backed
> by a measurement or artifact cited in `docs/notes/*.md`. Nothing here is final
> copy; do not publish without re-verifying after Wave 1.5/2 land.

**Version:** 0.1.0 (unreleased) · **Branch state:** `main` integrated & green at
time of writing.

## What works today (verified)

- **Fixed-timestep engine core** — 60 Hz accumulator loop per
  `contracts/frame.ts`, interpolation alpha, zero-allocation phases, MAX_TICKS
  guard; empty scene holds **60 fps @1080p** (vsync-capped, WebGL2 backend) with
  a flat **9.5 MB JS heap over ~64 s** (`docs/notes/render-core.md`). WebGPU is
  the primary backend with retry-on-failure WebGL2 fallback and AgX tone mapping;
  headless CI has no WebGPU, so WebGPU-side claims are NOT proven yet.
- **Endless deterministic forest streaming** — seeded simplex FBM + domain warp
  heightfield, warped-spline trail network on a 192 m supergrid, five Chebyshev
  LOD rings (~640 m guarantee) with pooled geometry recycling, worker-pool
  generation using transferables. Byte-identical heightmaps for a given seed
  (unit test). Chunk generation **p50 ≈ 42–45 ms** off-thread, trail carve via
  spatial hash ≈ 42 ms vs ~330 ms naive (~7.9×), main-thread fill ≤ ~5 ms
  (`docs/notes/world-terrain.md`).
- **Soft Rapier raycast vehicle** — never flips in scripted testing (worst tilt
  9.3° over a 40 s bumpy run), recover rights a 170° tip to 24.6° in 3 s, top
  speed plateaus ~73 km/h under the 85 km/h cap, lift-off coast stops from
  53 km/h in 9.7 s without touching the brake. Timestep independence verified:
  bit-identical steering traces at 30 vs 144 fps render rates
  (`docs/notes/vehicle-input.md`).
- **Input stack** — remappable keyboard (WASD+arrows+Space+R, persisted),
  standard-mapping analog gamepad with 0.14 deadzone, touch overlay
  (steer arc / throttle-brake pad / Recover button); sources combine safely
  (recover edge-latched).
- **Sky & weather** — analytic sky model, 40-min day cycle, weather crossfade
  machine (30–60 s fades, continuous under retarget), clouds via curl-noise
  domain warp, exponential height fog, single texel-snapped sun/moon shadow rig.
  Ten fixed-seed lighting states screenshot-verified 10/10
  (`docs/notes/sky-atmosphere-shots/`). No cascade pop: intensity steps at band
  edges < 1e-4.
- **Fully synthesised audio** — zero shipped audio assets; engine/tyre/
  ambience/music/wind rigs plus automated one-shot voices on an **immutable**
  graph: node count stays exactly 70 across a simulated 10-minute session,
  update cost ≈ 1.65 µs/call, worst-case mix headroom −15.6 dBFS
  (`docs/notes/audio.md`).
- **UI shell** — opening line, diegetic enamel speed dial that self-hides after
  4 s idle, birch-paper pause/settings panel (graphics tier, six-channel sound
  faders + Silence preset, key remapping, reduced motion, horizon lock, seed
  entry). Keyboard-only operable; axe-core: **0 violations** on opening and
  pause fixtures; UI flush cost < 0.5 ms/frame steady-state
  (`docs/notes/ui-shell.md`, fixtures in `src/ui/fixtures/screens/`).
- **CI + Pages deploy** (this branch) — `pnpm verify` gate, Playwright chromium
  e2e step, GitHub Pages publishing of the `/understory/`-based build on `main`.

## What is NOT finished (honest list)

- **No trees.** Flora (agent G) is a Wave 2 stub: density-query phase runs but
  renders nothing; there are no trunk colliders yet either. The forest is terrain,
  trails, sky, fog — not vegetation.
- **No particles, wildlife, rain rendering, or post effects** beyond tone mapping
  (agent H, Wave 2). Sky supplies the rain signal only.
- **Placeholder car model** — clearly-marked procedural stand-in chassis with
  cylinder wheels; the estate wagon is future art work.
- **Wave 1.5 performance gate unmeasured** — p99 ≤ 20 ms over a 3-minute drive
  and zero post-load shader compiles have NOT been demonstrated end-to-end; the
  gate blocks Wave 2 and is in flight.
- **Gamepad and touch paths are code-reviewed and unit-tested in their pure math
  only** — no physical device passes have happened.
- **e2e suite is empty.** `playwright.config.ts` and CI plumbing exist (this
  branch); actual specs belong to agent L and haven't landed. CI uses
  `--pass-with-no-tests` until they do.
- **WebGPU backend unverified** — all rendered verification so far ran on the
  WebGL2 fallback (headless environments lack WebGPU).
- **Audio needs human ears** — graph-level guarantees hold; timbre/balance of the
  synthesised engine, tyres, birdsong and music pads are unverified by listening.
- **The Trace / photo mode** (agent I) and **quality-tier feature flags** (agent
  J) don't exist yet; settings expose hooks only.
- **Deploy base path assumption**: `vite.config.ts` pins `base '/understory/'`
  matching a repo *named `understory`*; no `origin` remote exists in this working
  copy to confirm the real repo name (see ADR 0003).

## Known rough edges

- Debug overlay instance count reports 0 honestly until instanced meshes wire it
  (`renderer.info.instances` doesn't exist in three r185).
- Collider sync relies on the streamer's LRU cache; if it races far ahead of
  streaming a chunk is briefly non-collidable and retried next tick.
- Audio's sky→audio bridge (`setSky()`) sits outside the current AudioBus
  contract pending an orchestrator decision.
