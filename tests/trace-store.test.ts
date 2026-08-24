import { describe, expect, it } from 'vitest';
import {
  TraceRecorder,
  buildWobblePathD,
  fitBounds,
  formatClock,
  hash2,
  IDLE_MARK_S,
  SAMPLE_DT_S,
} from '../src/ui/trace-store';
import type { StorageLike } from '../src/ui/trace-store';

class MemStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Drive a recorder: move at `speed` for `seconds`, sampling at 60 Hz. */
function drive(rec: TraceRecorder, seconds: number, speedMs: number, startX = 0, startZ = 0): number {
  let x = startX;
  let z = startZ;
  let t = rec === rec ? 0 : 0;
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    t += dt;
    x += Math.cos(0.3) * speedMs * dt;
    z += Math.sin(0.3) * speedMs * dt;
    rec.record(x, z, t, speedMs);
  }
  return t;
}

describe('TraceRecorder', () => {
  it('decimates to ~4 points/sec while moving', () => {
    const rec = new TraceRecorder(null);
    rec.beginSeed(2026);
    drive(rec, 10, 8); // 10 s at 8 m/s
    const { points } = rec.exportForPlate();
    // 4 Hz target -> between 30 and 45 samples for 10 s.
    expect(points.length).toBeGreaterThanOrEqual(30);
    expect(points.length).toBeLessThanOrEqual(45);
  });

  it('same seed + same drive produce identical arrays', () => {
    const mk = (): TraceRecorder => {
      const r = new TraceRecorder(new MemStorage());
      r.beginSeed(2026);
      return r;
    };
    const a = mk();
    const b = mk();
    drive(a, 6, 7);
    drive(b, 6, 7);
    expect(a.exportForPlate().points).toEqual(b.exportForPlate().points);
  });

  it('presses a specimen mark after IDLE_MARK_S stopped', () => {
    const rec = new TraceRecorder(null);
    rec.beginSeed(2026);
    let x = 0;
    let z = 0;
    let t = 0;
    const dt = 1 / 60;
    // drive a little first so recording is primed
    for (let i = 0; i < 120; i++) {
      t += dt;
      x += 0.1;
      rec.record(x, z, t, 6);
    }
    // now stand still for 25 s
    for (let i = 0; i < 25 * 60; i++) {
      t += dt;
      rec.record(x, z, t, 0);
    }
    const { marks } = rec.exportForPlate();
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]!.label).toMatch(/Stopped/);
  });

  it('no mark when the stop is shorter than the threshold', () => {
    const rec = new TraceRecorder(null);
    rec.beginSeed(2026);
    let x = 0;
    let z = 0;
    let t = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      t += dt;
      x += 0.1;
      rec.record(x, z, t, 6);
    }
    for (let i = 0; i < (IDLE_MARK_S - 4) * 60; i++) {
      t += dt;
      rec.record(x, z, t, 0);
    }
    expect(rec.exportForPlate().marks.length).toBe(0);
  });

  it('persists to storage and reloads the same trace', () => {
    const store = new MemStorage();
    const a = new TraceRecorder(store);
    a.beginSeed(2026);
    drive(a, 5, 9);
    const b = new TraceRecorder(store);
    b.beginSeed(2026); // loads what a wrote
    expect(b.exportForPlate().points).toEqual(a.exportForPlate().points);
  });

  it('corrupted storage data falls back to a fresh trace', () => {
    const store = new MemStorage();
    store.setItem('understory-trace-2026', '{not json!!');
    const rec = new TraceRecorder(store);
    rec.beginSeed(2026);
    expect(rec.exportForPlate().points.length).toBe(0);
    // and the bad entry was cleaned up
    expect(store.getItem('understory-trace-2026')).toBeNull();
  });

  it('distance integrates path length', () => {
    const rec = new TraceRecorder(null);
    rec.beginSeed(2026);
    drive(rec, 10, 10); // ~100 m along a straight heading
    expect(rec.distanceM()).toBeGreaterThan(80);
    expect(rec.distanceM()).toBeLessThan(110);
  });
});

describe('ink rendering helpers', () => {
  it('wobble path d is deterministic per seed', () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ x: i * 2, z: (i % 7) * 3 }));
    const bounds = fitBounds(pts, 640, 56);
    const a = buildWobblePathD(pts, bounds, 56, 2026);
    const b = buildWobblePathD(pts, bounds, 56, 2026);
    const c = buildWobblePathD(pts, bounds, 56, 999);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('M')).toBe(true);
  });

  it('hash2 is stable and well-spread', () => {
    expect(hash2(1, 2)).toBe(hash2(1, 2));
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(hash2(i, 42));
    expect(seen.size).toBeGreaterThan(450);
  });

  it('formatClock renders mm:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(-3)).toBe('0:00');
  });

  it('sample cadence constant matches the 4 Hz contract', () => {
    expect(SAMPLE_DT_S).toBeCloseTo(0.25);
  });
});
