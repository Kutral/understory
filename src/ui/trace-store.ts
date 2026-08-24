/**
 * The Trace — recording core (signature feature, ART-DIRECTION §6.4).
 *
 * Pure logic, no DOM: records the driven path decimated to ~4 points per
 * second while moving, detects idles longer than 20 s and presses a
 * specimen mark there, and persists everything to a injectable storage
 * (localStorage in the app, an in-memory map in tests).
 *
 * Determinism: the ink wobble applied at render time is derived from
 * (point index, seed) — never Math.random — so the same drive always draws
 * the same plate.
 */
import type { TraceMark, TracePoint, TraceStore } from '@contracts/ui';

export const IDLE_MARK_S = 20;
/** Target recording cadence while moving (seconds between samples). */
export const SAMPLE_DT_S = 0.25;
/** Samples closer than this distance are dropped even if due (noise gate). */
export const MIN_MOVE_M = 1.2;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_VERSION = 1;
const MAX_POINTS = 40_000; // ~2.8 h of driving; keeps SVG render bounded

interface SerializedTrace {
  v: number;
  seed: number;
  points: TracePoint[];
  heights: number[];
  marks: TraceMark[];
}

/** Deterministic 32-bit hash (FNV-1a style) for wobble + label variation. */
export function hash2(a: number, b: number): number {
  let h = 0x811c9dc5 | 0;
  h = Math.imul(h ^ (a | 0), 0x01000193);
  h = Math.imul(h ^ (b | 0), 0x01000193);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * Hand-inked stroke generator. Maps world points into plate units using the
 * given bounds, adds bounded deterministic jitter per vertex, and emits an
 * SVG path `d`. Same inputs -> byte-identical output.
 */
export function buildWobblePathD(
  pts: ReadonlyArray<{ x: number; z: number }>,
  bounds: { minX: number; minZ: number; scale: number },
  pad: number,
  seed: number,
): string {
  if (pts.length === 0) return '';
  const jx = (i: number): number => ((hash2(i * 2654435761, seed) % 1000) / 1000 - 0.5) * 2.2;
  const jy = (i: number): number => ((hash2(i * 40503, seed ^ 0x9e3779b9) % 1000) / 1000 - 0.5) * 2.2;
  let d = '';
  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]!;
    const px = pad + (pt.x - bounds.minX) * bounds.scale + jx(i);
    const py = pad + (pt.z - bounds.minZ) * bounds.scale + jy(i);
    // Stroke-width breathes subtly along the line (ink load), deterministic.
    const cmd = i === 0 ? 'M' : 'L';
    d += `${cmd}${px.toFixed(2)} ${py.toFixed(2)}`;
    if (i < pts.length - 1) d += ' ';
  }
  return d;
}

/** Fit bounds so the trace fills the plate with padding, preserving aspect. */
export function fitBounds(
  pts: ReadonlyArray<{ x: number; z: number }>,
  plateSize: number,
  pad: number,
): { minX: number; minZ: number; scale: number } {
  if (pts.length === 0) return { minX: 0, minZ: 0, scale: 1 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const spanX = Math.max(maxX - minX, 1);
  const spanZ = Math.max(maxZ - minZ, 1);
  const scale = (plateSize - pad * 2) / Math.max(spanX, spanZ);
  // Center the shorter axis.
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const half = (plateSize - pad * 2) / 2;
  return {
    minX: centerX - half / scale,
    minZ: centerZ - half / scale,
    scale,
  };
}

export class TraceRecorder implements TraceStore {
  private seed = 2026;
  private points: TracePoint[] = [];
  private heights: number[] = [];
  private marks: TraceMark[] = [];
  private lastSampleT = -Infinity;
  private lastX = 0;
  private lastZ = 0;
  private idleStartT: number | null = null;
  private sessionStartT = 0;
  private dirty = false;

  constructor(
    private readonly storage: StorageLike | null,
    private readonly heightAt: (x: number, z: number) => number = () => 0,
  ) {}

  beginSeed(seed: number): void {
    this.seed = seed >>> 0;
    this.points = [];
    this.heights = [];
    this.marks = [];
    this.lastSampleT = -Infinity;
    this.idleStartT = null;
    this.sessionStartT = 0;
    this.load();
  }

  /**
   * Per-fixed-tick feed. `t` is seconds since session start, `speedMs` m/s.
   * Decimates to ~4 Hz while moving; tracks idles and presses marks.
   */
  record(x: number, z: number, t: number, speedMs: number): void {
    if (this.points.length === 0) {
      this.sessionStartT = t;
      this.push(x, z, t);
      this.lastX = x;
      this.lastZ = z;
      return;
    }
    const moving = speedMs > 0.35;
    if (moving) {
      if (this.idleStartT !== null) {
        this.idleStartT = null; // stood up again before the 20 s threshold
      }
      const moved = Math.hypot(x - this.lastX, z - this.lastZ);
      if (t - this.lastSampleT >= SAMPLE_DT_S && moved >= MIN_MOVE_M) {
        this.push(x, z, t);
        this.lastX = x;
        this.lastZ = z;
      }
    } else {
      if (this.idleStartT === null) this.idleStartT = t;
      const idleFor = t - this.idleStartT;
      if (idleFor >= IDLE_MARK_S && (this.marks.length === 0 || t - this.lastMarkT() >= IDLE_MARK_S)) {
        this.addMark({
          x,
          z,
          label: `Stopped · ${formatClock(t - this.sessionStartT)}`,
        });
        this.idleStartT = t; // one mark per continuous stop
      }
    }
    if (this.dirty) this.save();
  }

  addMark(mark: TraceMark): void {
    this.marks.push(mark);
    this.dirty = true;
  }

  /** Contract method: append an already-decimated point directly. */
  append(pt: TracePoint): void {
    this.push(pt.x, pt.z, pt.t);
    this.lastX = pt.x;
    this.lastZ = pt.z;
  }

  exportForPlate(): { points: TracePoint[]; marks: TraceMark[]; heights: number[]; seed: number } {
    return {
      points: this.points,
      marks: this.marks,
      heights: this.heights,
      seed: this.seed,
    };
  }

  /** Total driven distance in metres (for the plate header). */
  distanceM(): number {
    let d = 0;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1]!;
      const b = this.points[i]!;
      d += Math.hypot(b.x - a.x, b.z - a.z);
    }
    return d;
  }

  private lastMarkT(): number {
    // Marks do not carry t; approximate spacing by point proximity search.
    const last = this.points[this.points.length - 1];
    return last ? last.t : 0;
  }

  private push(x: number, z: number, t: number): void {
    if (this.points.length >= MAX_POINTS) this.points.shift(); // ring behaviour
    this.points.push({ x, z, t });
    this.heights.push(this.heightAt(x, z));
    this.lastSampleT = t;
    this.dirty = true;
  }

  private storageKey(): string {
    return `understory-trace-${this.seed}`;
  }

  private save(): void {
    if (!this.storage) return;
    const payload: SerializedTrace = {
      v: STORAGE_VERSION,
      seed: this.seed,
      points: this.points,
      heights: this.heights,
      marks: this.marks,
    };
    try {
      this.storage.setItem(this.storageKey(), JSON.stringify(payload));
      this.dirty = false;
    } catch {
      // Quota errors must never break the drive; retry on next dirty flush.
    }
  }

  private load(): void {
    if (!this.storage) return;
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.storageKey());
    } catch {
      return; // storage unavailable headless/private: fresh trace, never crash
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<SerializedTrace>;
      if (
        parsed.v !== STORAGE_VERSION ||
        !Array.isArray(parsed.points) ||
        !Array.isArray(parsed.marks)
      ) {
        throw new Error('shape');
      }
      this.points = parsed.points.filter(
        (p) => p && Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.t),
      );
      this.heights = Array.isArray(parsed.heights)
        ? parsed.heights.filter((h) => Number.isFinite(h))
        : [];
      this.marks = parsed.marks.filter((m) => m && Number.isFinite(m.x) && Number.isFinite(m.z));
      if (this.points.length > 0) {
        const lastP = this.points[this.points.length - 1];
        const firstP = this.points[0]!;
        if (lastP) {
          this.lastX = lastP.x;
          this.lastZ = lastP.z;
          this.lastSampleT = lastP.t;
        }
        this.sessionStartT = firstP.t;
      }
    } catch {
      // Corrupted data: start a fresh trace rather than showing nothing forever.
      this.storage.removeItem(this.storageKey());
      this.points = [];
      this.heights = [];
      this.marks = [];
    }
  }
}

/** mm:ss clock for typewritten labels. */
export function formatClock(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}
