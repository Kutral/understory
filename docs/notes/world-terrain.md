# world-terrain — agent B notes

Branch `feat/world-terrain`. Everything under `src/world/` + `tests/world-*` +
this file. Verification: `pnpm verify` green (typecheck + eslint + 24 tests +
vite build) at every commit tip.

## What shipped

| Module | Role |
|---|---|
| `noise.ts` | splitmix32 PRNG, seeded permutation, 2D simplex, FBM + ridged multifractal |
| `terrain-source.ts` | canonical height/moisture/surface function; domain-warped stack (base → warped hills → gated ridges → valley deepening → clearings → trail carve); `fillChunk()` shared by main thread and workers |
| `trail-network.ts` | deterministic warped-spline trail lattice on a 192 m supergrid; quadratic Bézier edges (±46 m warp); `TrailField` spatial hash for fast distance queries |
| `lod.ts` | pure ring math: Chebyshev rings, per-ring decimation steps [1,1,2,4,8], skirt-aware index generation |
| `gen-executor.ts` | worker pool sized `max(1, min(hardwareConcurrency-1, 8))`, round-robin least-loaded dispatch, **transferable** result arrays; inline fallback executor for tests/no-Worker envs |
| `worker/terrain.worker.ts` | Vite module worker; one reused `TerrainSource`; posts heights/surface/moisture with transfer list |
| `geometry-pool.ts` | pooled BufferGeometries per LOD level (allocated once, recycled forever), shared index buffers, analytic bounding spheres (no vertex scans), skirt stitching, central-difference normals |
| `chunk-streamer.ts` | desired-set reconciliation, nearest-first requests, inflight cap `2×workers`, LOD upgrade path, eviction recycling |
| `colliders.ts` | Rapier heightfield ring (3×3 around car), create/destroy on ring crossing |
| `material.ts` | TSL-only surface material: triplanar-blended MaterialX noise over moss / leaf litter / compacted dirt / mud / wet rock driven by slope, altitude, moisture attr and surface-code attr. No GLSL strings, no `onBeforeCompile`. |
| `terrain-world.ts` | `World` contract facade; CPU queries run the same functions as worker generation; LRU grid cache feeds collider creation |

## Measured numbers

Machine: dev laptop (Node 22, vitest). Numbers from `tests/world-perf.test.ts`
(run with `--disableConsoleIntercept` to see them printed):

| Metric | Value |
|---|---|
| Full-res chunk gen (129² heights+moisture+surface+trail carve) | **p50 ≈ 42–45 ms, p95 ≈ 47–53 ms** |
| Single `influence()` query p95 | ~30–50 µs |
| Pooled geometry fill + normals, 129² (main thread) | max ≈ 3.0–5.0 ms |
| `desiredChunks()` (81 entries) | ≈ 11 µs/call |
| Full verify pipeline | green, tests 24/24, build 908 ms |

Gates encoded as assertions in the perf test (p95 < 120 ms/gen chunk,
max fill < 8 ms, planning < 50 µs).

## Tried / failed / fixed

- **Naive per-vertex trail queries**: gathering all candidate polylines once per
  chunk then brute-forcing every vertex against every sub-segment cost
  **~330 ms p50 / 1190 ms max** per full-res chunk (~16 M point-segment tests).
  Fix: `TrailField` spatial hash (24 m cells, segment-AABB insertion, exact
  AABB-rejected minimum) → **~42 ms p50**, a ~7.9× improvement, with
  bit-identical results to the single-query path.
- **Skirt vertex off-by-one**: first index build allocated `n-1` skirt verts per
  strip while quads need `n` (corners duplicated); produced out-of-range index
  references (caught by the "no out-of-range refs" unit test). Fixed: strips own
  `n` verts each; `totalVerts = n² + 4n`.
- **Rapier heightfield orientation**: the JS docs imply `heights[i + j*nrows]`
  with rows along X. Empirically (encoded-grid raycast test):
  - `scale` in 0.20.0 is the field's **full x/z size**, NOT per-cell spacing.
    Passing `chunkSize/(n-1)` made colliders span ±0.5 m — rays only hit dead
    centre. This was invisible until we raycast away from the origin.
  - height indexing is `heights[iz + ix*nrows]` (first axis = local Z), so our
    row-major `[iz*N + ix]` grid needs a transpose on copy (`toRapierHeights`).
  The orientation test pins both facts; any Rapier change fails loudly.
- **`world.castRay` before first `step()`** returns null/garbage through the
  broad-phase. Non-issue in-game (fixed 60 Hz loop), noted in the test.
- **Mutating `RAPIER.Ray.origin`** does not reliably reach wasm memory; construct
  a fresh Ray per query.
- **simplex2 overshoot**: unclamped scaling hit −1.031 on adversarial inputs;
  now hard-clamped to [−1,1] (deterministic).
- **float32 grid vs float64 `heightAt`**: grid stores rounded values, worst diff
  observed 6.6e-7 at h≈10.5. Comparisons use float32-tolerance bounds.

## Honest gaps

- No rendered screenshot yet: this branch has no wired renderer scene (agent A
  owns `main.ts`). All claims are backed by unit tests + CPU measurements.
  Requested orchestrator diff: swap `new StubWorld()` for
  `new TerrainWorld(seed)` (+ optional `attachPhysics`) in `src/main.ts`;
  legacy stub kept exporting so boot still compiles.
- Worker pool path is not exercised inside vitest (node env has no `Worker`);
  the inline executor shares `fillChunk` byte-for-byte, and pool code is typed
  + build-checked. A playwright pass should assert real worker streaming later.
- Material compiles only after WebGPU/WebGL2 init; not exercised headlessly
  here. TSL graph uses documented node ops only.
- Collider grids come from the streamer's LRU cache (cap 64 chunks ≈ 4 MB);
  if a collider sync races far ahead of streaming the chunk simply isn't
  collidable that tick and is retried next sync.
