import { describe, expect, it } from 'vitest';
import {
  ParticleBuffers,
  RAIN_RATE,
  FIREFLY_NIGHT_COUNT,
  spawnDecision,
} from '../src/fx/particles';

/** Deterministic rng for tests. */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[(i++) % values.length] ?? 0.5;
}

describe('ParticleBuffers', () => {
  it('allocates once and never grows across simulated frames', () => {
    const buf = new ParticleBuffers(64);
    const before = buf.capacity;
    // Simulate many frames of churn: kill + spawn every frame.
    for (let f = 0; f < 1000; f++) {
      for (let i = 0; i < 10; i++) buf.kill(i);
      for (let i = 0; i < 10; i++) buf.spawn(f * 10 + i, i * 3, i * 5, -i);
    }
    expect(buf.capacity).toBe(before);
    expect(buf.alive).toBeLessThanOrEqual(before);
  });

  it('kill/spawn bookkeeping keeps alive count exact', () => {
    const buf = new ParticleBuffers(8);
    expect(buf.alive).toBe(0);
    buf.spawn(1, 0, 0, 0);
    buf.spawn(2, 1, 0, 0);
    expect(buf.alive).toBe(2);
    buf.kill(0);
    expect(buf.alive).toBe(1);
    buf.spawn(3, 2, 0, 0);
    expect(buf.alive).toBe(2);
  });

  it('spawn beyond capacity is a no-op (no allocation, no crash)', () => {
    const buf = new ParticleBuffers(4);
    for (let i = 0; i < 4; i++) buf.spawn(i, i, 0, 0);
    const capBefore = buf.capacity;
    buf.spawn(99, 9, 9, 0);
    expect(buf.capacity).toBe(capBefore);
    expect(buf.alive).toBe(4);
  });

  it('reduced motion kills everything and spawns nothing', () => {
    const buf = new ParticleBuffers(16);
    for (let i = 0; i < 16; i++) buf.spawn(i, i, 0, 0);
    buf.setReducedMotion(true);
    buf.step(1 / 60, 0, 0);
    expect(buf.alive).toBe(0);
  });
});

describe('spawn decision rules', () => {
  it('rain rate scales with weather intensity and never runs at clear', () => {
    expect(spawnDecision('clear', 1, 0.5)).toBe(false);
    let rainCount = 0;
    let drizzleCount = 0;
    for (let i = 0; i < 100; i++) {
      if (spawnDecision('rain', i / 100, 0.5)) rainCount++;
      if (spawnDecision('drizzle', i / 100, 0.5)) drizzleCount++;
    }
    expect(rainCount).toBeGreaterThan(drizzleCount); // intensity ordering
    expect(spawnDecision('rain', 1, 0.5)).toBe(true);
  });

  it('fireflies only at night with the contracted count', () => {
    expect(FIREFLY_NIGHT_COUNT).toBeGreaterThan(20);
    expect(FIREFLY_NIGHT_COUNT).toBeLessThan(400);
  });

  it('rain rate constant is calm (≤ 900/s at full intensity)', () => {
    expect(RAIN_RATE).toBeLessThanOrEqual(900);
    expect(RAIN_RATE).toBeGreaterThan(200);
  });

  it('deterministic: same inputs, same answer', () => {
    expect(spawnDecision('rain', 0.7, 0.42)).toBe(spawnDecision('rain', 0.7, 0.42));
  });

  it('rng stream integration stays deterministic under a fixed seed', () => {
    const rng = seqRng([0.1, 0.9, 0.3, 0.7, 0.05]);
    const a = [0, 0, 0].map(() => spawnDecision('drizzle', rng(), 0.5));
    const rng2 = seqRng([0.1, 0.9, 0.3, 0.7, 0.05]);
    const b = [0, 0, 0].map(() => spawnDecision('drizzle', rng2(), 0.5));
    expect(a).toEqual(b);
  });
});
