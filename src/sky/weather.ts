/**
 * Weather state machine — pure logic, no three.js imports.
 *
 * Guarantees:
 *  - A change NEVER snaps. Every request starts a linear-in-time crossfade of
 *    the full WeatherParams vector over WEATHER_FADE_MIN_S..WEATHER_FADE_MAX_S.
 *  - Retargeting mid-fade freezes the current blended vector as the new origin,
 *    so parameters stay continuous even under rapid UI scrubbing.
 *  - Per-parameter motion during a fade is monotonic (linear blend of two
 *    endpoints), verified by unit test.
 */

import { WEATHER_FADE_MAX_S, WEATHER_FADE_MIN_S } from '@contracts/constants';
import type { WeatherState } from '@contracts/sky';
import { WEATHER_PRESETS, type WeatherParams } from './palette';

export const WEATHER_STATES = ['clear', 'mist', 'drizzle', 'rain', 'afterRain'] as const;

/** Deterministic RNG so fades are reproducible for tests/screenshots. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpParams(a: WeatherParams, b: WeatherParams, t: number): WeatherParams {
  return {
    fogMul: a.fogMul + (b.fogMul - a.fogMul) * t,
    cloudCover: a.cloudCover + (b.cloudCover - a.cloudCover) * t,
    cloudDark: a.cloudDark + (b.cloudDark - a.cloudDark) * t,
    rain: a.rain + (b.rain - a.rain) * t,
    mist: a.mist + (b.mist - a.mist) * t,
    windSpeed: a.windSpeed + (b.windSpeed - a.windSpeed) * t,
  };
}

const clone = (p: WeatherParams): WeatherParams => ({ ...p });

export class WeatherMachine {
  private origin: WeatherParams;
  private target: WeatherParams;
  private targetState: WeatherState;
  private settledState: WeatherState;
  private fadeDur: number;
  private fadeT = 1; // 1 = settled
  private rng: () => number;
  private pinnedDuration: number | null = null;

  /**
   * @param onFadeComplete called once per completed fade with the settled state
   */
  constructor(
    seed = 0x5eed,
    private readonly onFadeStart?: (to: WeatherState) => void,
    private readonly onFadeComplete?: (to: WeatherState) => void,
  ) {
    this.rng = mulberry32(seed);
    this.origin = clone(WEATHER_PRESETS.clear!);
    this.target = clone(WEATHER_PRESETS.clear!);
    this.targetState = 'clear';
    this.settledState = 'clear';
    this.fadeDur = WEATHER_FADE_MIN_S;
  }

  /** The state the atmosphere is currently heading toward (or at). */
  get weather(): WeatherState {
    return this.targetState;
  }

  /** The last fully-settled state. */
  get settled(): WeatherState {
    return this.settledState;
  }

  /** 0..1 progress of the active crossfade (1 when settled). */
  get blend(): number {
    return Math.min(this.fadeT, 1);
  }

  get fading(): boolean {
    return this.fadeT < 1;
  }

  /** Request a weather change. Same target while fading is ignored; same target after settling re-fades from current values (harmless no-op visually). */
  request(w: WeatherState): void {
    if (w === this.targetState && !this.fading) return;
    // Freeze the current blended vector as the origin → continuous under retarget.
    this.origin = this.sample();
    this.target = clone(WEATHER_PRESETS[w]!);
    this.targetState = w;
    this.fadeT = 0;
    this.fadeDur =
      this.pinnedDuration ??
      WEATHER_FADE_MIN_S + this.rng() * (WEATHER_FADE_MAX_S - WEATHER_FADE_MIN_S);
    if (this.pinnedDuration !== null) {
      // Clamp pinned durations to contract bounds, then consume the pin.
      this.fadeDur = Math.min(WEATHER_FADE_MAX_S, Math.max(WEATHER_FADE_MIN_S, this.fadeDur));
      this.pinnedDuration = null;
    }
    this.onFadeStart?.(w);
  }

  /** Test-only: pin the NEXT fade's duration in seconds (clamped to contract bounds). */
  setNextFadeDuration(seconds: number): void {
    this.pinnedDuration = seconds;
  }

  /** Advance the fade. Returns blended params. Monotonic in time per parameter. */
  update(dt: number): WeatherParams {
    if (this.fadeT < 1) {
      this.fadeT += dt / this.fadeDur;
      if (this.fadeT >= 1) {
        this.fadeT = 1;
        this.settledState = this.targetState;
        this.onFadeComplete?.(this.targetState);
      }
    }
    return this.sample();
  }

  /** Current blended params without advancing time. */
  sample(): WeatherParams {
    if (this.fadeT >= 1) return clone(this.target);
    // Linear in time → monotone between endpoints.
    return lerpParams(this.origin, this.target, Math.min(this.fadeT, 1));
  }
}
