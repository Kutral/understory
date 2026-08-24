import type { FloraLod, TreePlacement } from '@contracts/flora';
import type { ChunkKey } from '@contracts/world';

/**
 * Deterministic pine placement + LOD band assignment.
 *
 * Pure math only (no THREE, no DOM) so it is worker-safe and unit-testable.
 * The same seed + ChunkKey (+ same sampler answers) yields byte-identical
 * placement arrays — asserted in tests/flora-placement.test.ts.
 *
 * Terrain coupling is INJECTED via SurfaceSampler rather than importing
 * TerrainSource, so flora never depends on world/ (no circular imports);
 * the caller passes its TerrainSource-shaped object.
 */

/** Slope/moisture queries the world injects. Matches TerrainSource's shape. */
export interface SurfaceSampler {
  heightAt(x: number, z: number): number;
  /** Rise/run magnitude. */
  gradientMag(x: number, z: number): number;
  /** [0,1]. */
  moistureAt(x: number, z: number): number;
}

/**
 * Sampler used when the world hasn't injected one (pure-flora tests,
 * tooling): flat ground with gentle seeded moisture variation. Keeps
 * placements deterministic even without terrain.
 */
export class FlatSurfaceSampler implements SurfaceSampler {
  constructor(private readonly seed = 991) {}

  heightAt(_x: number, _z: number): number {
    return 0;
  }

  gradientMag(_x: number, _z: number): number {
    return 0;
  }

  moistureAt(x: number, z: number): number {
    let h = (this.seed | 0) ^ Math.imul(x * 1000 | 0, 0x27d4eb2d);
    h = Math.imul(h ^ ((z * 1000) | 0), 0x165667b1);
    h ^= h >>> 15;
    return (((h >>> 0) % 4096) / 4096) * 0.6 + 0.2;
  }
}

// ---- deterministic hashing -------------------------------------------------

/** Integer hash of chunk coords + seed → uint32. */
export function hashChunk(cx: number, cz: number, seed: number): number {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (cx | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (cz | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 PRNG — tiny, fast, deterministic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a ^ (a >>> 15);
    t = Math.imul(t, t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2D value noise in ~[-1,1] built on integer hashing. Smooth enough for masks. */
export function valueNoise(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fz = z - z0;
  // quintic fade
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uz = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const at = (ix: number, iz: number): number => {
    let h = (seed | 0) ^ Math.imul(ix | 0, 0x27d4eb2d);
    h = Math.imul(h ^ (iz | 0), 0x165667b1);
    h ^= h >>> 15;
    return ((h >>> 0) / 4294967296) * 2 - 1;
  };
  const n00 = at(x0, z0);
  const n10 = at(x0 + 1, z0);
  const n01 = at(x0, z0 + 1);
  const n11 = at(x0 + 1, z0 + 1);
  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uz;
}

function fbm(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let fx = x;
  let fz = z;
  let s = seed;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(fx, fz, s) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fz *= 1.97;
    s = (s ^ 0x5bd1e995) | 0;
  }
  return sum / norm;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ---- density model ---------------------------------------------------------

/** Candidate grid spacing in metres inside a chunk (jittered per cell). */
export const CANDIDATE_SPACING_M = 7;

/**
 * Forest-density mask in [0,1]: thickets where the thicket noise runs high,
 * genuine clearings where the clearing mask fires. Both are seeded so a new
 * seed reshapes the forest, not just shuffles the trees.
 */
export function forestDensity(x: number, z: number, seed: number): number {
  const thicket = fbm(x / 95, z / 95, seed ^ 0xa53_0001, 3); // ~[-1,1]
  const clearing = fbm(x / 300, z / 300, seed ^ 0xb64_0002, 2);

  // Clumpiness: soft threshold on thicket noise → dense stands with gaps.
  let d = smoothstep(-0.22, 0.55, thicket);
  // Clearings: broad meadows punched through the clumps (never fully bare).
  d *= 1 - smoothstep(0.3, 0.72, clearing * 0.5 + 0.5) * 0.94;
  return Math.min(1, Math.max(0, d));
}

// ---- placement -------------------------------------------------------------

/** Steeper than this (rise/run) is rock face: no trees. */
export const MAX_SLOPE = 0.85;
/** Drier than this is bare ridge/rock pavement: no trees. */
export const MIN_MOISTURE = 0.18;

// ---- species table (Wave 2) -------------------------------------------------
//
// Species indices are part of the placement contract (contracts/flora.ts):
//   0 = pine, 1 = birch, 2 = oak, 3 = snag.
// Selection happens AFTER the pine density gate so existing pine forests are
// byte-identical to Wave 1.5 for the same seed; the species roll consumes a
// separate RNG stream keyed differently, keeping old arrays stable.

export const SPECIES_BIRCH = 1;
export const SPECIES_OAK = 2;
export const SPECIES_SNAG = 3;

/**
 * Species selection for one accepted candidate site.
 * - birch: moist low ground (moisture high), gentle slope.
 * - oak: gentle slopes in clearings (low local density).
 * - snag: sparse anywhere (rare everywhere, slightly more on dry margins).
 * Everything else stays pine.
 */
export function pickSpecies(
  moisture: number,
  slope: number,
  density: number,
  roll: number,
): number {
  // Snags: rare everywhere (~4%), more common on drier sites.
  const snagP = 0.02 + (1 - moisture) * 0.05;
  if (roll < snagP) return SPECIES_SNAG;
  // Birch: needs wet feet + easy ground; competes with pine in hollows.
  if (moisture > 0.62 && slope < 0.35 && roll < 0.42) return SPECIES_BIRCH;
  // Oak: open clearings, mid moisture, easy slopes.
  if (density < 0.34 && slope < 0.45 && moisture > 0.3 && roll > 0.72) return SPECIES_OAK;
  return 0; // pine
}

/**
 * All tree placements for one chunk across ALL species, deterministic under
 * (seed, key, sampler). Positions are local to the chunk origin in metres,
 * per the TreePlacement contract. Sorted by candidate-grid order (row-major),
 * never by RNG order, so iteration is stable.
 *
 * Compatibility: the pine-acceptance stream is untouched, so pine-only
 * consumers see the same accept pattern as before; species rolls use a second
 * mulberry32 seeded from hashChunk ^ 0x5eed_5eed.
 */
export function treesFor(
  key: ChunkKey,
  seed: number,
  sampler: SurfaceSampler,
): TreePlacement[] {
  const rng = mulberry32(hashChunk(key.cx, key.cz, seed));
  const speciesRng = mulberry32((hashChunk(key.cx, key.cz, seed) ^ 0x5eed5eed) >>> 0);
  const ox = key.cx * 128;
  const oz = key.cz * 128;
  const n = Math.ceil(128 / CANDIDATE_SPACING_M);

  const out: TreePlacement[] = [];
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      // Jitter within the cell (±45%); clamp keeps us inside the chunk even
      // on border cells.
      const x = ox + Math.min(127.5, Math.max(0.5,
        (ix + 0.5) * CANDIDATE_SPACING_M + (rng() - 0.5) * CANDIDATE_SPACING_M * 0.9));
      const z = oz + Math.min(127.5, Math.max(0.5,
        (iz + 0.5) * CANDIDATE_SPACING_M + (rng() - 0.5) * CANDIDATE_SPACING_M * 0.9));

      // Cheapest gate first: pure density mask, no terrain sampling.
      const density = forestDensity(x, z, seed);
      const acceptP = density * 0.92;
      if (rng() >= acceptP) continue;

      // Terrain gates (injected sampler).
      const lx = x - ox;
      const lz = z - oz;
      const slope = sampler.gradientMag(x, z);
      if (slope > MAX_SLOPE) continue;
      const moisture = sampler.moistureAt(x, z);
      if (moisture < MIN_MOISTURE) continue;

      // Wet hollows grow bigger trees; dry margins stunted ones.
      const vigor = 0.8 + moisture * 0.4;

      // Species roll (separate stream; pine default keeps old behaviour).
      const species = pickSpecies(moisture, slope, density, speciesRng());

      // Birch runs slimmer and shorter; oak broader but similar height;
      // snags lean dead at reduced size. Scale multiplies the species'
      // own base geometry (species-geometry.ts).
      let scaleMul = 1;
      if (species === SPECIES_BIRCH) scaleMul = 0.85 + speciesRng() * 0.15;
      else if (species === SPECIES_OAK) scaleMul = 0.95 + speciesRng() * 0.2;
      else if (species === SPECIES_SNAG) scaleMul = 0.6 + speciesRng() * 0.25;

      out.push({
        x: lx,
        z: lz,
        species,
        scale: (0.75 + rng() * 0.5) * vigor * scaleMul,
        rotY: rng() * Math.PI * 2,
        hue: (rng() * 2 - 1) * 0.5,
      });
    }
  }
  return out;
}

// ---- LOD bands -------------------------------------------------------------

/** Distance bands (metres from car). Beyond FAR, impostors take over. */
export const FULL_MAX_M = 60;
export const MID_MAX_M = 140;
export const FAR_MAX_M = 260;

/** Hard instance caps per band (PERF-BUDGET.md flora section). */
export const FULL_CAP = 80;
export const MID_CAP = 400;
/** Far ring has no budget line; capped for sanity/impostor readability. */
export const FAR_CAP = 1400;

export function bandForDistance(dM: number): FloraLod {
  if (dM <= FULL_MAX_M) return 'full';
  if (dM <= MID_MAX_M) return 'mid';
  if (dM <= FAR_MAX_M) return 'far';
  return 'impostor';
}

/** A placed tree with everything the renderer needs. Worker-safe. */
export interface PlacedTree {
  readonly placement: TreePlacement;
  /** World-space position. */
  readonly wx: number;
  readonly wz: number;
  /** Ground height at (wx,wz) from the sampler. */
  readonly y: number;
  readonly distSq: number;
}

/** Chunk-local placements → world positions with ground height attached. */
export function materializePlacements(
  key: ChunkKey,
  placements: readonly TreePlacement[],
  sampler: SurfaceSampler,
): PlacedTree[] {
  const ox = key.cx * 128;
  const oz = key.cz * 128;
  return placements.map((placement) => {
    const wx = ox + placement.x;
    const wz = oz + placement.z;
    return { placement, wx, wz, y: sampler.heightAt(wx, wz), distSq: 0 };
  });
}

export interface BandAssignments {
  full: PlacedTree[];
  mid: PlacedTree[];
  far: PlacedTree[];
  impostor: PlacedTree[];
}

/**
 * Assign trees to LOD bands by distance with hard caps. Input must be sorted
 * ascending by distSq (we sort defensively here too): nearest trees claim the
 * detailed bands first; once a cap is hit, overflow spills outward — a full
 * band pushes its remainder into mid, mid into far, far into impostor, so
 * budgets are respected exactly while the nearest N always win.
 */
export function assignBands(trees: readonly PlacedTree[]): BandAssignments {
  const sorted = [...trees].sort((a, b) => a.distSq - b.distSq);
  const bands: BandAssignments = { full: [], mid: [], far: [], impostor: [] };
  const caps: Record<Exclude<FloraLod, 'impostor'>, number> = {
    full: FULL_CAP,
    mid: MID_CAP,
    far: FAR_CAP,
  };

  // Spill counters: how many trees have been pushed into each band from
  // nearer bands. A band is "closed" once native + spilled reaches its cap.
  const used: Record<string, number> = { full: 0, mid: 0, far: 0 };
  for (const tree of sorted) {
    const band = bandForDistance(Math.sqrt(tree.distSq));
    let target = band as Exclude<FloraLod, 'impostor'> | 'impostor';
    // Walk outward until an open band accepts us.
    while (target !== 'impostor' && (used[target] ?? 0) >= caps[target]) {
      target =
        target === 'full' ? 'mid' : target === 'mid' ? 'far' : 'impostor';
    }
    if (target !== 'impostor') used[target] = (used[target] ?? 0) + 1;
    bands[target].push(tree);
  }
  return bands;
}
