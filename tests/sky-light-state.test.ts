import { describe, it, expect } from 'vitest';
import {
  BAND_BOUNDS_DEG,
  bandFor,
  isSunRising,
  lightStateAt,
  moonElevationDeg,
  sunElevationDeg,
  sunLightFactor,
} from '@/sky/time';

/** Fine sweep step around boundaries: 30 seconds of game time = 0.2 min. */
const STEP_H = 30 / 3600;

describe('light-state bands', () => {
  it('maps canonical times to the six authored bands', () => {
    expect(lightStateAt(6.05)).toBe('dawn'); // opening
    expect(lightStateAt(10)).toBe('morning');
    expect(lightStateAt(12)).toBe('morning'); // noon is high day
    expect(lightStateAt(17.3)).toBe('goldenHour');
    expect(lightStateAt(18.05)).toBe('dusk');
    expect(lightStateAt(18.25)).toBe('blueHour');
    expect(lightStateAt(20)).toBe('night');
    expect(lightStateAt(2)).toBe('night');
  });

  it('band thresholds match BAND_BOUNDS_DEG', () => {
    const b = BAND_BOUNDS_DEG;
    expect(bandFor(b.night - 0.001, true)).toBe('night');
    expect(bandFor(b.night + 0.001, true)).toBe('blueHour');
    expect(bandFor(b.blueHour + 0.001, true)).toBe('dawn');
    expect(bandFor(b.blueHour + 0.001, false)).toBe('dusk');
    expect(bandFor(b.goldenLow + 0.001, true)).toBe('goldenHour');
    expect(bandFor(b.goldenHigh + 0.001, true)).toBe('morning');
  });

  it('sun elevation is continuous across every band boundary (fine sweep)', () => {
    // Walk the full day in 30s steps; the largest single-step elevation change
    // must be tiny and there must be NO jump anywhere (max |Δ| bound).
    let prev = sunElevationDeg(0);
    let maxStep = 0;
    for (let t = STEP_H; t <= 24; t += STEP_H) {
      const e = sunElevationDeg(t);
      maxStep = Math.max(maxStep, Math.abs(e - prev));
      prev = e;
    }
    // 0.6 h/s drift → 30 s real = 18 game-min = 0.3h; elevation rate ≤ 62°·π/12/h
    // ≈ 16.2°/h → ≤ ~4.9°/step expected; assert comfortably below any "pop".
    expect(maxStep).toBeLessThan(5);
  });

  it('direct-light intensity has no discontinuity at band edges', () => {
    const bounds = [
      BAND_BOUNDS_DEG.night,
      BAND_BOUNDS_DEG.blueHour,
      BAND_BOUNDS_DEG.goldenLow,
      BAND_BOUNDS_DEG.goldenHigh,
    ];
    const EPS_DEG = 1e-6;
    for (const b of bounds) {
      const before = sunLightFactor(b - EPS_DEG);
      const after = sunLightFactor(b + EPS_DEG);
      expect(Math.abs(after - before)).toBeLessThan(1e-4);
    }
  });

  it('intensity curve is continuous over a full-day fine sweep', () => {
    let prev = sunLightFactor(sunElevationDeg(0));
    let maxStep = 0;
    for (let t = STEP_H; t <= 24; t += STEP_H) {
      const v = sunLightFactor(sunElevationDeg(t));
      maxStep = Math.max(maxStep, Math.abs(v - prev));
      prev = v;
    }
    expect(maxStep).toBeLessThan(0.05); // smooth ramp, no pops
  });

  it('dawn/dusk split never flickers near the horizon crossings', () => {
    // Around sunrise (06:00) and sunset (18:00) ±5 min the label must be stable.
    const around = (centerH: number): string[] => {
      const seen = new Set<string>();
      for (let t = centerH - 5 / 60; t <= centerH + 5 / 60; t += STEP_H) {
        seen.add(lightStateAt(t));
      }
      return [...seen];
    };
    expect(around(6)).toEqual(['dawn']);
    expect(around(18)).toEqual(['dusk']);
  });

  it('rising flag flips only at noon/midnight, far from horizon bands', () => {
    expect(isSunRising(11.999)).toBe(true);
    expect(isSunRising(12.001)).toBe(false);
    expect(isSunRising(23.999)).toBe(false);
    expect(isSunRising(0.001)).toBe(true);
  });

  it('moon runs the opposite arc', () => {
    expect(moonElevationDeg(0)).toBeCloseTo(48, 0); // high at midnight
    expect(moonElevationDeg(12)).toBeCloseTo(-48, 0); // hidden at noon
    expect(moonElevationDeg(18)).toBeCloseTo(0, 5); // moonrise at sunset
  });
});
