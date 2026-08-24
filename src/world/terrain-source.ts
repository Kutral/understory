import { CHUNK_GRID, CHUNK_SIZE_M } from '@contracts/constants';
import {
  SURFACE_GRASS,
  SURFACE_MUD,
  SURFACE_ROCK,
  SURFACE_TRAIL,
  type ChunkData,
  type ChunkKey,
  type SurfaceMask,
} from '@contracts/world';
import { clamp01, lerp, makeNoiseField, smoothstep, type NoiseField } from './noise';
import { TrailNetwork } from './trail-network';

/**
 * The deterministic terrain function. Everything downstream (workers, colliders,
 * flora, `heightAt`) samples this one implementation so the world can never
 * disagree with itself.
 *
 * Stack (all seeded, domain-warped):
 *   1. base      — very low frequency continent shape
 *   2. hills     — warped FBM rolling hills
 *   3. ridges    — ridged multifractal masked to high ground
 *   4. valleys   — power shaping that deepens low ground
 *   5. clearings — flat meadows where a clearing mask fires
 *   6. trails    — compacted-dirt carving along the trail network
 */

/** Depth of the compacted-dirt carve at trail centreline (metres). */
export const TRAIL_CARVE_DEPTH_M = 0.55;

export interface TerrainSample {
  height: number;
  moisture: number;
  influence: number;
}

export class TerrainSource {
  private seed = 1337;
  private base!: NoiseField;
  private hills!: NoiseField;
  private warpX!: NoiseField;
  private warpZ!: NoiseField;
  private ridge!: NoiseField;
  private clearings!: NoiseField;
  private moisture!: NoiseField;
  private trails!: TrailNetwork;

  constructor(seed = 1337) {
    this.setSeed(seed);
  }

  setSeed(seed: number): void {
    this.seed = seed | 0;
    // Distinct independent fields; XOR constants are arbitrary but fixed.
    this.base = makeNoiseField(this.seed ^ 0x1b73_0001);
    this.hills = makeNoiseField(this.seed ^ 0x2c84_0002);
    this.warpX = makeNoiseField(this.seed ^ 0x3d95_0003);
    this.warpZ = makeNoiseField(this.seed ^ 0x4ea6_0004);
    this.ridge = makeNoiseField(this.seed ^ 0x5fb7_0005);
    this.clearings = makeNoiseField(this.seed ^ 0x60a8_0006);
    this.moisture = makeNoiseField(this.seed ^ 0x71b9_0007);
    this.trails = new TrailNetwork(this.seed);
  }

  get currentSeed(): number {
    return this.seed;
  }

  get trailNetwork(): TrailNetwork {
    return this.trails;
  }

  /** Raw landscape before trails — exposed for tests/debug tooling. */
  rawHeight(x: number, z: number): number {
    // Domain warp: big swirls displace every later sample.
    const wx = x + this.warpX.fbm(x / 512, z / 512, 3, 1) * 90;
    const wz = z + this.warpZ.fbm(x / 512, z / 512, 3, 1) * 90;

    const baseH = this.base.fbm(x / 1100, z / 1100, 2, 1) * 18;

    // Rolling warped hills.
    const h1 = this.hills.fbm(wx / 240, wz / 240, 4, 1, 0.52);
    const h2 = this.hills.fbm(wx / 61, wz / 61, 2, 1, 0.45);
    let h = baseH + h1 * 13 + h2 * 2.6;

    // Ridgelines: ridged multifractal gated to higher ground.
    const ridgeGate = smoothstep(2, 10, h - baseH);
    const r = this.ridge.ridged(wx / 420, wz / 420, 4, 1, 0.5);
    h += (r - 0.35) * 26 * ridgeGate;

    // Valleys: deepen low ground so streams of space wind between hills.
    if (h < 2) h -= Math.pow(1 - clamp01((h + 14) / 16), 1.6) * 6;

    // Clearings: flatten toward local base where the mask is strong.
    const cmask = smoothstep(
      0.28,
      0.62,
      this.clearings.fbm(x / 340, z / 340, 2, 1, 0.55) * 0.5 + 0.5,
    );
    h = lerp(h, baseH + 1.2, cmask * 0.92);

    return h;
  }

  /** Moisture in [0,1]: wet hollows, dry ridges and trail beds. */
  moistureAt(x: number, z: number, height?: number): number {
    const h = height ?? this.heightAt(x, z);
    let m = 0.52 + this.moisture.fbm(x / 310, z / 310, 3, 1, 0.55) * 0.42;
    m -= smoothstep(4, 26, h) * 0.38; // high ground dries out
    m += smoothstep(0, -8, h) * 0.22; // deep valleys stay boggy
    return clamp01(m);
  }

  /** Full sample including trail carving — the canonical height function. */
  sample(x: number, z: number): TerrainSample {
    const inf = this.trails.influence(x, z);
    const h = this.rawHeight(x, z) - TRAIL_CARVE_DEPTH_M * inf;
    // Same trail-drying factor fillChunk applies, so CPU queries agree with
    // worker-generated moisture/surface data exactly.
    const moisture = this.moistureAt(x, z, h) * (1 - 0.35 * inf);
    return { height: h, moisture, influence: inf };
  }

  heightAt(x: number, z: number): number {
    const inf = this.trails.influence(x, z);
    const h = this.rawHeight(x, z);
    return h - TRAIL_CARVE_DEPTH_M * inf;
  }

  surfaceAt(x: number, z: number): number {
    const s = this.sample(x, z);
    return classifySurface(s.influence, s.moisture, s.height, this.gradientMag(x, z));
  }

  /** Cheap forward-difference slope magnitude (rise/run). */
  gradientMag(x: number, z: number, eps = 1.5): number {
    const hx = this.heightAt(x + eps, z) - this.heightAt(x - eps, z);
    const hz = this.heightAt(x, z + eps) - this.heightAt(x, z - eps);
    return Math.hypot(hx, hz) / (2 * eps);
  }

  /**
   * Generate one full chunk on this thread. Workers call the pure free function
   * `generateChunk` below with freshly constructed sources; both share
   * `fillChunk` so results are byte-identical by construction.
   */
  generate(key: ChunkKey): ChunkData {
    return fillChunk(this, key);
  }
}

function classifySurface(inf: number, moist: number, _h: number, grad: number): number {
  if (inf >= 0.45) return SURFACE_TRAIL;
  if (grad > 0.85) return SURFACE_ROCK;
  if (moist > 0.66 && grad < 0.4) return SURFACE_MUD;
  return SURFACE_GRASS;
}

/**
 * Shared per-chunk generation used by TerrainSource.generate and the worker.
 * Writes into caller-provided arrays when given (pool reuse), otherwise allocates.
 */
export function fillChunk(
  src: TerrainSource,
  key: ChunkKey,
  out?: { heights: Float32Array; surface: Uint8Array; moisture: Float32Array },
): ChunkData {
  const n = CHUNK_GRID;
  const heights = out?.heights ?? new Float32Array(n * n);
  const surface = out?.surface ?? (new Uint8Array(n * n) as SurfaceMask);
  const moisture = out?.moisture ?? new Float32Array(n * n);

  const ox = key.cx * CHUNK_SIZE_M;
  const oz = key.cz * CHUNK_SIZE_M;
  const step = CHUNK_SIZE_M / (n - 1);

  // Build a spatially-bucketed trail distance field once for the whole chunk.
  const field = src.trailNetwork.fieldNear(
    ox - 32,
    oz - 32,
    ox + CHUNK_SIZE_M + 32,
    oz + CHUNK_SIZE_M + 32,
  );

  // Pass 1: raw heights.
  for (let iz = 0; iz < n; iz++) {
    const z = oz + iz * step;
    for (let ix = 0; ix < n; ix++) {
      heights[iz * n + ix] = src.rawHeight(ox + ix * step, z);
    }
  }

  // Pass 2: trail carving + moisture (influence reused by pass 3).
  const influence = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    const z = oz + iz * step;
    for (let ix = 0; ix < n; ix++) {
      const idx = iz * n + ix;
      const x = ox + ix * step;
      const inf = field.influence(x, z);
      influence[idx] = inf;
      heights[idx] = (heights[idx] as number) - TRAIL_CARVE_DEPTH_M * inf;
      moisture[idx] = src.moistureAt(x, z, heights[idx] as number) * (1 - 0.35 * inf);
    }
  }

  // Pass 3: gradients + surface classification (uses carved heights in-grid).
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const idx = iz * n + ix;
      const gx =
        (ix === 0 ? (heights[idx] as number) : (heights[idx - 1] as number)) -
        (ix === n - 1 ? (heights[idx] as number) : (heights[idx + 1] as number));
      const gz =
        (iz === 0 ? (heights[idx] as number) : (heights[(iz - 1) * n + ix] as number)) -
        (iz === n - 1 ? (heights[idx] as number) : (heights[(iz + 1) * n + ix] as number));
      const grad = Math.hypot(gx, gz) / (2 * step);
      surface[idx] = classifySurface(
        influence[idx] as number,
        moisture[idx] as number,
        heights[idx] as number,
        grad,
      );
    }
  }

  return { key, heights, surface: surface as SurfaceMask, moisture };
}
