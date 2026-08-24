import type { ChunkGenResult, ChunkKey, SurfaceMask } from '@contracts/world';
import { TerrainSource } from './terrain-source';
import type { WorkerDoneMsg, WorkerRequest } from './worker/terrain.worker';

/**
 * Chunk-generation executors.
 *
 * - `WorkerPoolExecutor`: N = max(1, hardwareConcurrency-1) module workers;
 *   results arrive with TRANSFERRED typed arrays (zero-copy).
 * - `InlineExecutor`: same math on the calling thread — used in tests and
 *   environments without Worker support; identical byte output by construction.
 */

export interface GenExecutor {
  readonly kind: 'workers' | 'inline';
  /** Workers actually spawned (0 for inline). */
  readonly size: number;
  generate(key: ChunkKey): Promise<ChunkGenResult>;
  setSeed(seed: number): void;
  dispose(): void;
}

class InlineExecutor implements GenExecutor {
  readonly kind = 'inline' as const;
  readonly size = 0;
  private src = new TerrainSource(1337);

  async generate(key: ChunkKey): Promise<ChunkGenResult> {
    const t0 = performance.now();
    const data = this.src.generate(key);
    return { data, genMs: performance.now() - t0 };
  }

  setSeed(seed: number): void {
    this.src.setSeed(seed);
  }

  dispose(): void {}
}

interface PoolWorker {
  worker: Worker;
  inflight: number;
}

export class WorkerPoolExecutor implements GenExecutor {
  readonly kind = 'workers' as const;
  readonly size: number;
  private pool: PoolWorker[] = [];
  private nextId = 1;
  private rr = 0;
  private pending = new Map<
    number,
    { resolve: (r: ChunkGenResult) => void; reject: (e: Error) => void }
  >();

  constructor(seed: number) {
    const hw =
      typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : 4;
    const n = Math.max(1, Math.min(hw - 1, 8));
    this.size = n;
    for (let i = 0; i < n; i++) this.spawn(seed);
  }

  private spawn(seed: number): void {
    const worker = new Worker(new URL('./worker/terrain.worker.ts', import.meta.url), {
      type: 'module',
    });
    const pw: PoolWorker = { worker, inflight: 0 };
    const init: WorkerRequest = { type: 'init', seed };
    worker.onmessage = (ev: MessageEvent<WorkerDoneMsg>) => {
      const msg = ev.data;
      if (msg.type !== 'done') return;
      const entry = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      pw.inflight--;
      if (!entry) return;
      entry.resolve({
        data: {
          key: msg.key,
          heights: msg.heights,
          surface: msg.surface as SurfaceMask,
          moisture: msg.moisture,
        },
        genMs: msg.genMs,
      });
    };
    // Surface worker failures to the awaiting caller instead of hanging forever.
    worker.onerror = (ev) => {
      for (const [, entry] of this.pending) entry.reject(new Error(ev.message));
      this.pending.clear();
      pw.inflight = 0;
    };
    worker.postMessage(init);
    this.pool.push(pw);
  }

  generate(key: ChunkKey): Promise<ChunkGenResult> {
    // Least-loaded, round-robin tiebreak.
    let best = this.pool[this.rr % this.pool.length] as PoolWorker;
    this.rr++;
    for (const pw of this.pool) if (pw.inflight < best.inflight) best = pw;
    best.inflight++;

    const id = this.nextId++;
    const req: WorkerRequest = { type: 'gen', id, cx: key.cx, cz: key.cz };
    return new Promise<ChunkGenResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      best.worker.postMessage(req);
    });
  }

  setSeed(seed: number): void {
    const init: WorkerRequest = { type: 'init', seed };
    for (const pw of this.pool) pw.worker.postMessage(init);
  }

  dispose(): void {
    for (const pw of this.pool) pw.worker.terminate();
    this.pool = [];
    this.pending.clear();
  }
}

/** Pick the right executor for the environment. */
export function createExecutor(seed: number): GenExecutor {
  if (typeof Worker !== 'undefined') {
    try {
      return new WorkerPoolExecutor(seed);
    } catch {
      // Fall through to inline (e.g. exotic embedders).
    }
  }
  const ex = new InlineExecutor();
  ex.setSeed(seed);
  return ex;
}
