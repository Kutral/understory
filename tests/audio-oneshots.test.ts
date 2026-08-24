/** One-shot scheduler: randomness bounds, bias behaviour, determinism, curve-safety invariant. */
import { describe, expect, it } from 'vitest';
import { OneShotScheduler, type ShotSpec } from '@/audio/scheduler';
import { bedParams } from '@/audio/ambience';
import { LIGHT_STATES, WEATHER_STATES } from '@/audio/ambience';
import type { LightState, WeatherState } from '@contracts/sky';

function makeSpecs(): Record<string, ShotSpec> {
  return {
    bird: { minGapS: 7, maxGapS: 26, durationS: 1.4, bias: 1 },
    crow: { minGapS: 24, maxGapS: 90, durationS: 1.3, bias: 1 },
    drip: { minGapS: 2.5, maxGapS: 9, durationS: 0.22, bias: 1 },
    thunder: { minGapS: 70, maxGapS: 240, durationS: 5.5, bias: 1 },
  };
}

/** Run the scheduler until each type has fired `n` times; collect gaps. */
function collectGaps(
  specs: Record<string, ShotSpec>,
  nPerType: number,
): Record<string, number[]> {
  let clock = 0;
  const gaps: Record<string, number[]> = {};
  const lastFire: Record<string, number> = {};
  // Deterministic rng (mulberry32-equivalent via LCG is fine here).
  let s = 12345;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const sched = new OneShotScheduler(structuredClone(specs), rng, () => clock);
  const keys = Object.keys(specs);
  const done = (): boolean =>
    keys.every((k) => (gaps[k]?.length ?? 0) >= nPerType);
  let guard = 20_000_000;
  while (!done() && guard-- > 0) {
    clock += 0.25;
    for (const key of sched.tick()) {
      if (lastFire[key] !== undefined) {
        (gaps[key] ??= []).push(clock - lastFire[key]);
      }
      lastFire[key] = clock;
    }
  }
  expect(guard).toBeGreaterThan(0); // must actually terminate
  return gaps;
}

describe('scheduler randomness bounds', () => {
  const specs = makeSpecs();
  const gaps = collectGaps(specs, 40);

  for (const key of Object.keys(specs)) {
    it(`${key}: every gap lies within [minGap/bias, maxGap/bias]`, () => {
      const g = gaps[key]!;
      expect(g.length).toBeGreaterThanOrEqual(30);
      const spec = specs[key]!;
      // Clock advances in 0.25 s steps, so an elapsed gap can overshoot the
      // drawn bound by up to one step.
      const tol = 0.25 + 1e-6;
      for (const x of g) {
        expect(x).toBeGreaterThanOrEqual(spec.minGapS - tol);
        expect(x).toBeLessThan(spec.maxGapS + tol);
      }
    });

    it(`${key}: gaps are not constant (randomness is real)`, () => {
      const g = gaps[key]!;
      const uniq = new Set(g.map((x) => Math.round(x * 100)));
      expect(uniq.size).toBeGreaterThan(10);
    });
  }

  it('min gap always clears the automation curve (>= duration*1.2)', () => {
    for (const spec of Object.values(makeSpecs())) {
      expect(spec.minGapS).toBeGreaterThanOrEqual(spec.durationS * 1.2);
    }
  });
});

describe('bias stretches gaps', () => {
  it('a small bias makes mean gap much larger', () => {
    const base = collectGaps(makeSpecs(), 20)['bird']!;
    const biased = collectGaps(
      { bird: { minGapS: 7, maxGapS: 26, durationS: 1.4, bias: 0.08 } },
      8,
    )['bird']!;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(biased)).toBeGreaterThan(mean(base) * 3);
  });

  it('setBias clamps and re-arms without firing immediately twice', () => {
    const clock = 0;
    const sched = new OneShotScheduler(makeSpecs(), Math.random, () => clock);
    sched.setBias('drip', 5);
    sched.setBias('drip', -2);
    // No throw; clamped internally. tick at same instant fires at most once.
    const dueNow = sched.tick();
    expect(dueNow.filter((k) => k === 'drip').length).toBeLessThanOrEqual(1);
  });
});

describe('determinism', () => {
  it('same seed => identical first 50 fire sequences', () => {
    function run(seed: number): string[] {
      let s = seed;
      const rng = () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      };
      let clock = 0;
      const fired: string[] = [];
      const sched = new OneShotScheduler(makeSpecs(), rng, () => clock);
      while (fired.length < 50) {
        clock += 0.5;
        fired.push(...sched.tick());
      }
      return fired;
    }
    expect(run(42)).toEqual(run(42));
    expect(run(42)).not.toEqual(run(43)); // different seeds diverge
  });
});

describe('bed parameter table (LightState x WeatherState)', () => {
  it('covers all 30 combos with finite values in range', () => {
    for (const l of LIGHT_STATES as readonly LightState[]) {
      for (const w of WEATHER_STATES as readonly WeatherState[]) {
        const p = bedParams(l, w);
        for (const v of [
          p.airGain,
          p.airFreq,
          p.rainGain,
          p.rainTone,
          p.birdBias,
          p.crowBias,
          p.dripBias,
          p.thunderBias,
        ]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(p.airGain).toBeGreaterThan(0);
        expect(p.airGain).toBeLessThanOrEqual(1.2);
        expect(p.rainGain).toBeGreaterThanOrEqual(0);
        for (const b of [p.birdBias, p.crowBias, p.dripBias, p.thunderBias]) {
          expect(b).toBeGreaterThan(0);
          expect(b).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('rain wets the rain bed; clear keeps it dry', () => {
    expect(bedParams('morning', 'rain').rainGain).toBeGreaterThan(
      bedParams('morning', 'clear').rainGain,
    );
    expect(bedParams('morning', 'clear').rainGain).toBe(0);
  });

  it('night nearly silences birdsong but after-rain drips stay loud', () => {
    expect(bedParams('night', 'clear').birdBias).toBeLessThan(0.15);
    expect(bedParams('morning', 'afterRain').dripBias).toBeCloseTo(1, 6);
  });

  it('thunder only really appears under rain', () => {
    expect(bedParams('dawn', 'rain').thunderBias).toBeGreaterThan(0.3);
    expect(bedParams('dawn', 'clear').thunderBias).toBeLessThan(0.1);
  });
});
