/**
 * Authored atmosphere palette — pure math, no three.js imports.
 *
 * Everything is a continuous function of sun elevation and the blended weather
 * parameters. There are deliberately NO per-band color tables: bands label the
 * state for the HUD/audio, they never drive values, so nothing can pop at a
 * band boundary.
 *
 * Anchored to docs/ART-DIRECTION.md:
 *   --lamp  #F0B24B  the sun's warmth (golden hour, dawn rim)
 *   --mist  #7C9AA6  rain/dusk/water coolness (fog, overcast, blue hour)
 *   --birch #E6DCC6  bright paper light (mist haze highlights)
 *   --moss  #2F4234 / --spruce #101A16  ground of the world, night floor
 */

import {
  bell,
  clamp01,
  nightFactor,
  smoothstep,
  sunLightFactor,
  twilightFactor,
} from './time';

/** RGB tuple, 0..1 linear-ish (authored in sRGB numbers; renderer treats as such). */
export type RGB = readonly [number, number, number];

export const LAMP: RGB = [0xf0 / 255, 0xb2 / 255, 0x4b / 255];
export const MIST: RGB = [0x7c / 255, 0x9a / 255, 0xa6 / 255];
export const BIRCH: RGB = [0xe6 / 255, 0xdc / 255, 0xc6 / 255];
export const MOSS: RGB = [0x2f / 255, 0x42 / 255, 0x34 / 255];
export const SPRUCE: RGB = [0x10 / 255, 0x1a / 255, 0x16 / 255];

export function mix3(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function scale3(a: RGB, s: number): RGB {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Weather-shaped atmosphere parameters (already crossfaded by the machine). */
export interface WeatherParams {
  /** Multiplier on the base fog density (clear = 1). */
  fogMul: number;
  /** 0..1 cloud sheet coverage. */
  cloudCover: number;
  /** 0..1 how dark/rain-heavy clouds read. */
  cloudDark: number;
  /** 0..1 rain particle strength. */
  rain: number;
  /** 0..1 low-lying mist veil strength. */
  mist: number;
  /** 0..~1 wind speed factor driving cloud drift. */
  windSpeed: number;
}

export const WEATHER_PRESETS: Readonly<Record<string, WeatherParams>> = {
  clear: { fogMul: 1.0, cloudCover: 0.24, cloudDark: 0.06, rain: 0.0, mist: 0.12, windSpeed: 0.35 },
  mist: { fogMul: 3.2, cloudCover: 0.46, cloudDark: 0.1, rain: 0.0, mist: 1.0, windSpeed: 0.14 },
  drizzle: { fogMul: 2.0, cloudCover: 0.72, cloudDark: 0.38, rain: 0.45, mist: 0.55, windSpeed: 0.7 },
  rain: { fogMul: 2.5, cloudCover: 0.92, cloudDark: 0.62, rain: 1.0, mist: 0.65, windSpeed: 1.0 },
  afterRain: { fogMul: 1.7, cloudCover: 0.52, cloudDark: 0.18, rain: 0.0, mist: 0.78, windSpeed: 0.45 },
};

/** Full per-frame atmosphere state handed to the TSL visuals. */
export interface AtmosphereState {
  zenith: RGB;
  horizon: RGB;
  horizonGlow: RGB;
  glowStrength: number;
  /** Direct-light color (sun when up, moon-tinted at night). */
  keyColor: RGB;
  keyIntensity: number;
  ambientColor: RGB;
  ambientIntensity: number;
  fogColor: RGB;
  fogDensity: number;
  starOpacity: number;
  moonDiscOpacity: number;
  cloudColor: RGB;
  /** Blended weather scalars (pass-through for visuals). */
  cloudCover: number;
  cloudDark: number;
  rain: number;
  mist: number;
  windSpeed: number;
  /** Sun direction, unit length, y-up (preallocated by caller). */
  sunDir: RGB;
  /** Moon direction, unit length. */
  moonDir: RGB;
}

/**
 * Base exponential height-fog density at y=0 under CLEAR sky, per metre.
 * Tuned so at 120 m the far treeline still reads but softens (~35% extinction
 * with falloff below).
 */
export const BASE_FOG_DENSITY = 0.0042;

/** Fog vertical falloff (per metre above ground). Half-life ≈ 165 m. */
export const FOG_FALLOFF = 0.0042;

const NIGHT_ZENITH = scale3(SPRUCE, 0.85);
const BLUE_ZENITH = mix3(SPRUCE, MIST, 0.55);
const DAY_ZENITH: RGB = [0.36, 0.49, 0.55]; // desaturated teal-blue, sits beside --mist

const NIGHT_HORIZON = scale3(mix3(SPRUCE, MIST, 0.14), 0.85);
const HAZE_HORIZON = mix3(MIST, BIRCH, 0.35);

/**
 * Compute the full atmosphere state. Pure: same inputs → same outputs.
 *
 * @param elevDeg   sun elevation, degrees
 * @param moonElevDeg moon elevation, degrees
 * @param w         blended weather parameters
 */
export function computeAtmosphere(elevDeg: number, moonElevDeg: number, w: WeatherParams): AtmosphereState {
  const dayF = sunLightFactor(elevDeg); // direct sun presence
  const twiF = twilightFactor(elevDeg); // twilight presence
  const nightF = nightFactor(elevDeg); // deep night presence
  const golden = bell(elevDeg, 3.5, 8.5); // warmth bell around sunrise/sunset
  const overcast = clamp01(Math.max(w.cloudCover - 0.35, 0) / 0.65 * 0.85 + w.cloudDark * 0.4);

  // --- Sky gradient -------------------------------------------------------
  // Zenith: night spruce-black → cold blue-hour teal → day teal-blue.
  let zenith = mix3(NIGHT_ZENITH, BLUE_ZENITH, smoothstep(-14, -2, elevDeg));
  zenith = mix3(zenith, DAY_ZENITH, smoothstep(0, 16, elevDeg));
  // Overcast pulls everything toward mist grey.
  zenith = mix3(zenith, scale3(MIST, 0.75), overcast * dayF);

  // Horizon: hazy birch-mist by day, lamp-warmed through golden hour.
  let horizon = mix3(NIGHT_HORIZON, HAZE_HORIZON, smoothstep(-10, 4, elevDeg));
  horizon = mix3(horizon, LAMP, golden * 0.75 * (1 - overcast));

  // Glow ring color around the sun near the horizon (--lamp), fading with altitude.
  const glowStrength =
    golden * 1.15 * (1 - overcast * 0.8) + twilightFactor(elevDeg) * 0.25;
  const horizonGlow = mix3(LAMP, MIST, overcast * 0.7);

  // --- Key (directional) light --------------------------------------------
  const warmSun = mix3([1.0, 0.86, 0.66], LAMP, golden * 0.8);
  const noonSun: RGB = [1.0, 0.97, 0.9];
  const sunKey = mix3(warmSun, noonSun, smoothstep(8, 26, elevDeg));
  const moonKey: RGB = [0.62, 0.71, 0.82];

  const sunIntensity = 3.1 * dayF * (1 - overcast * 0.78);
  const moonIntensity = 0.32 * smoothstep(0, 18, moonElevDeg) * nightF;
  // The dominating luminary sets tint + intensity; both ramps are continuous,
  // and at the crossover both intensities are equal, so max() cannot step.
  const keyColor = sunIntensity >= moonIntensity ? sunKey : moonKey;
  const keyIntensity = Math.max(sunIntensity, moonIntensity);

  // --- Ambient -------------------------------------------------------------
  const ambDay = mix3(MIST, BIRCH, 0.3);
  let ambientColor = mix3(scale3(MOSS, 1.6), ambDay, smoothstep(-8, 8, elevDeg));
  ambientColor = mix3(ambientColor, scale3(MOON_KEY_AMBIENT, 1), nightF * smoothstep(0, 14, moonElevDeg) * 0.6 + nightF * 0.25);
  ambientColor = mix3(ambientColor, scale3(MIST, 0.9), overcast * dayF);
  const ambientIntensity = 0.28 + 0.5 * twiF + 0.34 * dayF * (1 - overcast * 0.45);

  // --- Fog -----------------------------------------------------------------
  // Color follows the horizon (so silhouettes melt into it), cools toward --mist
  // with rain/mist weather and at dusk.
  let fogColor = mix3(horizon, MIST, 0.35 + 0.4 * overcast);
  fogColor = mix3(fogColor, scale3(MIST, 0.55), nightF * 0.55);
  const fogDensity =
    BASE_FOG_DENSITY * w.fogMul * (1 + 0.6 * (1 - dayF)) * (1 + 0.5 * w.mist);

  // --- Stars & moon disc ---------------------------------------------------
  const starOpacity = nightF * (1 - w.cloudCover * 0.85) * (1 - w.mist * 0.5);
  const moonDiscOpacity = nightF * smoothstep(0, 6, moonElevDeg) * (1 - w.cloudCover * 0.7);

  // --- Clouds --------------------------------------------------------------
  const litCloud = mix3(
    mix3(scale3(BIRCH, 0.95), LAMP, golden * 0.55),
    scale3(MIST, 0.9),
    overcast,
  );
  const cloudColor = mix3(litCloud, scale3(mix3(MOSS, SPRUCE, 0.4), 1.1), w.cloudDark * (0.35 + 0.65 * (1 - dayF)));

  return {
    zenith,
    horizon,
    horizonGlow,
    glowStrength: Math.max(glowStrength, 0),
    keyColor,
    keyIntensity,
    ambientColor,
    ambientIntensity,
    fogColor,
    fogDensity,
    starOpacity,
    moonDiscOpacity,
    cloudColor,
    cloudCover: w.cloudCover,
    cloudDark: w.cloudDark,
    rain: w.rain,
    mist: w.mist,
    windSpeed: w.windSpeed,
    sunDir: [0, 0, 0],
    moonDir: [0, 0, 0],
  };
}

const MOON_KEY_AMBIENT: RGB = [0.5, 0.58, 0.7];

/** Azimuthal placement: sun azimuth sweeps 90°→270° across daylight hours. */
export function sunAzimuthRad(t: number): number {
  return ((t - 6) / 24) * Math.PI * 2 + Math.PI * 0.5;
}
