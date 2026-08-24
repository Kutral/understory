/**
 * Public surface of the world-terrain subsystem (agent B).
 */

export { TerrainSource, TRAIL_CARVE_DEPTH_M } from './terrain-source';
export type { TerrainSample } from './terrain-source';
export {
  TrailNetwork,
  TRAIL_CELL_M,
  TRAIL_HALF_WIDTH_M,
  TRAIL_FEATHER_M,
} from './trail-network';
export type { Polyline } from './trail-network';
export {
  splitmix32,
  hash2,
  simplex2,
  makePermutation,
  makeNoiseField,
} from './noise';
export { createExecutor, WorkerPoolExecutor } from './gen-executor';
export type { GenExecutor } from './gen-executor';
export { ChunkStreamer } from './chunk-streamer';
export type { StreamStats } from './chunk-streamer';
export { GeometryPool, fillGeometryBuffers } from './geometry-pool';
export type { PooledChunkMesh } from './geometry-pool';
export {
  buildIndices,
  desiredChunks,
  gridN,
  levelForRing,
  ringOf,
  skirtDepth,
  totalVerts,
  STEP_BY_RING,
} from './lod';
export { ColliderRing, toRapierHeights } from './colliders';
export type { GridLookup } from './colliders';
export { createTerrainMaterial } from './material';
export { TerrainWorld } from './terrain-world';
