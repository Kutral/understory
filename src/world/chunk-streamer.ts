import * as THREE from 'three/webgpu';
import { CHUNK_SIZE_M } from '@contracts/constants';
import type { ChunkData, ChunkGenResult, ChunkKey } from '@contracts/world';
import type { GenExecutor } from './gen-executor';
import { GeometryPool, type PooledChunkMesh } from './geometry-pool';
import { desiredChunks } from './lod';

/**
 * Chunk streaming: keeps the 5-ring desired set alive around the car, requests
 * missing chunks nearest-first, recycles pooled meshes on ring changes and
 * evicts out-of-view chunks. Main-thread work per completed chunk is one typed
 * array copy into a pooled buffer (measured in docs/notes/world-terrain.md).
 */

interface LiveChunk {
  key: ChunkKey;
  entry: PooledChunkMesh;
}

interface PendingReq {
  promise: Promise<ChunkGenResult>;
  step: number;
}

export interface StreamStats {
  live: number;
  pending: number;
  pooled: number;
}

export class ChunkStreamer {
  readonly group = new THREE.Group();
  private readonly pool: GeometryPool;
  private readonly live = new Map<string, LiveChunk>();
  private readonly pending = new Map<string, PendingReq>();

  constructor(
    private readonly executor: GenExecutor,
    material: THREE.Material,
    private readonly maxInflight = Math.max(2, executor.size * 2),
    private readonly onChunkReady?: (data: ChunkData) => void,
  ) {
    this.pool = new GeometryPool(material);
  }

  /** Test hook: pooled-but-not-live entries. */
  get pooledCount(): number {
    return this.pool.pooledCount();
  }

  update(carX: number, carZ: number): void {
    const want = desiredChunks(carX, carZ);
    const wantKeys = new Set<string>();

    for (const { key, step } of want) {
      const k = `${key.cx},${key.cz}`;
      wantKeys.add(k);

      const cur = this.live.get(k);
      if (cur && cur.entry.step === step) continue; // already correct LOD
      if (this.pending.has(k)) continue; // request already in flight

      const budgetOk =
        this.pending.size < this.maxInflight || cur !== undefined /* upgrades jump queue */;
      if (!budgetOk) continue;

      const req: PendingReq = {
        promise: this.executor.generate(key),
        step,
      };
      this.pending.set(k, req);
      void req.promise
        .then((res) => {
          this.pending.delete(k);
          this.attach(res, req.step);
        })
        .catch(() => {
          this.pending.delete(k); // stay degraded but alive; next update retries
        });
    }

    // Evict anything outside the desired set.
    for (const [k, lc] of this.live) {
      if (!wantKeys.has(k)) {
        this.group.remove(lc.entry.mesh);
        this.pool.release(lc.entry);
        this.live.delete(k);
      }
    }
  }

  private attach(res: ChunkGenResult, step: number): void {
    const k = `${res.data.key.cx},${res.data.key.cz}`;
    const old = this.live.get(k);
    if (old) {
      this.group.remove(old.entry.mesh);
      this.pool.release(old.entry);
    }
    const half = CHUNK_SIZE_M / 2;
    const originX = res.data.key.cx * CHUNK_SIZE_M;
    const originZ = res.data.key.cz * CHUNK_SIZE_M;
    const entry = this.pool.acquire(step, res.data, originX, originZ, half);
    this.live.set(k, { key: res.data.key, entry });
    this.group.add(entry.mesh);
    this.onChunkReady?.(res.data);
  }

  stats(): StreamStats {
    return {
      live: this.live.size,
      pending: this.pending.size,
      pooled: this.pool.pooledCount(),
    };
  }

  dispose(): void {
    for (const [, lc] of this.live) {
      this.group.remove(lc.entry.mesh);
      this.pool.release(lc.entry);
    }
    this.live.clear();
    this.pool.dispose();
  }
}
