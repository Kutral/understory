import * as THREE from 'three/webgpu';
import type { ChunkData, ChunkKey, World } from '@contracts/world';
import type { World as RapierWorld } from '@dimforge/rapier3d-compat';
import { ChunkStreamer } from './chunk-streamer';
import { ColliderRing, type RapierAPI } from './colliders';
import { createExecutor, type GenExecutor } from './gen-executor';
import { createTerrainMaterial } from './material';
import { TerrainSource } from './terrain-source';
import { CHUNK_RINGS } from '@contracts/constants';

/**
 * TerrainWorld — the World-contract facade for agent B's subsystem.
 *
 * CPU-side queries (`heightAt`/`surfaceAt`) run the exact same deterministic
 * functions workers use, so gameplay/flora/colliders always agree with the GPU
 * meshes. Collider height grids come straight from worker output (LRU-cached).
 */

/**
 * Keeps recent chunk grids for collider construction without unbounded growth.
 *
 * The cap MUST exceed the largest streamed set (the pre-boot warmup pumps the
 * full desired ring, (2·CHUNK_RINGS+1)² chunks): a smaller cap lets the LRU
 * evict the spawn-centre grids before the physics ring can claim them, and
 * since those chunks are already `live` they never regenerate — leaving the
 * car with no ground colliders (it falls through the world). Sizing for two
 * extra rings beyond view distance keeps lookups hits under any pump order.
 */
export class GridCache {
  private map = new Map<string, Float32Array>();
  constructor(public readonly cap = (2 * CHUNK_RINGS + 3) ** 2) {}

  put(key: ChunkKey, heights: Float32Array): void {
    const k = `${key.cx},${key.cz}`;
    this.map.delete(k); // refresh recency
    this.map.set(k, heights);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next();
      if (oldest.done) break;
      this.map.delete(oldest.value);
    }
  }

  get(cx: number, cz: number): Float32Array | null {
    return this.map.get(`${cx},${cz}`) ?? null;
  }

  clear(): void {
    this.map.clear();
  }
}

export class TerrainWorld implements World {
  /** Add this to your scene. */
  readonly mesh: THREE.Object3D;

  private readonly source: TerrainSource;
  private readonly executor: GenExecutor;
  private readonly streamer: ChunkStreamer;
  private readonly grids = new GridCache();
  private readonly material: THREE.MeshStandardNodeMaterial;
  private colliders: ColliderRing | null = null;

  constructor(seed = 1337) {
    this.source = new TerrainSource(seed);
    this.executor = createExecutor(seed);
    this.material = createTerrainMaterial();
    // Cache worker grids as they arrive so collider creation needs no re-gen.
    this.streamer = new ChunkStreamer(
      this.executor,
      this.material,
      undefined,
      (data: ChunkData) => {
        this.grids.put(data.key, data.heights.slice());
      },
    );
    this.mesh = this.streamer.group;
  }

  /**
   * Optional late binding of physics. Call after `RAPIER.init()` and world
   * creation; before that, syncColliders() is a no-op.
   */
  attachPhysics(rapier: RapierAPI, world: RapierWorld): void {
    this.colliders = new ColliderRing(world, rapier);
  }

  setSeed(seed: number): void {
    this.source.setSeed(seed);
    this.executor.setSeed(seed);
    this.grids.clear();
    // Drop every streamed chunk; next update() regenerates under the new seed.
    this.streamer.dispose();
    this.colliders?.dispose();
  }

  heightAt(x: number, z: number): number {
    return this.source.heightAt(x, z);
  }

  surfaceAt(x: number, z: number): number {
    return this.source.surfaceAt(x, z);
  }

  get trails(): TerrainSource['trailNetwork'] {
    return this.source.trailNetwork;
  }

  update(carX: number, carZ: number): void {
    this.streamer.update(carX, carZ);
  }

  syncColliders(carX: number, carZ: number): void {
    if (!this.colliders) return;
    this.colliders.sync(carX, carZ, (cx, cz) => this.grids.get(cx, cz));
  }

  stats(): { live: number; pending: number; pooled: number } {
    return this.streamer.stats();
  }

  /** Collider count in the physics ring (0 when physics not attached). */
  get colliderCount(): number {
    return this.colliders?.size ?? 0;
  }

  dispose(): void {
    this.executor.dispose();
    this.streamer.dispose();
    this.colliders?.dispose();
    this.material.dispose();
  }
}
