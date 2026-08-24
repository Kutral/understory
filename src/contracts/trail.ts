import type { ChunkKey } from './world';

/**
 * Deterministic trail network carved into the heightfield.
 * A warped spline network that always gives somewhere inviting to follow,
 * but never walls the player in.
 */
export interface TrailNetwork {
  /** True if world position is on compacted trail dirt. */
  isTrail(x: number, z: number): boolean;
  /** Distance to nearest trail centreline, metres (approximate, chunk-cached). */
  distanceTo(x: number, z: number): number;
  /** Trail influence in [0,1] used by terrain carving and the surface mask. */
  influence(x: number, z: number): number;
  /** Debug/Trace helper: polyline segments for one chunk. */
  segmentsFor(key: ChunkKey): Array<{ ax: number; az: number; bx: number; bz: number }>;
}
