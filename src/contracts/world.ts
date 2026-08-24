import type { Brand } from './brand';

/** Chunk coordinates in chunk units (not metres). */
export interface ChunkKey {
  readonly cx: number;
  readonly cz: number;
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

export type SurfaceMask = Brand<Uint8Array, 'SurfaceMask'>;

export const SURFACE_TRAIL = 0;
export const SURFACE_GRASS = 1;
export const SURFACE_MUD = 2;
export const SURFACE_ROCK = 3;

/** Terrain height sample at world position. Pure, deterministic, worker-safe. */
export type HeightFn = (x: number, z: number) => number;

/** One streamed chunk's payload. Typed arrays are transferred from workers. */
export interface ChunkData {
  readonly key: ChunkKey;
  /** CHUNK_GRID * CHUNK_GRID heights, row-major. */
  readonly heights: Float32Array;
  /** Per-vertex surface mask (SURFACE_* codes). */
  readonly surface: SurfaceMask;
  /** Moisture in [0,1] per vertex, drives material blending. */
  readonly moisture: Float32Array;
}

/** Result of a worker generation job. */
export interface ChunkGenResult {
  data: ChunkData;
  /** Worker-side wall time in ms, for the streaming budget ledger. */
  genMs: number;
}

/**
 * Streaming source of the endless world. Implementations must be seed-deterministic:
 * the same Seed + ChunkKey yields byte-identical height/surface arrays.
 */
export interface World {
  setSeed(seed: number): void;
  heightAt(x: number, z: number): number;
  surfaceAt(x: number, z: number): number;
  /** Ask the pool to ensure chunks within VIEW_DISTANCE_M of this position exist. */
  update(carX: number, carZ: number): void;
  /** Attach/detach Rapier heightfield colliders for chunks near the car. */
  syncColliders(carX: number, carZ: number): void;
  stats(): { live: number; pending: number; pooled: number };
}
