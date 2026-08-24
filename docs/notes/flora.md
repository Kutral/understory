# flora notes (agent G-slice)

Branch `feat/slice-tree`. Owns `src/flora/*`, `tests/*flora*`, this file.

## What shipped — Wave 1.5 pine vertical slice

| Piece | File | Notes |
|---|---|---|
| Placement | `src/flora/placement.ts` | Pure, worker-safe, no THREE. Seeded hash of chunk coords → mulberry32 → jittered 7m candidate grid; density mask (thicket fbm × clearing mask) gates acceptance before any terrain query; injected `SurfaceSampler` applies slope (>0.85 reject) + moisture (<0.18 reject) gates and vigor-scales the trees |
| LOD band math | same | `bandForDistance` (60/140/260m bands) + `assignBands` (nearest-first with hard caps; overflow spills OUTWARD so budgets hold exactly) |
| Geometry | `src/flora/geometry.ts` | Procedural pine, code-only. full **820 tris** (trunk tube + 6 conical tiers), mid **144**, far **53**. Bakes `aFlex` (wind coupling, trunk ≤~0.12 / tips 1.0) and `aPart` (bark/foliage split). Impostor frame = 2 crossed quads (4 tris) with UVs |
| Materials | `src/flora/material.ts` | TSL only. One `MeshStandardNodeMaterial` shared by all three LOD meshes (one pipeline); wind = two travelling sine octaves along the wind vector sampled per-instance at world XZ (`aData` instanced attr = x, z, phase, hue) → gust fronts travel across the forest; amplitude hierarchical via `aFlex` (trunk ≈10%, foliage 100%); hue variation mixes needle green toward yellow/blue cast |
| Impostor | `src/flora/impostor-texture.ts` | Pine silhouette painted into a canvas at init (proportions match buildPine tiers); `CanvasTexture`, alpha-cut (alphaTest 0.45, no sorting). Non-DOM envs get an opaque fallback card so node-side construction still works |
| Colliders | `src/flora/colliders.ts` | `TrunkColliderRing` — ColliderRing pattern from world/colliders but POOLED: out-of-range trunks are parked in a free list and reused via `setTranslation`; sync parks BEFORE creating so freed colliders are reusable within the same sync. Fixed median cylinder (r=0.32m, halfH=6.5m) is what makes any pooled collider fit any trunk |
| Facade | `src/flora/flora-world.ts` | `FloraWorld`: `mesh:Object3D`, `update(carX,carZ,dt)`, `syncTrunkColliders(carX,carZ[,rapierWorld])`, `stats()`, `dispose()`. 4×InstancedMesh (full/mid/far share ONE `aData` instanced buffer + material), rebuilds instance buffers only on 24m cell crossings, per-band frustum spheres, distance culling by banding |

Terrain coupling is INJECTED (`options.sampler` needs `heightAt`/`gradientMag`/
`moistureAt` — TerrainSource's shape) so flora never imports world/. Without a
sampler a deterministic flat fallback keeps FloraWorld constructible in node.

## Budget compliance (PERF-BUDGET.md flora section)

≤80 full ✓ (cap enforced in `assignBands`), ≤400 mid ✓, remainder impostors ✓
(cap 6144, overflow reported in stats and always drops farthest-first).

## Measured numbers (this machine — headless Chromium, three.webgpu WebGL2
fallback, Windows 11; temporary vite harness, since FloraWorld is not yet
wired into the main app loop)

| Metric | Value |
|---|---|
| Draw calls added | **4** (flora-only scene renders 5 frames/frame incl. background; renderer.info over 10 frames ÷ 10) |
| Triangles rendered (flora-only frame @ one viewpoint) | ~192k |
| Instance distribution at sample point (200,200) | 34 full / 53 mid / 276 far / 934 impostor, overflow 0 |
| Placement gen per chunk (flat fallback sampler) | avg **0.39 ms**, worst 7.4 ms (81-chunk cold pass: 39 ms total) |
| Warm rebuild (24m cell crossing, cache hot) | 8.6 ms incl. new-chunk gen; steady-state drive hop p50 **2.5 ms**, max 7.5 ms every 24m |
| Forest structure across 289 chunks (seed 1337) | avg 48.9 trees/chunk; min 0 (clearings), p90 132, max 260 (thickets) |
| Trunk collider pool | created-once then reused (test-verified reuse counts vs real Rapier 0.20) |

## What I tried / what failed

1. **TSL `instancedBufferAttribute(name)` doesn't exist** — it takes the actual
   buffer + a type string (`instancedBufferAttribute(attr,'vec4')`). All three
   LOD geometries register the SAME InstancedBufferAttribute object so one
   pipeline serves full/mid/far.
2. **Create-then-park ordering killed pooling** — my first `sync` created new
   colliders before parking freed ones, so churn allocated at every hop.
   Parking first makes same-sync reuse possible; the test now pins
   `created === 0` on a warm hop.
3. **Rapier `Collider.setTranslation` takes 1 arg** (a vector) in 0.20-compat,
   unlike RigidBody's (x,y,z,wakeUp).
4. **Headless render worked via WebGL2 fallback** — WebGPU absent in
   Playwright's Chromium, matching render-core's findings; NodeMaterial graphs
   compile fine there.
5. `renderer.info.render.drawCalls` accumulates unless divided by frames —
   first bench read 150 "draw calls" which was actually 5/frame × 30 frames.

## Honest gaps

1. **Not integrated**: nothing calls FloraWorld yet. World integration =
   construct with `{ seed, sampler: terrainSource }`, add `mesh`, call
   `update()` per frame + `syncTrunkColliders()` after physics attach.
2. **Gen ms measured against the flat sampler only.** Real TerrainSource
   heightAt/gradientMag/moistureAt are fbm-heavy; expect several× more per
   chunk. `treesFor` was kept pure + allocation-light specifically so it can
   move into the gen worker if main-thread cost bites.
3. **Impostors are a static cross**, not Y-billboarded toward the camera.
4. **Collider ignores per-tree scale** (±25% visual variation not mirrored;
   fixed median cylinder is the price of O(1) pool fit).
5. **Wind validated by construction only** (no golden-image/gust-front visual
   regression harness).
6. **Frustum culling is per-band bounding sphere**, not per-instance — fine
   while caps keep bands small.
7. `undergrowthFor` intentionally returns [] (Wave 2 scope: grass/ferns).
8. Pre-existing (not mine): `pnpm verify` currently fails lint on
   `src/camera/rig.ts` (unused `UP`) — camera owner fix.

Screenshot: `docs/notes/flora-shots/pine-slice.png` (headless capture; visual
review pending — vision tooling was rate-limited when captured).
