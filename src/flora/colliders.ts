import { TRUNK_COLLIDER_RADIUS_M } from '@contracts/constants';
import type { Collider as RapierCollider, World as RapierWorld } from '@dimforge/rapier3d-compat';

/**
 * Pooled cylinder trunk colliders — same lifecycle pattern as world/colliders'
 * ColliderRing, but pooled: a collider that leaves the 40m radius is NOT
 * removed from the Rapier world; it is parked in a free list and REUSED
 * (setTranslation) for the next tree that needs one. Driving through forest
 * churns dozens of trunks per second; pooling keeps allocations flat.
 *
 * Collider shape is fixed (species-median cylinder) so any pooled collider
 * fits any trunk — that's what makes reuse O(1). Visual scale variation
 * (±25%) is not mirrored into the collider; honest gap, documented in
 * docs/notes/flora.md.
 */

/** Species-median collider dims at scale 1... sized for the median tree. */
export const TRUNK_COLLIDER_HALF_HEIGHT_M = 6.5;
export const TRUNK_COLLIDER_RADIUS_M_COLLIDER = 0.32;

export interface TrunkCandidate {
  /** Stable id, e.g. "3,-7#42" (chunk + placement index). */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ColliderSyncCounts {
  created: number;
  reused: number;
  destroyed: number;
}

/**
 * Structural slice of the rapier3d-compat namespace the ring needs. Declared
 * locally (not imported from world/colliders) to avoid a cross-module
 * dependency; the default-export namespace satisfies it at runtime.
 */
export type RapierAPI = Pick<
  typeof import('@dimforge/rapier3d-compat'),
  'ColliderDesc'
>;

interface LiveEntry {
  collider: RapierCollider;
}

export class TrunkColliderRing {
  private readonly live = new Map<string, LiveEntry>();
  private readonly free: RapierCollider[] = [];

  constructor(
    private readonly rapierWorld: RapierWorld,
    private readonly RAPIER: RapierAPI,
  ) {}

  /**
   * Ensure exactly the trees within TRUNK_COLLIDER_RADIUS_M of (carX, carZ)
   * have live colliders. `treesForRadius` must return the candidates near the
   * car (the caller filters); entries already live and still wanted are left
   * untouched. Returns pool accounting for stats/tests.
   */
  sync(carX: number, carZ: number, candidates: readonly TrunkCandidate[]): ColliderSyncCounts {
    const r2 = TRUNK_COLLIDER_RADIUS_M * TRUNK_COLLIDER_RADIUS_M;
    const want = new Set<string>();
    for (const t of candidates) {
      const dx = t.x - carX;
      const dz = t.z - carZ;
      if (dx * dx + dz * dz > r2) continue;
      want.add(t.id);
    }

    // Park first, create second — colliders freed by this very sync are
    // immediately available for reuse within it.
    let destroyed = 0;
    for (const [id, entry] of this.live) {
      if (!want.has(id)) {
        // Park, don't remove — the whole point of the pool.
        this.free.push(entry.collider);
        this.live.delete(id);
        destroyed++;
      }
    }

    let created = 0;
    let reused = 0;
    for (const t of candidates) {
      if (!want.has(t.id)) continue;
      const existing = this.live.get(t.id);
      if (existing) continue;

      const pooled = this.free.pop();
      if (pooled) {
        pooled.setTranslation({ x: t.x, y: t.y + TRUNK_COLLIDER_HALF_HEIGHT_M, z: t.z });
        this.live.set(t.id, { collider: pooled });
        reused++;
      } else {
        const desc = this.RAPIER.ColliderDesc.cylinder(
          TRUNK_COLLIDER_HALF_HEIGHT_M,
          TRUNK_COLLIDER_RADIUS_M_COLLIDER,
        );
        desc.setTranslation(t.x, t.y + TRUNK_COLLIDER_HALF_HEIGHT_M, t.z);
        const collider = this.rapierWorld.createCollider(desc);
        this.live.set(t.id, { collider });
        created++;
      }
    }

    return { created, reused, destroyed };
  }

  get size(): number {
    return this.live.size;
  }

  get pooledCount(): number {
    return this.free.length;
  }

  has(id: string): boolean {
    return this.live.has(id);
  }

  dispose(): void {
    for (const [, entry] of this.live) {
      this.rapierWorld.removeCollider(entry.collider, false);
    }
    this.live.clear();
    for (const collider of this.free) {
      this.rapierWorld.removeCollider(collider, false);
    }
    this.free.length = 0;
  }
}
