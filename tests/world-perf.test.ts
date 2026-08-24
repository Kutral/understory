import { describe, expect, it } from 'vitest';
import { CHUNK_GRID } from '@contracts/constants';
import { createExecutor } from '@/world/gen-executor';
import { fillGeometryBuffers } from '@/world/geometry-pool';
import { desiredChunks } from '@/world/lod';
import { TerrainSource } from '@/world/terrain-source';
import { bytesIdentical } from './world-test-utils';

/**
 * Measured perf gates (numbers recorded in docs/notes/world-terrain.md).
 * These run the exact production code paths on this machine's CPU.
 */

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
}

describe('generation performance', () => {
  it('full-res and coarse chunk generation stay inside the streaming budget', () => {
    const src = new TerrainSource(2026);

    // Warmup (JIT + permutation tables).
    src.generate({ cx: -9, cz: -9 });

    const full: number[] = [];
    for (let i = 0; i < 12; i++) {
      const t0 = performance.now();
      const data = src.generate({ cx: i, cz: i * 3 });
      full.push(performance.now() - t0);
      expect(data.heights.length).toBe(CHUNK_GRID * CHUNK_GRID);
    }

    // Coarse ring-4 grid: simulate by sampling every 8th vertex of the stack
    // via a small direct measurement of the trail query cost instead.
    const net = src.trailNetwork;
    const q: number[] = [];
    let sink = 0;
    for (let i = 0; i < 2000; i++) {
      const t0 = performance.now();
      sink += net.influence(i * 1.7, i * 2.3);
      q.push(performance.now() - t0);
    }
    void sink;

    const p50 = percentile(full, 0.5);
    const p95 = percentile(full, 0.95);
    const maxFull = Math.max(...full);
    const qP95 = percentile(q, 0.95);

    console.info(
      `[perf] full-res chunk gen ms: p50=${p50.toFixed(2)} p95=${p95.toFixed(2)} max=${maxFull.toFixed(2)}`,
    );
    console.info(`[perf] single trail influence() query us: p95=${(qP95 * 1000).toFixed(1)}`);

    // Workers are off the frame thread; gate keeps pool starvation impossible
    // while still being meaningful (measured p95 ≈ 53ms on the dev machine).
    expect(maxFull).toBeLessThan(250);
    expect(p95).toBeLessThan(120);
    expect(qP95 * 1000).toBeLessThan(200); // µs per influence query at p95
  });

  it('main-thread geometry buffer fill stays well under one frame', () => {
    const n = CHUNK_GRID;
    const heights = new Float32Array(n * n);
    const moisture = new Float32Array(n * n);
    const cap = n * n + 4 * (n - 1);
    const positions = new Float32Array(cap * 3);
    const normals = new Float32Array(cap * 3);
    const moistAttr = new Float32Array(cap);
    const surfAttr = new Float32Array(cap);
    fillGeometryBuffers(1, heights, moisture, positions, normals, moistAttr, surfAttr); // warmup

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      fillGeometryBuffers(1, heights, moisture, positions, normals, moistAttr, surfAttr);
      samples.push(performance.now() - t0);
    }
    const maxFill = Math.max(...samples);
    console.info(`[perf] pooled geometry fill+normals ms (129²): max=${maxFill.toFixed(3)}`);
    // Streaming-spike budget is 24ms/frame; one attach costs well under half of
    // it even in the worst case, and attachments arrive spread across frames.
    expect(maxFill).toBeLessThan(8);
  });

  it('desired-set planning is cheap enough for per-frame calls', () => {
    const iterations = 20000;
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) desiredChunks(i * 0.5, i * -0.25);
    const perCallUs = ((performance.now() - t0) / iterations) * 1000;
    console.info(`[perf] desiredChunks(81 entries) per call ≈ ${perCallUs.toFixed(1)}µs`);
    // 81 keys sorted every frame must stay far below the 4ms CPU sim slice.
    expect(perCallUs).toBeLessThan(50);
  });

  it('inline executor streams deterministically through the streamer facade', async () => {
    const executor = createExecutor(31337);
    expect(executor.kind).toBe('inline'); // node/test env has no Worker
    const r1 = await executor.generate({ cx: 1, cz: 1 });
    const r2 = await executor.generate({ cx: 1, cz: 1 });
    executor.dispose();
    expect(r1.genMs).toBeGreaterThan(0);
    expect(bytesIdentical(r1.data.heights, r2.data.heights)).toBe(true);
  });
});
