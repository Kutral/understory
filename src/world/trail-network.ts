import { clamp01, hash2, lerp, makeNoiseField, smoothstep, type NoiseField } from './noise';

/**
 * Deterministic procedural TRAIL NETWORK.
 *
 * Design:
 *  - A supergrid of junction nodes every TRAIL_CELL_M metres; each node sits at a
 *    seeded jitter inside its cell. Grid edges (east + south of every node) form
 *    the network: it is everywhere connected, so there is always something
 *    inviting to follow and never a wall.
 *  - Every edge is a quadratic Bézier warped sideways by seeded jitter plus a
 *    large-scale noise bend, so trails meander like footpaths, not grid lines.
 *  - `influence(x,z)` is 1 at the centreline → 0 beyond the feather edge. Terrain
 *    carving lowers heights by depth*influence; the surface mask marks dirt.
 */

export const TRAIL_CELL_M = 192;
/** Half-width of full compaction (metres). */
export const TRAIL_HALF_WIDTH_M = 2.8;
/** Distance at which influence reaches zero (metres). */
export const TRAIL_FEATHER_M = 7.5;
/** Max lateral warp of an edge midpoint (metres). */
const EDGE_WARP_M = 46;
/** Sub-segments per edge polyline for distance queries. */
export const EDGE_SUBDIVS = 10;

export interface Polyline {
  /** Flat [x0,z0,x1,z1,...] with (EDGE_SUBDIVS+1) points. */
  readonly pts: Float32Array;
}

interface CellEdges {
  /** East edge: node(i,j) -> node(i+1,j). */
  east: Polyline;
  /** South edge: node(i,j) -> node(i,j+1). */
  south: Polyline;
}

function nodePos(seed: number, i: number, j: number): { x: number; z: number } {
  // Jitter kept inside ±30% of the cell so Bézier hulls stay near their cells.
  const jx = (hash2(i, j, seed) - 0.5) * TRAIL_CELL_M * 0.6;
  const jz = (hash2(i, j, seed ^ 0x51ab3f) - 0.5) * TRAIL_CELL_M * 0.6;
  return { x: i * TRAIL_CELL_M + jx, z: j * TRAIL_CELL_M + jz };
}

/** Test hook: deterministic junction position for supergrid node (i,j). */
export function nodePosForTests(seed: number, i: number, j: number): { x: number; z: number } {
  return nodePos(seed, i, j);
}

/** Quadratic Bézier sampled into a polyline. */
function sampleBezier(
  ax: number,
  az: number,
  cx: number,
  cz: number,
  bx: number,
  bz: number,
): Polyline {
  const pts = new Float32Array((EDGE_SUBDIVS + 1) * 2);
  for (let k = 0; k <= EDGE_SUBDIVS; k++) {
    const t = k / EDGE_SUBDIVS;
    const u = 1 - t;
    pts[k * 2] = u * u * ax + 2 * u * t * cx + t * t * bx;
    pts[k * 2 + 1] = u * u * az + 2 * u * t * cz + t * t * bz;
  }
  return { pts };
}

export class TrailNetwork {
  private readonly seed: number;
  private readonly bendNoise: NoiseField;
  private cache = new Map<string, CellEdges>();

  constructor(seed: number) {
    this.seed = seed | 0;
    this.bendNoise = makeNoiseField((seed ^ 0x74a11) | 0);
  }

  /** The two outgoing polylines for one supergrid cell (cached, LRU-capped). */
  private cellEdges(ci: number, cj: number): CellEdges {
    const key = `${ci},${cj}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const s = this.seed;
    const a = nodePos(s, ci, cj);

    // East edge -> node(ci+1,cj)
    const bE = nodePos(s, ci + 1, cj);
    const midEx = (a.x + bE.x) / 2;
    const midEz = (a.z + bE.z) / 2;
    // Perpendicular of the chord, plus a long-wave noise bend.
    const dxE = bE.x - a.x;
    const dzE = bE.z - a.z;
    const lenE = Math.hypot(dxE, dzE);
    const warpE =
      (hash2(ci * 2, cj, s ^ 0xe57a) - 0.5) * 2 * EDGE_WARP_M +
      this.bendNoise.fbm(midEx / 640, midEz / 640, 2, 1) * EDGE_WARP_M;
    const cEx = midEx + (-dzE / lenE) * warpE;
    const cEz = midEz + (dxE / lenE) * warpE;

    // South edge -> node(ci,cj+1)
    const bS = nodePos(s, ci, cj + 1);
    const midSx = (a.x + bS.x) / 2;
    const midSz = (a.z + bS.z) / 2;
    const dxS = bS.x - a.x;
    const dzS = bS.z - a.z;
    const lenS = Math.hypot(dxS, dzS);
    const warpS =
      (hash2(ci, cj * 2, s ^ 0x50dd) - 0.5) * 2 * EDGE_WARP_M +
      this.bendNoise.fbm(midSx / 640, midSz / 640, 2, 1) * EDGE_WARP_M;
    const cSx = midSx + (dzS / lenS) * warpS;
    const cSz = midSz + (-dxS / lenS) * warpS;

    const edges: CellEdges = {
      east: sampleBezier(a.x, a.z, cEx, cEz, bE.x, bE.z),
      south: sampleBezier(a.x, a.z, cSx, cSz, bS.x, bS.z),
    };

    // Simple LRU-ish cap: drop oldest insertion when over budget.
    if (this.cache.size >= 1024) {
      const first = this.cache.keys().next();
      if (!first.done) this.cache.delete(first.value);
    }
    this.cache.set(key, edges);
    return edges;
  }

  /**
   * All trail polylines plausibly within `margin` metres of the AABB. A Bézier
   * stays inside the convex hull of its endpoints and control point; endpoints
   * live inside adjacent cells with ≤30% jitter and control offset ≤ ~1.4*CELL,
   * so scanning cells one ring out from the AABB is safely conservative.
   */
  polylinesNear(minX: number, minZ: number, maxX: number, maxZ: number): Polyline[] {
    const pad = TRAIL_CELL_M * 2 + EDGE_WARP_M * 2;
    const ci0 = Math.floor((minX - pad) / TRAIL_CELL_M);
    const ci1 = Math.floor((maxX + pad) / TRAIL_CELL_M);
    const cj0 = Math.floor((minZ - pad) / TRAIL_CELL_M);
    const cj1 = Math.floor((maxZ + pad) / TRAIL_CELL_M);
    const out: Polyline[] = [];
    for (let ci = ci0; ci <= ci1; ci++) {
      for (let cj = cj0; cj <= cj1; cj++) {
        const e = this.cellEdges(ci, cj);
        out.push(e.east, e.south);
      }
    }
    return out;
  }

  /** Debug/test hook: one specific edge polyline of a supergrid cell. */
  edgeFor(ci: number, cj: number, dir: 'east' | 'south'): Polyline {
    const e = this.cellEdges(ci, cj);
    return dir === 'east' ? e.east : e.south;
  }

  /** Squared distance from p to one polyline. */
  static distanceSqToPolyline(pl: Polyline, x: number, z: number): number {
    const pts = pl.pts;
    let best = Infinity;
    for (let k = 0; k < EDGE_SUBDIVS; k++) {
      const ax = pts[k * 2] as number;
      const az = pts[k * 2 + 1] as number;
      const bx = pts[k * 2 + 2] as number;
      const bz = pts[k * 2 + 3] as number;
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz;
      let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + t * dx - x;
      const pz = az + t * dz - z;
      const d2 = px * px + pz * pz;
      if (d2 < best) best = d2;
    }
    return best;
  }

  distanceTo(x: number, z: number): number {
    const pls = this.polylinesNear(x, z, x, z);
    let best = Infinity;
    for (const pl of pls) {
      const d2 = TrailNetwork.distanceSqToPolyline(pl, x, z);
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  }

  influence(x: number, z: number): number {
    const d = this.distanceTo(x, z);
    // 1 at centreline, smooth falloff to 0 at feather edge.
    return 1 - smoothstep(TRAIL_HALF_WIDTH_M, TRAIL_FEATHER_M, d);
  }

  isTrail(x: number, z: number): boolean {
    return this.influence(x, z) >= 0.5;
  }

  /** Debug/Trace helper: polyline sub-segments overlapping the chunk's cell area. */
  segmentsFor(
    key: { cx: number; cz: number },
    chunkSizeM: number,
  ): Array<{ ax: number; az: number; bx: number; bz: number }> {
    const minX = key.cx * chunkSizeM;
    const minZ = key.cz * chunkSizeM;
    const pls = this.polylinesNear(minX, minZ, minX + chunkSizeM, minZ + chunkSizeM);
    const segs: Array<{ ax: number; az: number; bx: number; bz: number }> = [];
    for (const pl of pls) {
      for (let k = 0; k < EDGE_SUBDIVS; k++) {
        segs.push({
          ax: pl.pts[k * 2] as number,
          az: pl.pts[k * 2 + 1] as number,
          bx: pl.pts[k * 2 + 2] as number,
          bz: pl.pts[k * 2 + 3] as number,
        });
      }
    }
    return segs;
  }

  /**
   * Fast batched influence for chunk generation: build a `TrailField` from the
   * gathered polylines once per chunk, then query it per vertex (spatially
   * bucketed, exact same minimum-distance result as `influence()`).
   */
  fieldNear(minX: number, minZ: number, maxX: number, maxZ: number): TrailField {
    return new TrailField(this.polylinesNear(minX, minZ, maxX, maxZ));
  }

  /** Smooth interpolation helper exposed for heightfield shaping. */
  static mix = lerp;
}

/**
 * Spatial hash over trail sub-segments for O(local) distance queries.
 * Produces bit-identical distances to `TrailNetwork.distanceTo` because both
 * evaluate the exact same point-segment math over the complete candidate set.
 */
export class TrailField {
  private static readonly CELL = 24; // metres; ≥ 2× feather keeps queries local

  private readonly segs: Float32Array; // [ax,az,bx,bz] × n
  private readonly bounds: Float32Array; // [minX,minZ,maxX,maxZ] × n
  private readonly buckets = new Map<number, Map<number, number[]>>();

  constructor(polylines: Polyline[]) {
    const count = polylines.length * EDGE_SUBDIVS;
    this.segs = new Float32Array(count * 4);
    this.bounds = new Float32Array(count * 4);
    const cell = TrailField.CELL;

    let s = 0;
    for (const pl of polylines) {
      const pts = pl.pts;
      for (let k = 0; k < EDGE_SUBDIVS; k++) {
        const ax = pts[k * 2] as number;
        const az = pts[k * 2 + 1] as number;
        const bx = pts[k * 2 + 2] as number;
        const bz = pts[k * 2 + 3] as number;
        this.segs[s * 4] = ax;
        this.segs[s * 4 + 1] = az;
        this.segs[s * 4 + 2] = bx;
        this.segs[s * 4 + 3] = bz;
        const mnx = Math.min(ax, bx);
        const mnz = Math.min(az, bz);
        const mxx = Math.max(ax, bx);
        const mxz = Math.max(az, bz);
        this.bounds[s * 4] = mnx;
        this.bounds[s * 4 + 1] = mnz;
        this.bounds[s * 4 + 2] = mxx;
        this.bounds[s * 4 + 3] = mxz;

        // Insert into every bucket cell the segment's AABB overlaps.
        const cx0 = Math.floor(mnx / cell);
        const cx1 = Math.floor(mxx / cell);
        const cz0 = Math.floor(mnz / cell);
        const cz1 = Math.floor(mxz / cell);
        for (let cx = cx0; cx <= cx1; cx++) {
          let row = this.buckets.get(cx);
          if (!row) {
            row = new Map<number, number[]>();
            this.buckets.set(cx, row);
          }
          for (let cz = cz0; cz <= cz1; cz++) {
            let list = row.get(cz);
            if (!list) {
              list = [];
              row.set(cz, list);
            }
            list.push(s);
          }
        }
        s++;
      }
    }
  }

  /** Exact squared distance to the nearest sub-segment (bucket-accelerated). */
  distanceSq(x: number, z: number): number {
    const cell = TrailField.CELL;
    const r = TRAIL_FEATHER_M;
    const cx0 = Math.floor((x - r) / cell);
    const cx1 = Math.floor((x + r) / cell);
    const cz0 = Math.floor((z - r) / cell);
    const cz1 = Math.floor((z + r) / cell);

    let best = Infinity;
    for (let cx = cx0; cx <= cx1; cx++) {
      const row = this.buckets.get(cx);
      if (!row) continue;
      for (let cz = cz0; cz <= cz1; cz++) {
        const list = row.get(cz);
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const s = list[i] as number;
          // AABB rejection preserves the exact min: any skipped segment is
          // provably farther than the running best.
          const bMinX = this.bounds[s * 4] as number;
          const bMinZ = this.bounds[s * 4 + 1] as number;
          const bMaxX = this.bounds[s * 4 + 2] as number;
          const bMaxZ = this.bounds[s * 4 + 3] as number;
          const dx0 = x < bMinX ? bMinX - x : x > bMaxX ? x - bMaxX : 0;
          const dz0 = z < bMinZ ? bMinZ - z : z > bMaxZ ? z - bMaxZ : 0;
          if (dx0 * dx0 + dz0 * dz0 >= best) continue;

          const ax = this.segs[s * 4] as number;
          const az = this.segs[s * 4 + 1] as number;
          const bx = this.segs[s * 4 + 2] as number;
          const bz = this.segs[s * 4 + 3] as number;
          const dx = bx - ax;
          const dz = bz - az;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + t * dx - x;
          const pz = az + t * dz - z;
          const d2 = px * px + pz * pz;
          if (d2 < best) best = d2;
        }
      }
    }
    return best;
  }

  influence(x: number, z: number): number {
    const d = Math.sqrt(this.distanceSq(x, z));
    return clamp01(1 - smoothstep(TRAIL_HALF_WIDTH_M, TRAIL_FEATHER_M, d));
  }
}
