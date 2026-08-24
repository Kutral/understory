import { describe, expect, it } from 'vitest';
import {
  FAR_CAP,
  FULL_CAP,
  MID_CAP,
  assignBands,
  bandForDistance,
  type PlacedTree,
} from '@/flora/placement';
import {
  PINE_SPECS,
  pineTriangleCount,
  buildImpostorFrame,
  buildPine,
} from '@/flora/geometry';

function tree(distM: number): PlacedTree {
  return {
    placement: { x: distM, z: 0, species: 0, scale: 1, rotY: 0, hue: 0 },
    wx: distM,
    wz: 0,
    y: 0,
    distSq: distM * distM,
  };
}

describe('pine LOD triangle budgets', () => {
  it('full ≥800 tris (budget: hero trees)', () => {
    expect(pineTriangleCount(PINE_SPECS.full)).toBeGreaterThanOrEqual(800);
  });

  it('mid ≈150 tris and far ≈40 tris', () => {
    const mid = pineTriangleCount(PINE_SPECS.mid);
    const far = pineTriangleCount(PINE_SPECS.far);
    expect(mid).toBeGreaterThanOrEqual(110);
    expect(mid).toBeLessThanOrEqual(200);
    expect(far).toBeGreaterThanOrEqual(30);
    expect(far).toBeLessThanOrEqual(70);
    // Strictly decreasing detail.
    expect(
      pineTriangleCount(PINE_SPECS.full),
    ).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });

  it('built geometries match the declared counts and carry wind attributes', () => {
    for (const lod of ['full', 'mid', 'far'] as const) {
      const { geometry, triangles } = buildPine(lod);
      expect(geometry.index).not.toBeNull();
      expect((geometry.index?.count ?? 0) / 3).toBe(triangles);
      const flex = geometry.getAttribute('aFlex');
      expect(flex.count).toBe(geometry.getAttribute('position').count);
      // Hierarchy: base vertices barely couple to wind; crown tips fully.
      let minFlex = Infinity;
      let maxFlex = -Infinity;
      for (let i = 0; i < flex.count; i++) {
        const f = flex.getX(i);
        minFlex = Math.min(minFlex, f);
        maxFlex = Math.max(maxFlex, f);
      }
      expect(minFlex).toBeLessThan(0.12); // trunk tier ≤ ~10%
      expect(maxFlex).toBeGreaterThan(0.95); // tips at 100%
      geometry.dispose();
    }
  });

  it('impostor frame is exactly two crossed quads (4 tris) with UVs', () => {
    const frame = buildImpostorFrame();
    expect(frame.quads).toBe(2);
    expect(frame.triangles).toBe(4);
    const uv = frame.geometry.getAttribute('uv');
    expect(uv.count).toBe(8);
    frame.geometry.dispose();
  });
});

describe('LOD band assignment math', () => {
  it('band boundaries land exactly on the budget constants', () => {
    expect(bandForDistance(60)).toBe('full');
    expect(bandForDistance(60.01)).toBe('mid');
    expect(bandForDistance(140)).toBe('mid');
    expect(bandForDistance(140.01)).toBe('far');
    expect(bandForDistance(260)).toBe('far');
    expect(bandForDistance(260.01)).toBe('impostor');
  });

  it('caps are respected exactly when supply exceeds demand', () => {
    const trees: PlacedTree[] = [];
    for (let i = 0; i < 2000; i++) trees.push(tree((i % 500) + i * 0.001));
    const bands = assignBands(trees);
    expect(bands.full.length).toBeLessThanOrEqual(FULL_CAP);
    expect(bands.mid.length).toBeLessThanOrEqual(MID_CAP);
    expect(bands.far.length).toBeLessThanOrEqual(FAR_CAP);
    expect(bands.full.length + bands.mid.length + bands.far.length + bands.impostor.length)
      .toBe(trees.length); // nothing dropped
  });

  it('nearest trees claim detailed bands; overflow spills OUTWARD not inward', () => {
    // 100 trees all within the full band: only 80 may render full.
    const near = Array.from({ length: 100 }, (_, i) => tree(1 + i * 0.1));
    const bands = assignBands(near);
    expect(bands.full.length).toBe(FULL_CAP);
    expect(bands.mid.length).toBe(20);
    // The spilled 20 are the FARTHEST of the near set.
    const spillMax = Math.max(...bands.mid.map((t) => t.distSq));
    const fullMax = Math.max(...bands.full.map((t) => t.distSq));
    expect(spillMax).toBeGreaterThan(fullMax);

    // And a mid-band cap overflow cascades into far, then impostor.
    const midOnly = Array.from({ length: MID_CAP + 50 }, (_, i) =>
      tree(61 + (i % 40) + i * 0.0001),
    );
    const b2 = assignBands(midOnly);
    expect(b2.full.length).toBe(0);
    expect(b2.mid.length).toBeLessThanOrEqual(MID_CAP);
    expect(b2.far.length + b2.impostor.length).toBe(50);
  });

  it('distance ordering is deterministic regardless of input order', () => {
    const a = assignBands([tree(30), tree(5), tree(300), tree(120)]);
    const b = assignBands([tree(300), tree(5), tree(30), tree(120)]);
    const sig = (x: typeof a): string =>
      [...x.full, ...x.mid, ...x.far, ...x.impostor].map((t) => t.wx).join(',');
    expect(sig(a)).toBe(sig(b));
    expect(a.impostor.length).toBe(1);
    expect(a.impostor[0]?.wx).toBe(300);
  });
});
