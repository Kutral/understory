import type { ChunkKey } from './world';

export type FloraKind = 'pine' | 'birch' | 'oak' | 'snag' | 'sapling' | 'fern' | 'grass';

export type FloraLod = 'full' | 'mid' | 'far' | 'impostor';

export interface TreePlacement {
  /** Local position within chunk, metres. */
  readonly x: number;
  readonly z: number;
  /** Species index into the species table. */
  readonly species: number;
  /** Uniform scale multiplier around the species base size. */
  readonly scale: number;
  /** Y rotation, radians. */
  readonly rotY: number;
  /** Hue variation in [-1, 1]. */
  readonly hue: number;
}

/** Deterministic flora layout source for one chunk. Worker-safe, pure math. */
export interface FloraProvider {
  /** All tree placements for a chunk. Called once when a chunk streams in. */
  treesFor(key: ChunkKey): TreePlacement[];
  /** Undergrowth blade/fern placements near ring 0..1 only. */
  undergrowthFor(key: ChunkKey): TreePlacement[];
}
