import { CHUNK_GRID, CHUNK_SIZE_M, PHYSICS_RING_CHUNKS } from '@contracts/constants';
import type { ChunkKey } from '@contracts/world';
import type { Collider as RapierCollider, World as RapierWorld } from '@dimforge/rapier3d-compat';

/**
 * Rapier heightfield colliders for the 3x3 chunks around the car
 * (PHYSICS_RING_CHUNKS = 1). Created/destroyed as the car crosses chunk
 * borders; nothing else in the world gets a collider — everything farther out
 * is scenery.
 *
 * Height array orientation was verified empirically by raycasting a diagonal
 * pattern through a generated heightfield (tests/world-colliders.test.ts):
 * Rapier 0.20 indexes heights as heights[iz + ix*nrows] (first axis = local Z)
 * and treats `scale` as the field's full x/z size — details in toRapierHeights.
 */

export type GridLookup = (cx: number, cz: number) => Float32Array | null;

/** The rapier3d-compat module namespace (default export). */
export type RapierAPI = typeof import('@dimforge/rapier3d-compat');

interface RingEntry {
  collider: RapierCollider;
}

const N = CHUNK_GRID;

/**
 * Convert our row-major [iz*N+ix] grid into Rapier's height layout.
 * Verified empirically by raycasting an encoded grid (tests/world-colliders.test.ts):
 * Rapier 0.20 reads heights as heights[iz + ix * nrows] — the FIRST stored axis
 * maps to local +Z and the SECOND to local +X, opposite to what the docs imply.
 * We therefore transpose our row-major grid on copy.
 */
export function toRapierHeights(rowMajor: Float32Array, n: number = N): Float32Array {
  const out = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      out[ix * n + iz] = rowMajor[iz * n + ix] as number;
    }
  }
  return out;
}

export class ColliderRing {
  private readonly live = new Map<string, RingEntry>();

  constructor(
    private readonly rapierWorld: RapierWorld,
    private readonly RAPIER: RapierAPI,
  ) {}

  /**
   * Ensure colliders exist exactly for the Chebyshev ring around the car.
   * `gridFor` returns null for chunks whose data hasn't streamed yet; those are
   * retried on the next sync once available.
   */
  sync(carX: number, carZ: number, gridFor: GridLookup): { created: number; destroyed: number } {
    const ccx = Math.floor(carX / CHUNK_SIZE_M);
    const ccz = Math.floor(carZ / CHUNK_SIZE_M);

    const want = new Set<string>();
    let created = 0;

    for (let dx = -PHYSICS_RING_CHUNKS; dx <= PHYSICS_RING_CHUNKS; dx++) {
      for (let dz = -PHYSICS_RING_CHUNKS; dz <= PHYSICS_RING_CHUNKS; dz++) {
        const key: ChunkKey = { cx: ccx + dx, cz: ccz + dz };
        const k = `${key.cx},${key.cz}`;
        want.add(k);
        if (this.live.has(k)) continue;

        const grid = gridFor(key.cx, key.cz);
        if (!grid || grid.length !== N * N) continue;

        const heights = toRapierHeights(grid);
        // Verified empirically (tests/world-colliders.test.ts): in
        // rapier3d-compat 0.20, `scale` is the FULL x/z extent of the field,
        // not per-cell spacing — samples are spread evenly across it.
        const desc = this.RAPIER.ColliderDesc.heightfield(
          N - 1,
          N - 1,
          heights,
          { x: CHUNK_SIZE_M, y: 1, z: CHUNK_SIZE_M },
        );
        const cx = key.cx * CHUNK_SIZE_M + CHUNK_SIZE_M / 2;
        const cz = key.cz * CHUNK_SIZE_M + CHUNK_SIZE_M / 2;
        desc.setTranslation(cx, 0, cz);
        const collider = this.rapierWorld.createCollider(desc);
        this.live.set(k, { collider });
        created++;
      }
    }

    let destroyed = 0;
    for (const [k, entry] of this.live) {
      if (!want.has(k)) {
        this.rapierWorld.removeCollider(entry.collider, false);
        this.live.delete(k);
        destroyed++;
      }
    }

    return { created, destroyed };
  }

  get size(): number {
    return this.live.size;
  }

  has(cx: number, cz: number): boolean {
    return this.live.has(`${cx},${cz}`);
  }

  dispose(): void {
    for (const [, entry] of this.live) {
      this.rapierWorld.removeCollider(entry.collider, false);
    }
    this.live.clear();
  }
}
