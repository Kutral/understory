import { describe, expect, it } from 'vitest';
import { FxWorld } from '../src/fx/fx-world';

const SKY = (weather: 'clear' | 'mist' | 'drizzle' | 'rain' | 'after-rain', phase: 'dawn' | 'morning' | 'goldenHour' | 'dusk' | 'blueHour' | 'night') => ({ weather, phase });
const FLAT = (): number => 0;

describe('FxWorld', () => {
  it('rain spawns only in rain/drizzle and dies outside', () => {
    const fx = new FxWorld({ seed: 7 });
    for (let i = 0; i < 120; i++) fx.fixedUpdate(1 / 60, SKY('rain', 'morning'), 0, 0, FLAT);
    expect(fx.stats().rain).toBeGreaterThan(10);
    // Weather clears: rain ages out within its 3 s lifetime.
    for (let i = 0; i < 60 * 4; i++) fx.fixedUpdate(1 / 60, SKY('clear', 'morning'), 0, 0, FLAT);
    expect(fx.stats().rain).toBe(0);
    fx.dispose();
  });

  it('fireflies appear at night only', () => {
    const fx = new FxWorld({ seed: 3 });
    for (let i = 0; i < 30; i++) fx.fixedUpdate(1 / 60, SKY('clear', 'night'), 0, 0, FLAT);
    expect(fx.stats().fireflies).toBeGreaterThan(20);
    // At dawn the pool stops refilling; existing fireflies age out over
    // their 30–70 s lifetime. Run past the max lifetime.
    for (let i = 0; i < 60 * 75; i++) fx.fixedUpdate(1 / 60, SKY('clear', 'morning'), 0, 0, FLAT);
    expect(fx.stats().fireflies).toBe(0);
    fx.dispose();
  });

  it('reduced motion kills everything instantly and blocks spawning', () => {
    const fx = new FxWorld({ seed: 11 });
    for (let i = 0; i < 90; i++) fx.fixedUpdate(1 / 60, SKY('rain', 'night'), 0, 0, FLAT);
    expect(fx.stats().rain).toBeGreaterThan(0);
    fx.setReducedMotion(true);
    for (let i = 0; i < 60; i++) fx.fixedUpdate(1 / 60, SKY('rain', 'night'), 0, 0, FLAT);
    const s = fx.stats();
    expect(s.rain).toBe(0);
    expect(s.fireflies).toBe(0);
    expect(s.reducedMotion).toBe(1);
    fx.dispose();
  });

  it('birds flush when the car nears a tree', () => {
    const fx = new FxWorld({ seed: 5 });
    fx.flushBirdsNear(0, 0, 8, 6); // ~10 m away
    expect(fx.stats().birds).toBe(1);
    fx.flushBirdsNear(0, 0, 80, 60); // far away — no flush
    expect(fx.stats().birds).toBe(1);
    // Birds live 6 s; after that the sky is empty again.
    for (let i = 0; i < 60 * 7; i++) fx.fixedUpdate(1 / 60, SKY('clear', 'morning'), 0, 0, FLAT);
    expect(fx.stats().birds).toBe(0);
    fx.dispose();
  });

  it('buffer capacity never grows over a long churned run', () => {
    const fx = new FxWorld({ seed: 13, rainCapacity: 300 });
    let peakRain = 0;
    for (let i = 0; i < 60 * 20; i++) {
      fx.fixedUpdate(1 / 60, SKY(i % 2 ? 'rain' : 'drizzle', i < 600 ? 'night' : 'morning'), Math.sin(i / 200) * 40, Math.cos(i / 230) * 40, FLAT);
      peakRain = Math.max(peakRain, fx.stats().rain ?? 0);
    }
    expect(peakRain).toBeLessThanOrEqual(300);
    fx.dispose();
  });

  it('same seed produces identical population curves', () => {
    const mk = (): number[] => {
      const fx = new FxWorld({ seed: 42 });
      const out: number[] = [];
      for (let i = 0; i < 240; i++) {
        fx.fixedUpdate(1 / 60, SKY(i > 120 ? 'rain' : 'drizzle', 'morning'), 0, 0, FLAT);
        if (i % 30 === 0) out.push(fx.stats().rain ?? 0);
      }
      fx.dispose();
      return out;
    };
    expect(mk()).toEqual(mk());
  });
});
