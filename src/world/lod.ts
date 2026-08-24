import { CHUNK_GRID, CHUNK_RINGS, CHUNK_SIZE_M } from '@contracts/constants';
import { chunkKey, type ChunkKey } from '@contracts/world';

/**
 * Ring/LOD layout — pure math so it is unit-testable without DOM or WebGL.
 *
 * 5 Chebyshev rings around the car chunk (~640m guarantee, ~1.2km diagonal
 * reach). Rings 0-1 render at the full 1m vertex grid; outer rings decimate.
 * Every mesh carries a downward skirt (border vertices duplicated) so T-junction
 * cracks between LOD levels never show sky through the terrain.
 */

/** Decimation step per ring index (ring 0..CHUNK_RINGS-1). Ring<2 keeps 1m grid. */
export const STEP_BY_RING: readonly number[] = [1, 1, 2, 4, 8] as const;

export const MAX_RING = CHUNK_RINGS - 1;

/** Vertices per side for an interior grid at this step (skirt adds more). */
export function gridN(step: number): number {
  return Math.floor((CHUNK_GRID - 1) / step) + 1;
}

/** Interior + skirt vertex count for one level (four skirt strips of n verts). */
export function totalVerts(step: number): number {
  const n = gridN(step);
  return n * n + 4 * n;
}

/** Skirt drop in metres — scales with step so coarse rings hide deeper cracks. */
export function skirtDepth(step: number): number {
  return 4 * step;
}

/** Chebyshev ring distance of a chunk from the car's chunk. */
export function ringOf(dcx: number, dcz: number): number {
  return Math.max(Math.abs(dcx), Math.abs(dcz));
}

export function levelForRing(ring: number): number {
  return STEP_BY_RING[Math.min(ring, MAX_RING)] ?? 8;
}

/**
 * Desired chunk set around a car position: Map<key, step>.
 * Deterministic iteration order (sorted near→far) so streaming requests
 * prioritize what the camera will see first.
 */
export function desiredChunks(
  carX: number,
  carZ: number,
): Array<{ key: ChunkKey; step: number; ring: number }> {
  const ccx = Math.floor(carX / CHUNK_SIZE_M);
  const ccz = Math.floor(carZ / CHUNK_SIZE_M);
  const out: Array<{ key: ChunkKey; step: number; ring: number }> = [];
  for (let dcx = -MAX_RING; dcx <= MAX_RING; dcx++) {
    for (let dcz = -MAX_RING; dcz <= MAX_RING; dcz++) {
      const ring = ringOf(dcx, dcz);
      out.push({
        key: { cx: ccx + dcx, cz: ccz + dcz },
        step: levelForRing(ring),
        ring,
      });
    }
  }
  out.sort((a, b) => a.ring - b.ring);
  return out;
}


/**
 * Indices for one LOD level including skirts. Inner grid first, then four skirt
 * strips stitching each border edge down to its duplicate.
 */
export function buildIndices(step: number): Uint32Array {
  const n = gridN(step);
  const innerQuads = (n - 1) * (n - 1);
  const skirtQuads = 4 * (n - 1);
  const idx = new Uint32Array((innerQuads + skirtQuads) * 6);

  let o = 0;
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[o++] = a;
      idx[o++] = c;
      idx[o++] = b;
      idx[o++] = b;
      idx[o++] = c;
      idx[o++] = d;
    }
  }

  // Skirt duplicates start right after the interior grid.
  const base = n * n;
  // Perimeter walk order matches how geometry-pool emits skirt verts:
  // top edge (z=0, ix=0..n-2), bottom (z=n-1), left (x=0), right (x=n-1).
  // Each strip owns a contiguous run of n skirt vertices (one per border
  // vertex, corners duplicated across strips) shared by its n-1 quads.
  let skirtBase = base;
  const emitStrip = (
    getA: (k: number) => number,
    flip: boolean,
  ): void => {
    const sb = skirtBase;
    for (let k = 0; k < n - 1; k++) {
      const a0 = getA(k);
      const a1 = getA(k + 1);
      const s0 = sb + k;
      const s1 = sb + k + 1;
      if (!flip) {
        idx[o++] = a0;
        idx[o++] = s0;
        idx[o++] = a1;
        idx[o++] = a1;
        idx[o++] = s0;
        idx[o++] = s1;
      } else {
        idx[o++] = a0;
        idx[o++] = a1;
        idx[o++] = s0;
        idx[o++] = a1;
        idx[o++] = s1;
        idx[o++] = s0;
      }
    }
    skirtBase += n;
  };

  emitStrip((k) => k, false); // top edge (iz=0)
  emitStrip((k) => (n - 1) * n + k, true); // bottom edge
  emitStrip((k) => k * n, true); // left edge
  emitStrip((k) => k * n + (n - 1), false); // right edge

  return idx;
}

export function chunkOrigin(key: ChunkKey): { x: number; z: number } {
  return { x: key.cx * CHUNK_SIZE_M, z: key.cz * CHUNK_SIZE_M };
}

export function keyOf(cx: number, cz: number): string {
  return chunkKey(cx, cz);
}
