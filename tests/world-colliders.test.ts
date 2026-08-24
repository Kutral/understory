import { beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_GRID, CHUNK_SIZE_M } from '@contracts/constants';
import RAPIER from '@dimforge/rapier3d-compat';
import { toRapierHeights } from '@/world/colliders';
import { fillGeometryBuffers } from '@/world/geometry-pool';

/**
 * Empirical proof of the Rapier heightfield orientation: build a synthetic
 * grid whose heights encode (x,z) position, raycast straight down at known
 * offsets, and assert the hit Y equals the encoded value. This pins the
 * column-major transpose used by ColliderRing — if Rapier changes layout,
 * this test fails loudly instead of the car falling through tilted terrain.
 */

const N = 9; // small grid is enough to prove orientation

function makeEncodedGrid(): Float32Array {
  const g = new Float32Array(N * N);
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      g[iz * N + ix] = ix * 10 + iz * 0.1; // strongly x-dominant encoding
    }
  }
  return g;
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('rapier heightfield collider orientation', () => {
  it('raycast hit heights match our row-major grid after transposition', () => {
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const grid = makeEncodedGrid();

    // Rapier 0.20 `scale` = FULL x/z plane size; N samples spread across it,
    // so per-sample spacing is cell = fullSize/(N-1). Field spans ±8m.
    const full = (N - 1) * 2; // 16m, spacing 2
    const desc = RAPIER.ColliderDesc.heightfield(N - 1, N - 1, toRapierHeights(grid, N), {
      x: full,
      y: 1,
      z: full,
    });
    desc.setTranslation(0, 0, 0);
    world.createCollider(desc);
    // Rapier's World-level queries go through the broad-phase, which only
    // registers colliders on step(). (In-game this is a non-issue: the fixed
    // 60Hz physics loop steps continuously.)
    world.step();

    const probes = [
      { ix: 2, iz: 3 },
      { ix: 6, iz: 1 },
      { ix: 4, iz: 7 },
    ];
    for (const { ix, iz } of probes) {
      const cell = full / (N - 1);
      const wx = (ix - (N - 1) / 2) * cell;
      const wz = (iz - (N - 1) / 2) * cell;
      // Fresh Ray per probe: rapier.js copies vectors into wasm memory on
      // construction, so mutating an existing Ray's origin is not reliable.
      const ray = new RAPIER.Ray({ x: wx, y: 500, z: wz }, { x: 0, y: -1, z: 0 });
      const hit = world.castRay(ray, 1000, true);
      expect(hit).not.toBeNull();
      const hitY = 500 - (hit?.timeOfImpact ?? -1);
      expect(hitY).toBeCloseTo(grid[iz * N + ix] as number, 4);
    }
  });
});

describe('fillGeometryBuffers', () => {
  it('emits interior + skirt vertices with dropped skirt Y and sane normals', () => {
    const step = 1;
    const n = CHUNK_GRID;
    const heights = new Float32Array(n * n);
    const moisture = new Float32Array(n * n);
    // Gentle rolling surface so interior normals stay near straight-up.
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        heights[iz * n + ix] = 0.2 * Math.sin(ix * 0.07) * Math.cos(iz * 0.05);
      }
    }

    const cap = n * n + 4 * n;
    const positions = new Float32Array(cap * 3);
    const normals = new Float32Array(cap * 3);
    const moistAttr = new Float32Array(cap);
    const surfAttr = new Float32Array(cap);
    const range = { minY: Infinity, maxY: -Infinity };

    fillGeometryBuffers(step, heights, moisture, positions, normals, moistAttr, surfAttr, undefined, range);

    // Interior vertex 0 at local origin.
    expect(positions[0]).toBe(0);
    expect(positions[2]).toBe(0);
    // Gentle surface → unit-length normal pointing up.
    const len = Math.hypot(normals[0] as number, normals[1] as number, normals[2] as number);
    expect(len).toBeCloseTo(1, 5);
    expect(normals[1]).toBeGreaterThan(0.99);

    // First skirt vertex duplicates vertex 0 with Y dropped by skirtDepth.
    const sk = n * n;
    expect(positions[sk * 3]).toBe(0);
    expect(positions[sk * 3 + 1]).toBeLessThan(heights[0] as number);

    // Extent covers the full chunk edge; border vertices are shared with
    // neighbouring chunks so seams stay watertight.
    expect(range.maxY).toBeGreaterThanOrEqual(range.minY);
    const lastX = positions[((n - 1) * n + (n - 1)) * 3] as number;
    expect(lastX).toBeCloseTo(CHUNK_SIZE_M, 4);
  });
});
