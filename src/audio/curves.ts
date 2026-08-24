/**
 * Pure response curves and lookup tables for the audio subsystem.
 * No WebAudio types here: everything is plain math so it is unit-testable
 * in a bare node environment and reusable by the rigs.
 */

import {
  SURFACE_TRAIL,
  SURFACE_GRASS,
  SURFACE_MUD,
  SURFACE_ROCK,
} from '@contracts/world';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Perceptual volume mapping: fader position squared (approximates equal
 * loudness on a linear gain pot). Stored raw, applied squared.
 */
export function volumeCurve(v: number): number {
  return clamp01(v) ** 2;
}

// ---------------------------------------------------------------------------
// Engine: three crossfaded layers over rpm01
// ---------------------------------------------------------------------------

export interface EngineLayerSpec {
  /** rpm01 where this layer is loudest. */
  readonly center: number;
  /** Half-width of the raised-cosine window. */
  readonly halfWidth: number;
  /** Base frequency at idle, Hz. */
  readonly f0: number;
  /** Octaves swept across the full rpm range. */
  readonly octaves: number;
  /** Waveform: sine/triangle only — a warm hum, never a snarl. */
  readonly type: 'sine' | 'triangle';
  /** Peak detune magnitude at mid rpm, cents. Subtle by design. */
  readonly cents: number;
}

/** Idle / mid / top layers. Frequencies stay under ~200 Hz: warm hum band. */
export const ENGINE_LAYERS: readonly EngineLayerSpec[] = [
  { center: 0.14, halfWidth: 0.34, f0: 46, octaves: 1.2, type: 'sine', cents: 3 },
  { center: 0.5, halfWidth: 0.36, f0: 62, octaves: 1.5, type: 'triangle', cents: -4.5 },
  { center: 0.86, halfWidth: 0.34, f0: 78, octaves: 1.4, type: 'sine', cents: 6.5 },
] as const;

/**
 * Raised-cosine window per layer, normalised to sum to exactly 1 everywhere.
 * Adjacent windows overlap so the crossfade is seamless and allocation-free.
 */
export function engineLayerWeights(rpmRaw: number): [number, number, number] {
  const x = clamp01(rpmRaw);
  const w = ENGINE_LAYERS.map((l) => {
    const d = Math.abs(x - l.center) / l.halfWidth;
    if (d >= 1) return 0;
    const c = Math.cos(0.5 * Math.PI * d);
    return c * c;
  });
  const sum = w[0]! + w[1]! + w[2]!;
  if (sum <= 0) return [1 / 3, 1 / 3, 1 / 3];
  return [w[0]! / sum, w[1]! / sum, w[2]! / sum];
}

/** Layer fundamental for a given rpm: exponential sweep inside the hum band. */
export function engineLayerFreq(rpmRaw: number, layer: number): number {
  const spec = ENGINE_LAYERS[layer];
  if (!spec) return 60;
  return spec.f0 * 2 ** (clamp01(rpmRaw) * spec.octaves);
}

/**
 * Subtle detune per layer, in cents. Zero at rest and at full rpm (the
 * "locked" feel at both ends), peaking at each layer's centre with the
 * layer's own sign so the layers beat gently against each other mid-range.
 */
export function detuneCents(rpmRaw: number, layer: number): number {
  const spec = ENGINE_LAYERS[layer];
  if (!spec) return 0;
  const x = clamp01(rpmRaw);
  // Gaussian-ish bump centred on the layer's centre, sigma = halfWidth/1.6
  const sigma = spec.halfWidth / 1.6;
  const g = Math.exp(-((x - spec.center) ** 2) / (2 * sigma * sigma));
  // Taper to zero at both extremes so the engine feels locked-in at rest
  // and at full rpm (quartic taper keeps most of the bump mid-range).
  const taper = 1 - Math.abs(2 * x - 1) ** 4;
  return spec.cents * g * taper;
}

// ---------------------------------------------------------------------------
// Tyres: surface crossfade weights
// ---------------------------------------------------------------------------

export const SURFACE_COUNT = 4;

/** One-hot target weights; unknown codes fall back to trail (code 0). */
export function surfaceWeights(surface: number): [number, number, number, number] {
  let code = surface | 0;
  if (
    code !== SURFACE_TRAIL &&
    code !== SURFACE_GRASS &&
    code !== SURFACE_MUD &&
    code !== SURFACE_ROCK
  ) {
    code = SURFACE_TRAIL;
  }
  return [
    code === SURFACE_TRAIL ? 1 : 0,
    code === SURFACE_GRASS ? 1 : 0,
    code === SURFACE_MUD ? 1 : 0,
    code === SURFACE_ROCK ? 1 : 0,
  ];
}

// ---------------------------------------------------------------------------
// Wind + master filter
// ---------------------------------------------------------------------------

/**
 * Master low-pass cutoff, Hz. Closed (warm, muffled) at rest, fully open at
 * top speed. Exponential interpolation sounds right for cutoffs.
 */
export function masterCutoff(speed01Raw: number): number {
  const s = clamp01(speed01Raw);
  const closedHz = 1400;
  const openHz = 18000;
  return closedHz * (openHz / closedHz) ** s;
}

/** Wind bed gain 0..1 from sky wind level plus the car's own slipstream. */
export function windGain(windLevelRaw: number, speed01Raw: number): number {
  const w = clamp01(windLevelRaw) * 0.75 + clamp01(speed01Raw) * 0.35;
  return clamp01(w);
}
