import { describe, expect, it } from 'vitest';
import { CHUNK_GRID, CHUNK_RINGS, CHUNK_SIZE_M } from '@contracts/constants';
import { chunkKey } from '@contracts/world';
import {
  MAX_RING,
  buildIndices,
  desiredChunks,
  gridN,
  levelForRing,
  ringOf,
  skirtDepth,
  totalVerts,
} from '@/world/lod';

describe('chunk keying', () => {
  it('chunkKey formats deterministically and parses back', () => {
    expect(chunkKey(0, 0)).toBe('0,0');
    expect(chunkKey(-3, 12)).toBe('-3,12');
    const [a, b] = chunkKey(-3, 12).split(',').map(Number);
    expect(a).toBe(-3);
    expect(b).toBe(12);
  });

  it('desired set is keyed uniquely per chunk around the car', () => {
    const want = desiredChunks(500, -900);
    const keys = want.map((w) => chunkKey(w.key.cx, w.key.cz));
    expect(new Set(keys).size).toBe(keys.length);
    // Car chunk is present and first (nearest-first ordering).
    expect(want[0]?.key).toEqual({ cx: Math.floor(500 / CHUNK_SIZE_M), cz: Math.floor(-900 / CHUNK_SIZE_M) });
    expect(want[0]?.ring).toBe(0);
  });
});

describe('ring / LOD layout', () => {
  it('ring counts match the contract constants', () => {
    expect(MAX_RING).toBe(CHUNK_RINGS - 1);
    expect(ringOf(0, 0)).toBe(0);
    expect(ringOf(4, -2)).toBe(4);
    expect(desiredChunks(0, 0).length).toBe((2 * MAX_RING + 1) ** 2);
  });

  it('LOD steps decimate outward: rings 0-1 full res, then 2/4/8', () => {
    expect(levelForRing(0)).toBe(1);
    expect(levelForRing(1)).toBe(1);
    expect(levelForRing(2)).toBe(2);
    expect(levelForRing(3)).toBe(4);
    expect(levelForRing(4)).toBe(8);
    expect(gridN(1)).toBe(CHUNK_GRID); // 129
    expect(gridN(2)).toBe(65);
    expect(gridN(4)).toBe(33);
    expect(gridN(8)).toBe(17);
  });

  it('vertex budget includes skirts and index buffer is well-formed', () => {
    for (const step of [1, 2, 4, 8]) {
      const n = gridN(step);
      expect(totalVerts(step)).toBe(n * n + 4 * n);

      const idx = buildIndices(step);
      const innerQuads = (n - 1) * (n - 1);
      expect(idx.length).toBe((innerQuads + 4 * (n - 1)) * 6);

      let maxRef = 0;
      for (let i = 0; i < idx.length; i++) maxRef = Math.max(maxRef, idx[i] as number);
      expect(maxRef).toBe(totalVerts(step) - 1); // no out-of-range references

      // Every interior vertex is referenced at least once (watertight grid).
      const seen = new Set<number>();
      for (let i = 0; i < idx.length; i++) seen.add(idx[i] as number);
      expect(seen.size).toBe(totalVerts(step));
    }
    expect(skirtDepth(8)).toBeGreaterThan(skirtDepth(1)); // deeper skirts hide bigger cracks
  });
});
