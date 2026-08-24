/**
 * One-shot scheduler: pure timing logic, no WebAudio. Each shot type has a
 * gap range [minGapS, maxGapS]; `tick()` returns the types due at the current
 * clock reading. Randomness comes from an injected Rng so bounds are exactly
 * testable, and a per-type bias (0..1] stretches gaps for context
 * (e.g. birdsong nearly silent at night).
 */

import { rngRange, type Rng } from './rng';

export interface ShotSpec {
  /** Minimum seconds between shots of this type (>= duration: curves never overlap). */
  readonly minGapS: number;
  readonly maxGapS: number;
  /** Automation curve length in seconds — informs the min-gap invariant. */
  readonly durationS: number;
  /** Probability weight 0..1; effective gap divides by this. */
  bias: number;
}

export class OneShotScheduler {
  private nextAt = new Map<string, number>();

  constructor(
    readonly specs: Record<string, ShotSpec>,
    private rng: Rng,
    private nowS: () => number,
  ) {
    for (const key of Object.keys(specs)) {
      const s = specs[key]!;
      // Stagger initial shots so the forest never "fires" all at once.
      this.nextAt.set(key, nowS() + rngRange(rng, s.minGapS, s.maxGapS));
    }
  }

  setBias(key: string, bias: number): void {
    const spec = this.specs[key];
    if (!spec) return;
    spec.bias = bias < 0 ? 0 : bias > 1 ? 1 : bias;
    // Re-arm with the new bias so changes take effect promptly.
    this.nextAt.set(key, this.nowS() + this.drawGap(key));
  }

  private drawGap(key: string): number {
    const spec = this.specs[key]!;
    const bias = spec.bias <= 0 ? Number.POSITIVE_INFINITY : Math.max(spec.bias, 1 / 240);
    const base = rngRange(this.rng, spec.minGapS, spec.maxGapS);
    return base / bias;
  }

  /** Advance; returns shot types whose wait has elapsed (each fires at most once). */
  tick(): string[] {
    const now = this.nowS();
    const due: string[] = [];
    for (const key of Object.keys(this.specs)) {
      const at = this.nextAt.get(key);
      if (at !== undefined && now >= at) {
        due.push(key);
        this.nextAt.set(key, now + this.drawGap(key));
      }
    }
    return due;
  }
}
