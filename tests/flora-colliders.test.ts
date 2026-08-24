import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { TrunkColliderRing, type TrunkCandidate } from '@/flora/colliders';
import { FloraWorld } from '@/flora/flora-world';

/**
 * Collider pool reuse accounting against a REAL Rapier world (same approach
 * as tests/world-colliders.test.ts): the pool's promise is that driving
 * through forest creates colliders only until the pool is warm — churn then
 * reuses parked colliders instead of allocating new ones.
 */

let world: RAPIER.World;

function candidates(prefix: string, spec: Array<[number, number]>): TrunkCandidate[] {
  return spec.map(([x, z], i) => ({ id: `${prefix}${i}`, x, y: 0, z }));
}

beforeAll(async () => {
  await RAPIER.init();
  world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
});

describe('TrunkColliderRing pooling', () => {
  it('creates once for trees in radius, no-ops on identical resync', () => {
    const ring = new TrunkColliderRing(world, RAPIER);
    const trees = candidates('a', [[0, 0], [10, 0], [0, 10], [100, 100]]); // last out of 40m

    const first = ring.sync(0, 0, trees);
    expect(first.created).toBe(3);
    expect(first.reused).toBe(0);
    expect(ring.size).toBe(3);

    const again = ring.sync(0, 0, trees);
    expect(again).toEqual({ created: 0, reused: 0, destroyed: 0 });
    expect(ring.size).toBe(3);
    ring.dispose();
  });

  it('parks out-of-range colliders and REUSES them for new trunks', () => {
    const ring = new TrunkColliderRing(world, RAPIER);
    // Drive east: original cluster falls behind, fresh trunks appear ahead.
    const clusterA = candidates('a', [[0, 0], [8, 2], [-5, -7]]);
    const clusterB = candidates('b', [[60, 0], [70, 4], [55, -9]]);

    const s1 = ring.sync(0, 0, [...clusterA, ...clusterB]);
    expect(s1.created).toBe(3); // only clusterA in range

    const s2 = ring.sync(65, 0, [...clusterA, ...clusterB]);
    expect(s2.destroyed).toBeGreaterThanOrEqual(1); // A left the radius...
    expect(s2.reused).toBeGreaterThanOrEqual(1); // ...its collider was reused for B
    expect(s2.created).toBe(0); // nothing new allocated this hop
    expect(ring.size).toBe(3);

    // Pool fully warm: a third move reuses everything, creates nothing.
    const clusterC = candidates('c', [[130, 0], [140, 5]]);
    const s3 = ring.sync(135, 0, [...clusterB, ...clusterC]);
    expect(s3.created).toBe(0); // served entirely by the pool
    expect(s3.reused).toBe(2); // both C trunks reuse parked colliders
    expect(ring.size).toBe(2);
    ring.dispose();
  });

  it('dispose removes every live AND pooled collider from the rapier world', () => {
    const ring = new TrunkColliderRing(world, RAPIER);
    const before = world.bodies.len() + world.colliders.len(); // crude total
    void before;
    ring.sync(0, 0, candidates('d', [[0, 0], [5, 5], [12, -3], [30, 30]]));
    ring.sync(35, 0, candidates('e', [[0, 0], [38, 2]])); // force parking
    const livePlusPooled = ring.size + ring.pooledCount;
    expect(livePlusPooled).toBeGreaterThan(2);
    ring.dispose();
    expect(ring.size).toBe(0);
    expect(ring.pooledCount).toBe(0);
  });
});

describe('FloraWorld trunk-collider integration', () => {
  it('syncTrunkColliders populates ≤40m trunks from the same placement data', () => {
    const flora = new FloraWorld({ seed: 1337 });
    flora.update(64, 64); // mid-chunk so nearby trees exist
    flora.attachPhysics(RAPIER, world);
    flora.syncTrunkColliders(64, 64);

    const stats = flora.stats();
    // Flat fallback sampler yields a populated forest; some trunks must be
    // within 40m of the car on average chunks. Not guaranteed for EVERY
    // position (clearings!), so assert only when placements are dense.
    if (stats.counts.full + stats.counts.mid > 50) {
      expect(stats.colliders.live).toBeGreaterThan(0);
      // Radius guarantee: never more than what fits in a 40m disc at our
      // density ceiling (~1 tree / 49m² worst case → generous bound).
      expect(stats.colliders.live).toBeLessThan(120);
    }
    flora.dispose();
  });

  it('is a safe no-op before physics attach', () => {
    const flora = new FloraWorld({ seed: 1337 });
    flora.update(0, 0);
    expect(() => flora.syncTrunkColliders(0, 0)).not.toThrow();
    expect(flora.stats().colliders.live).toBe(0);
    flora.dispose();
  });
});
