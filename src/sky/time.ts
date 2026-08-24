/**
 * Pure time-of-day math. No three.js imports — unit-testable in node.
 *
 * Solar model: a single continuous sinusoid for sun elevation over the 24h
 * dial. Sunrise/sunset at 06:00/18:00, solar noon elevation MAX_SUN_ELEV_DEG,
 * midnight at -MAX_SUN_ELEV_DEG. The moon runs the same path offset by 12h.
 * Because every derived quantity (bands, intensities, colors) is a function of
 * the continuous elevation — never of a band table — there is nothing that can
 * step at band boundaries.
 */

import { DAY_CYCLE_REAL_SECONDS } from '@contracts/constants';
import type { LightState } from '@contracts/sky';

/** Sun elevation at solar noon, degrees. Chosen so `morning` reads as high day without looking tropical. */
export const MAX_SUN_ELEV_DEG = 62;

/** Moon peak elevation, degrees. Lower than the sun: the moon grazes the canopy. */
export const MAX_MOON_ELEV_DEG = 48;

/** Hours of drift-clock advance per real second in drift mode (1440/2400 = 0.6 h/s). */
export const DRIFT_HOURS_PER_SECOND = 24 / DAY_CYCLE_REAL_SECONDS;

/** Default opening hour — the art direction opens the game at dawn (~1° sun). */
export const START_TIME_H = 6.05;

/** Wrap hours into [0, 24). */
export function wrap24(hours: number): number {
  return ((hours % 24) + 24) % 24;
}

/**
 * Sun elevation in degrees for local solar time t (0..24).
 * Continuous and periodic; d/dt is positive on (0,12), negative on (12,24).
 */
export function sunElevationDeg(t: number): number {
  const h = wrap24(t);
  return MAX_SUN_ELEV_DEG * Math.sin(((h - 6) / 12) * Math.PI);
}

/** Moon elevation in degrees — the same arc shifted half a day later. */
export function moonElevationDeg(t: number): number {
  const h = wrap24(t);
  return MAX_MOON_ELEV_DEG * Math.sin(((h - 18) / 12) * Math.PI);
}

/** True while the sun is climbing (00:00..12:00). */
export function isSunRising(t: number): boolean {
  const h = wrap24(t);
  return Math.cos(((h - 6) / 12) * Math.PI) > 0;
}

/**
 * Band boundaries in degrees of SUN ELEVATION (not clock). Both edges are
 * shared by adjacent bands, so the label can only ever flip where the
 * underlying elevation crosses a fixed threshold — never before it.
 */
export const BAND_BOUNDS_DEG = {
  /** below this: night */
  night: -8,
  /** night..this: blueHour */
  blueHour: -2,
  /** this..goldenLow: dawn (rising) or dusk (falling) */
  goldenLow: 4,
  /** goldenLow..this: goldenHour */
  goldenHigh: 14,
} as const;

/**
 * The six authored bands, keyed off continuous sun elevation plus rise/fall
 * direction for the dawn/dusk split. The direction flag only flips at noon /
 * midnight, deep inside other bands, so dawn→dusk can never flicker at a
 * horizon boundary.
 */
export function bandFor(sunElevDeg: number, rising: boolean): LightState {
  if (sunElevDeg < BAND_BOUNDS_DEG.night) return 'night';
  if (sunElevDeg < BAND_BOUNDS_DEG.blueHour) return 'blueHour';
  if (sunElevDeg < BAND_BOUNDS_DEG.goldenLow) return rising ? 'dawn' : 'dusk';
  if (sunElevDeg < BAND_BOUNDS_DEG.goldenHigh) return 'goldenHour';
  return 'morning';
}

/** Convenience: band directly from clock time. */
export function lightStateAt(t: number): LightState {
  return bandFor(sunElevationDeg(t), isSunRising(t));
}

// ---------------------------------------------------------------------------
// Continuous intensity curves. smoothstep ramps keyed on elevation; no per-band
// tables anywhere downstream.
// ---------------------------------------------------------------------------

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Bell curve peaking at `peak`, zero beyond ±width. Used for golden-hour warmth. */
export function bell(x: number, peak: number, width: number): number {
  const d = (x - peak) / width;
  return Math.exp(-d * d);
}

/** 0 below -2°, 1 above 10° — drives direct light intensity. */
export function sunLightFactor(elevDeg: number): number {
  return smoothstep(-2, 10, elevDeg);
}

/** Twilight presence: ramps through civil/nautical twilight. */
export function twilightFactor(elevDeg: number): number {
  return smoothstep(-14, 2, elevDeg);
}

/** 1 in deep night, fading out across late twilight; drives stars/moon. */
export function nightFactor(elevDeg: number): number {
  return 1 - smoothstep(-12, -2, elevDeg);
}
