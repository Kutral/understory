/** Pure response curves: engine layer weights, detune mapping, surface, wind, master cutoff. */
import { describe, expect, it } from 'vitest';
import {
  ENGINE_LAYERS,
  detuneCents,
  engineLayerFreq,
  engineLayerWeights,
  masterCutoff,
  surfaceWeights,
  volumeCurve,
  windGain,
} from '@/audio/curves';
import { SURFACE_GRASS, SURFACE_MUD, SURFACE_ROCK, SURFACE_TRAIL } from '@contracts/world';

describe('engine layer weights', () => {
  it('sums to exactly 1 everywhere across the rpm range', () => {
    for (let i = 0; i <= 1000; i++) {
      const w = engineLayerWeights(i / 1000);
      const sum = w[0] + w[1] + w[2];
      expect(sum).toBeCloseTo(1, 9);
    }
  });

  it('weights are all non-negative', () => {
    for (let i = 0; i <= 100; i++) {
      const w = engineLayerWeights(i / 100);
      for (const x of w) expect(x).toBeGreaterThanOrEqual(0);
    }
  });

  it('the centred layer dominates at each layer centre', () => {
    ENGINE_LAYERS.forEach((spec, i) => {
      const w = engineLayerWeights(spec.center);
      expect(w[i]!).toBeGreaterThan(0.55);
    });
  });

  it('crossfades smoothly: adjacent samples differ by a small delta', () => {
    let prev = engineLayerWeights(0);
    for (let i = 1; i <= 500; i++) {
      const cur = engineLayerWeights(i / 500);
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(cur[k]! - prev[k]!)).toBeLessThan(0.05);
      }
      prev = cur;
    }
  });

  it('clamps rpm outside [0,1]', () => {
    expect(engineLayerWeights(-5)).toEqual(engineLayerWeights(0));
    expect(engineLayerWeights(7)).toEqual(engineLayerWeights(1));
  });
});

describe('detune curve mapping (subtle by contract)', () => {
  const MAX_CENTS = 8;

  it('stays within ±8 cents for every layer across rpm', () => {
    for (let layer = 0; layer < ENGINE_LAYERS.length; layer++) {
      for (let i = 0; i <= 200; i++) {
        const c = detuneCents(i / 200, layer);
        expect(Math.abs(c)).toBeLessThanOrEqual(MAX_CENTS);
      }
    }
  });

  it('is ~0 at rest and at full rpm (locked-in feel at both ends)', () => {
    for (let layer = 0; layer < ENGINE_LAYERS.length; layer++) {
      expect(Math.abs(detuneCents(0, layer))).toBeLessThan(0.6);
      expect(Math.abs(detuneCents(1, layer))).toBeLessThan(0.6);
    }
  });

  it('peaks near each layer centre with the spec sign and most of its magnitude', () => {
    ENGINE_LAYERS.forEach((spec, i) => {
      const c = detuneCents(spec.center, i);
      expect(Math.sign(c)).toBe(Math.sign(spec.cents));
      expect(Math.abs(c)).toBeGreaterThan(0.5 * Math.abs(spec.cents));
      expect(Math.abs(c)).toBeLessThanOrEqual(Math.abs(spec.cents) + 1e-9);
      expect(Math.abs(spec.cents)).toBeLessThan(MAX_CENTS);
    });
  });

  it('signs differ between layers so they beat gently, not in phase', () => {
    const c0 = detuneCents(0.14, 0);
    const c1 = detuneCents(0.5, 1);
    expect(Math.sign(c0)).not.toBe(Math.sign(c1));
  });
});

describe('engine layer frequency mapping', () => {
  it('sweeps monotonically inside the warm-hum band (<220 Hz)', () => {
    for (let layer = 0; layer < ENGINE_LAYERS.length; layer++) {
      let prev = 0;
      for (let i = 0; i <= 100; i++) {
        const f = engineLayerFreq(i / 100, layer);
        expect(f).toBeGreaterThanOrEqual(prev);
        expect(f).toBeLessThan(220);
        prev = f;
      }
    }
  });
});

describe('surface weights', () => {
  it('are one-hot per valid code', () => {
    const cases: Array<[number, number]> = [
      [SURFACE_TRAIL, 0],
      [SURFACE_GRASS, 1],
      [SURFACE_MUD, 2],
      [SURFACE_ROCK, 3],
    ];
    for (const [code, hot] of cases) {
      const w = surfaceWeights(code);
      expect(w.reduce((a, b) => a + b, 0)).toBe(1);
      expect(w[hot]).toBe(1);
    }
  });

  it('falls back to trail for unknown codes (never all-zero)', () => {
    for (const bad of [-1, 4, 99, NaN]) {
      const w = surfaceWeights(bad);
      expect(w[0]).toBe(1);
      expect(w.reduce((a, b) => a + b, 0)).toBe(1);
    }
  });
});

describe('wind and master cutoff', () => {
  it('windGain stays in [0,1] over extreme inputs', () => {
    expect(windGain(0, 0)).toBe(0);
    expect(windGain(1, 1)).toBe(1);
    expect(windGain(-1, -1)).toBe(0);
    expect(windGain(2, 2)).toBe(1);
  });

  it('windGain blends wind level and speed', () => {
    expect(windGain(1, 0)).toBeCloseTo(0.75, 9);
    expect(windGain(0, 1)).toBeCloseTo(0.35, 9);
  });

  it('master cutoff is monotonic increasing with speed', () => {
    let prev = 0;
    for (let i = 0; i <= 100; i++) {
      const f = masterCutoff(i / 100);
      expect(f).toBeGreaterThan(prev);
      prev = f;
    }
  });

  it('closed (muffled) at rest, fully open (>=16 kHz) at top speed', () => {
    expect(masterCutoff(0)).toBeCloseTo(1400, 6);
    expect(masterCutoff(1)).toBeCloseTo(18000, 1);
  });
});

describe('volumeCurve sanity (used by mixer)', () => {
  it('maps 1 to unity gain', () => {
    expect(volumeCurve(1)).toBe(1);
  });
});
