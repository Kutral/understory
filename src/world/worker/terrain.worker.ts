/// <reference lib="webworker" />
import type { ChunkKey } from '@contracts/world';
import { TerrainSource } from '../terrain-source';

/**
 * Chunk generation worker. One TerrainSource per worker (reused across jobs so
 * permutation tables warm up); results are plain typed arrays handed back via
 * transferables — no structured clone of payload data ever happens.
 */

export interface WorkerInitMsg {
  type: 'init';
  seed: number;
}

export interface WorkerGenMsg {
  type: 'gen';
  id: number;
  cx: number;
  cz: number;
}

export type WorkerRequest = WorkerInitMsg | WorkerGenMsg;

export interface WorkerDoneMsg {
  type: 'done';
  id: number;
  key: ChunkKey;
  heights: Float32Array;
  surface: Uint8Array;
  moisture: Float32Array;
  /** Worker-side wall time in ms. */
  genMs: number;
}

const source = new TerrainSource(1337);

self.onmessage = (ev: MessageEvent<WorkerRequest>): void => {
  const msg = ev.data;
  if (msg.type === 'init') {
    source.setSeed(msg.seed);
    return;
  }
  const t0 = performance.now();
  const data = source.generate({ cx: msg.cx, cz: msg.cz });
  const done: WorkerDoneMsg = {
    type: 'done',
    id: msg.id,
    key: { cx: msg.cx, cz: msg.cz },
    heights: data.heights,
    surface: data.surface,
    moisture: data.moisture,
    genMs: performance.now() - t0,
  };
  (self as unknown as Worker).postMessage(done, [
    data.heights.buffer,
    data.surface.buffer,
    data.moisture.buffer,
  ]);
};
