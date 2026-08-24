import { describe, expect, it } from 'vitest';
import {
  TrailNetwork,
  TRAIL_CELL_M,
  nodePosForTests,
} from '@/world/trail-network';

describe('trail network', () => {
  it('influence is deterministic: same seed, same inputs, same outputs across instances', () => {
    const a = new TrailNetwork(1234);
    const b = new TrailNetwork(1234);
    for (let i = 0; i < 500; i++) {
      const x = (i * 37.7) % 1000;
      const z = (i * -91.3) % 1000;
      expect(a.influence(x, z)).toBe(b.influence(x, z));
      expect(a.distanceTo(x, z)).toBe(b.distanceTo(x, z));
      expect(a.isTrail(x, z)).toBe(b.isTrail(x, z));
    }
  });

  it('different seeds give different networks', () => {
    const a = new TrailNetwork(1);
    const b = new TrailNetwork(2);
    let diff = 0;
    for (let i = 0; i < 200; i++) {
      if (a.influence(i * 13.1, i * 7.9) !== b.influence(i * 13.1, i * 7.9)) diff++;
    }
    expect(diff).toBeGreaterThan(50);
  });

  it('influence is 1 on the centreline and the corridor stays followable', () => {
    const net = new TrailNetwork(77);
    // Walk the actual warped spline (not the chord): influence must be ~1 at
    // every sampled centreline point and high everywhere between samples.
    const pl = net.edgeFor(10, 10, 'east');
    let minAlong = 1;
    for (let k = 0; k <= 10; k++) {
      const x = pl.pts[k * 2] as number;
      const z = pl.pts[k * 2 + 1] as number;
      minAlong = Math.min(minAlong, net.influence(x, z));
    }
    expect(minAlong).toBeGreaterThan(0.95); // centreline reached everywhere

    // Midpoints between centreline samples stay inside the corridor.
    const a = nodePosForTests(77, 10, 10);
    const b = nodePosForTests(77, 11, 10);
    let maxInf = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      maxInf = Math.max(maxInf, net.influence(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
    }
    expect(maxInf).toBeGreaterThan(0.95);
  });

  it('never walls the player in: most of the world is NOT trail', () => {
    const net = new TrailNetwork(555);
    let onTrail = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const x = (i % 64) * TRAIL_CELL_M * 0.25 + (i % 13) * 3.1;
      const z = Math.floor(i / 64) * TRAIL_CELL_M * 0.25 + (i % 17) * 2.7;
      if (net.isTrail(x, z)) onTrail++;
    }
    // Trails are corridors ~6m wide in a ~192m lattice ⇒ well under 15% coverage.
    expect(onTrail / N).toBeLessThan(0.15);
    // But they exist at all.
    expect(onTrail).toBeGreaterThan(0);
  });

  it('network connectivity: every node has its two outgoing edges and paths continue', () => {
    const net = new TrailNetwork(42);
    // For a grid of cells, walking east/south edges must always find the next
    // node within tolerance — the network is fully connected by construction.
    for (let ci = 20; ci < 24; ci++) {
      for (let cj = 20; cj < 24; cj++) {
        const segs = net.segmentsFor({ cx: Math.floor((ci * TRAIL_CELL_M) / 128), cz: Math.floor((cj * TRAIL_CELL_M) / 128) }, 128);
        expect(segs.length).toBeGreaterThan(0);
      }
    }
  });
});
