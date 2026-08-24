import { describe, expect, it } from 'vitest';
import { CHUNK_GRID, CHUNK_SIZE_M } from '@contracts/constants';
import { makeNoiseField, simplex2 } from '@/world/noise';
import { TerrainSource } from '@/world/terrain-source';
import { bytesIdentical } from './world-test-utils';

describe('noise stack', () => {
  it('simplex2 is deterministic across instances for the same seed', () => {
    const a = makeNoiseField(42).perm;
    const b = makeNoiseField(42).perm;
    expect(bytesIdentical(a, b)).toBe(true);
    let acc = 0;
    for (let i = 0; i < 1000; i++) {
      const x = i * 0.731;
      acc += simplex2(a, x, x * 1.37) - simplex2(b, x, x * 1.37);
    }
    expect(acc).toBe(0);
  });

  it('simplex2 stays in [-1, 1] and repeats identically at identical inputs', () => {
    const perm = makeNoiseField(7).perm;
    for (let i = 0; i < 5000; i++) {
      const v = simplex2(perm, i * 0.113, -i * 0.097);
      expect(v).toBeGreaterThanOrEqual(-1.001);
      expect(v).toBeLessThanOrEqual(1.001);
      expect(v).toBe(simplex2(perm, i * 0.113, -i * 0.097));
    }
  });
});

describe('heightfield determinism (byte-identical)', () => {
  it('same seed → byte-identical height/surface/moisture arrays across runs', () => {
    const key = { cx: 3, cz: -5 };

    // Two independent source instances, same seed, "separate runs".
    const runA = new TerrainSource(20260824).generate(key);
    const runB = new TerrainSource(20260824).generate(key);

    expect(bytesIdentical(runA.heights, runB.heights)).toBe(true);
    expect(bytesIdentical(runA.surface, runB.surface)).toBe(true);
    expect(bytesIdentical(runA.moisture, runB.moisture)).toBe(true);

    // And a re-seeded instance matches too.
    const src = new TerrainSource(1);
    src.setSeed(20260824);
    const runC = src.generate(key);
    expect(bytesIdentical(runA.heights, runC.heights)).toBe(true);
  });

  it('different seeds produce different terrain', () => {
    const a = new TerrainSource(1).generate({ cx: 0, cz: 0 });
    const b = new TerrainSource(2).generate({ cx: 0, cz: 0 });
    let diff = 0;
    for (let i = 0; i < a.heights.length; i++) {
      if (a.heights[i] !== b.heights[i]) diff++;
    }
    expect(diff).toBeGreaterThan(a.heights.length / 2);
  });

  it('heightAt matches generated grid vertices (within float32 grid precision)', () => {
    const src = new TerrainSource(99);
    const data = src.generate({ cx: 2, cz: 1 });
    const n = CHUNK_GRID;
    const step = CHUNK_SIZE_M / (n - 1);
    // The grid stores float32; heightAt returns the float64 function value, so
    // agreement is checked at float32 rounding precision (~1e-6 relative).
    for (const [ix, iz] of [[0, 0], [n - 1, 0], [0, n - 1], [64, 64], [17, 90]] as Array<[number, number]>) {
      const wx = 2 * CHUNK_SIZE_M + ix * step;
      const wz = 1 * CHUNK_SIZE_M + iz * step;
      const a = src.heightAt(wx, wz);
      const b = data.heights[iz * n + ix] as number;
      expect(Math.abs(a - b)).toBeLessThan(2e-6 + Math.abs(a) * 1e-6);
    }
    // Full-grid sweep stays within the same bound.
    let worst = 0;
    for (let i = 0; i < n * n; i += 97) {
      const ix = i % n;
      const iz = Math.floor(i / n);
      const wx = 2 * CHUNK_SIZE_M + ix * step;
      const wz = 1 * CHUNK_SIZE_M + iz * step;
      worst = Math.max(worst, Math.abs(src.heightAt(wx, wz) - (data.heights[i] as number)));
    }
    expect(worst).toBeLessThan(1e-5);
  });
});
