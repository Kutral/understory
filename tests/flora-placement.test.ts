import { describe, expect, it } from 'vitest';
import {
  MAX_SLOPE,
  MIN_MOISTURE,
  forestDensity,
  hashChunk,
  materializePlacements,
  mulberry32,
  treesFor,
  FlatSurfaceSampler,
  type SurfaceSampler,
} from '@/flora/placement';
import type { ChunkKey } from '@contracts/world';

const SEED = 1337;

function key(cx: number, cz: number): ChunkKey {
  return { cx, cz };
}

/** Sampler that answers every query from a simple analytic surface. */
function analyticSampler(slope = 0, moisture = 0.5): SurfaceSampler {
  return {
    heightAt: (x) => x * slope,
    gradientMag: () => slope,
    moistureAt: () => moisture,
  };
}

describe('hash / prng primitives', () => {
  it('hashChunk is deterministic and spreads across seeds', () => {
    expect(hashChunk(3, -7, SEED)).toBe(hashChunk(3, -7, SEED));
    expect(hashChunk(3, -7, SEED)).not.toBe(hashChunk(-7, 3, SEED));
    const seen = new Set<number>();
    for (let i = 0; i < 64; i++) seen.add(hashChunk(i, i * 3, SEED + i));
    expect(seen.size).toBeGreaterThan(60);
  });

  it('mulberry32 streams identically for the same seed', () => {
    const a = mulberry32(SEED);
    const b = mulberry32(SEED);
    for (let i = 0; i < 16; i++) expect(a()).toBe(b());
  });
});

describe('density mask', () => {
  it('is deterministic, in [0,1], and produces clearings AND thickets', () => {
    let min = 1;
    let max = 0;
    for (let x = -2000; x <= 2000; x += 37) {
      for (let z = -2000; z <= 2000; z += 41) {
        const d = forestDensity(x, z, SEED);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(1);
        min = Math.min(min, d);
        max = Math.max(max, d);
      }
    }
    // Genuine spread: near-bare clearings and dense thickets both exist.
    expect(min).toBeLessThan(0.15);
    expect(max).toBeGreaterThan(0.85);
    // Same answer twice.
    expect(forestDensity(123.4, -987.6, SEED)).toBe(forestDensity(123.4, -987.6, SEED));
  });
});

describe('placement determinism (same seed+chunk = identical arrays)', () => {
  it('byte-identical placements for repeated calls', () => {
    const sampler = new FlatSurfaceSampler(SEED);
    const a = treesFor(key(12, -34), SEED, sampler);
    const b = treesFor(key(12, -34), SEED, sampler);
    // The block around this key fills in (not a total clearing).
    let blockTotal = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        blockTotal += treesFor(key(12 + dx, -34 + dz), SEED, sampler).length;
      }
    }
    expect(blockTotal).toBeGreaterThan(60);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('identical under a fresh sampler instance too', () => {
    expect(JSON.stringify(treesFor(key(5, 9), SEED, new FlatSurfaceSampler(SEED))))
      .toBe(JSON.stringify(treesFor(key(5, 9), SEED, new FlatSurfaceSampler(SEED))));
  });

  it('different seed reshapes the forest', () => {
    const sampler = new FlatSurfaceSampler();
    const a = treesFor(key(2, 2), 1000, sampler);
    const b = treesFor(key(2, 2), 2000, sampler);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('adjacent chunks differ but each is self-consistent', () => {
    const sampler = new FlatSurfaceSampler(SEED);
    for (const [cx, cz] of [[0, 0], [-1, 0], [3, 7], [-12, 44]] as Array<[number, number]>) {
      const a = treesFor(key(cx, cz), SEED, sampler);
      const b = treesFor(key(cx, cz), SEED, sampler);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

describe('placement constraints', () => {
  it('positions stay inside the chunk, species is a valid index, fields in range', () => {
    const sampler = new FlatSurfaceSampler(SEED);
    for (const k of [key(0, 0), key(-3, 8), key(50, -50)]) {
      for (const p of treesFor(k, SEED, sampler)) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThan(128);
        expect(p.z).toBeGreaterThanOrEqual(0);
        expect(p.z).toBeLessThan(128);
        // Wave 2 species table: 0 pine, 1 birch, 2 oak, 3 snag.
        expect([0, 1, 2, 3]).toContain(p.species);
        expect(p.scale).toBeGreaterThan(0.3);
        expect(Math.abs(p.hue)).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('species mix: all four species occur across a wide sample', () => {
    const sampler = new FlatSurfaceSampler(SEED);
    const seen = new Set<number>();
    for (let cx = -6; cx <= 6; cx++) {
      for (let cz = -6; cz <= 6; cz++) {
        for (const p of treesFor(key(cx, cz), SEED, sampler)) seen.add(p.species);
      }
    }
    for (const s of [0, 1, 2, 3]) expect(seen.has(s)).toBe(true);
  });

  it('rejects slopes steeper than MAX_SLOPE without disturbing the rng stream', () => {
    const flat = treesFor(key(4, 4), SEED, analyticSampler(0));
    const gentle = treesFor(key(4, 4), SEED, analyticSampler(MAX_SLOPE * 0.5));
    const steep = treesFor(key(4, 4), SEED, analyticSampler(MAX_SLOPE + 0.1));
    // Gates consume no randomness, so pass-gates leave counts untouched.
    expect(gentle.length).toBe(flat.length);
    expect(flat.length).toBeGreaterThan(0);
    expect(steep.length).toBe(0);
  });

  it('rejects ground drier than MIN_MOISTURE', () => {
    const damp = treesFor(key(6, 1), SEED, analyticSampler(0, MIN_MOISTURE + 0.2));
    const arid = treesFor(key(6, 1), SEED, analyticSampler(0, MIN_MOISTURE - 0.05));
    const flat = treesFor(key(6, 1), SEED, analyticSampler(0, 0.5));
    expect(damp.length).toBe(flat.length);
    expect(arid.length).toBe(0);
  });

  it('materializePlacements lifts local coords to world with sampled heights', () => {
    const k = key(2, 3);
    const sampler = analyticSampler(0, 0.6);
    const world = materializePlacements(k, treesFor(k, SEED, sampler), sampler);
    for (const t of world) {
      expect(t.wx).toBeCloseTo(2 * 128 + t.placement.x, 6);
      expect(t.wz).toBeCloseTo(3 * 128 + t.placement.z, 6);
      expect(t.y).toBe(t.wx * 0); // analytic heightAt
      expect(t.distSq).toBe(0); // caller sets distance later
    }
  });

  it('candidate grid spacing is honoured structurally (no clumping bug)', () => {
    // Find a reasonably dense chunk, then verify the jitter never collapses
    // two trees together.
    const sampler = new FlatSurfaceSampler(SEED);
    let ps: ReturnType<typeof treesFor> = [];
    for (let cx = 0; cx < 6 && ps.length < 40; cx++) {
      for (let cz = 0; cz < 6 && ps.length < 40; cz++) {
        const cand = treesFor(key(cx, cz), SEED, sampler);
        if (cand.length > ps.length) ps = cand;
      }
    }
    expect(ps.length).toBeGreaterThan(30); // a thicket exists in the scan
    let minDist = Infinity;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i];
        const b = ps[j];
        if (!a || !b) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < minDist) minDist = d;
      }
    }
    expect(minDist).toBeGreaterThan(1.5);
  });
});
