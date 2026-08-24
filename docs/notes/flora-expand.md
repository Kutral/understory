# flora-expand notes (Wave 2 solo pass, orchestrator)

## What landed

- `src/flora/species-geometry.ts` — birch / oak / dead-snag procedural
  builders reusing the pine vertex contract (`aFlex` wind coupling,
  `aPart` bark/foliage split). Birch = slim leaning trunk + small oval
  canopy blobs; oak = thick trunk + broad multi-lobed canopy; snag =
  bare leaning trunk + broken branch stubs, zero foliage vertices.
- `src/flora/placement.ts` — species table (0 pine, 1 birch, 2 oak,
  3 snag) + `pickSpecies(moisture, slope, density, roll)`:
  birch wants wet gentle ground; oak wants clearings on easy slopes;
  snags are rare (~2–7%) and favour drier sites. The pine acceptance
  RNG stream is untouched — species rolls use a second mulberry32 keyed
  `hashChunk ^ 0x5eed5eed`, so Wave 1.5 pine placement arrays stay
  byte-stable for existing seeds.
- `src/flora/material.ts` — `createSpeciesMaterial(palette)` shares the
  pine wind graph/pipeline: birch gets white banded paper-bark + pale
  leaves, oak gets furrowed dark bark + blue-green canopy. Hue channel
  still drives per-instance variation.
- Tests: `tests/flora-species.test.ts` (17 cases) + updated placement
  constraint test. **232 tests total, all green.**

## Measured

- Tri counts per tree (budget full ≤900 / mid ≤200 / far ≤60):
  - birch: full ~560, mid ~90, far ~30
  - oak: full ~840, mid ~150, far ~45
  - snag: full ~180, mid ~50, far ~16
- Species mix across a 13×13 chunk sample at seed 2026: all four species
  present; pines dominate as intended.
- Placement determinism: same seed+chunk → identical arrays (asserted).

## Honest gaps

1. **Render-ring wiring not done**: FloraWorld still builds only pine
   meshes. The species geometries/materials exist and are tested, but the
   InstancedMesh rings need to be duplicated per species (4 draws/LOD)
   with a species-aware fillBand. Estimated ~80 lines in flora-world.ts.
   Deferred so the perf gate measures one change at a time.
2. Impostor atlas still paints only the pine silhouette; per-species
   impostor textures are a follow-up (same painter pattern).
3. Wind visual validation remains by construction (no screenshot rig for
   gusts yet).
