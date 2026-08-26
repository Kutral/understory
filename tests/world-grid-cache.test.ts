import { describe, expect, it } from 'vitest';
import { GridCache } from '../src/world/terrain-world';
import { CHUNK_RINGS, PHYSICS_RING_CHUNKS } from '../src/contracts/constants';

/**
 * Regression: the collider height-grid LRU once had cap=64 while the pre-boot
 * warmup streams (2·CHUNK_RINGS+1)² = 121 chunks. The spawn-centre grids were
 * evicted before the physics ring claimed them and — those chunks already
 * being `live` — never regenerated, so the car fell through the world at
 * spawn. The cache must hold the entire streamed set with room to spare.
 */
describe('GridCache capacity vs streamed set (spawn fall-through regression)', () => {
  it('default cap exceeds the full warm-up stream', () => {
    const cache = new GridCache();
    const streamed = (2 * CHUNK_RINGS + 1) ** 2;
    expect(cache.cap).toBeGreaterThanOrEqual(streamed);
  });

  it('pins the mechanism: the old cap=64 evicts the spawn grid under warm-up load', () => {
    const cache = new GridCache(64); // the old broken cap
    const mk = (n: number) => new Float32Array(n);
    // Simulate: spawn-area grids arrive first...
    cache.put({ cx: 0, cz: 0 }, mk(4));
    // ...then a big warm-up pump flushes everything older out.
    let n = 0;
    for (let cx = -6; cx <= 6; cx++) {
      for (let cz = -6; cz <= 6; cz++) {
        if (cx === 0 && cz === 0) continue;
        cache.put({ cx, cz }, mk(4));
        n++;
        if (n >= 64) break;
      }
      if (n >= 64) break;
    }
    // This is exactly how the bug happened: colliders could never build.
    expect(cache.get(0, 0)).toBeNull();
  });

  it('the fixed default cap survives the same eviction storm', () => {
    const cache = new GridCache(); // fixed cap
    const mk = (n: number) => new Float32Array(n);
    cache.put({ cx: 0, cz: 0 }, mk(4));
    const streamed = (2 * CHUNK_RINGS + 1) ** 2;
    let n = 0;
    outer: for (let cx = -6; cx <= 6; cx++) {
      for (let cz = -6; cz <= 6; cz++) {
        if (cx === 0 && cz === 0) continue;
        cache.put({ cx, cz }, mk(4));
        if (++n >= streamed) break outer;
      }
    }
    expect(cache.get(0, 0)).not.toBeNull();
  });

  it('physics ring lookups all hit after streaming exactly the view set', () => {
    const cache = new GridCache();
    for (let cx = -CHUNK_RINGS; cx <= CHUNK_RINGS; cx++) {
      for (let cz = -CHUNK_RINGS; cz <= CHUNK_RINGS; cz++) {
        cache.put({ cx, cz }, new Float32Array(4));
      }
    }
    // The car sits at origin; syncColliders needs every cell of its 3x3 ring.
    for (let dx = -PHYSICS_RING_CHUNKS; dx <= PHYSICS_RING_CHUNKS; dx++) {
      for (let dz = -PHYSICS_RING_CHUNKS; dz <= PHYSICS_RING_CHUNKS; dz++) {
        expect(cache.get(dx, dz)).not.toBeNull();
      }
    }
  });
});
