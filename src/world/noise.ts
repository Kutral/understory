/**
 * Seeded, deterministic noise stack for the Understory heightfield.
 *
 * Pure integer/float math only — no Math.random, no Date, no platform
 * variance beyond IEEE-754 basics — so the same seed yields byte-identical
 * outputs in workers, on the main thread, and across runs.
 */

/** splitmix32: fast seeded PRNG returning floats in [0,1). */
export function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = (t ^ (t >>> 15)) >>> 0;
    return t / 4294967296;
  };
}

/** Hash two integers plus a seed into [0,1). Deterministic, no state. */
export function hash2(x: number, z: number, seed: number): number {
  let h = (seed | 0) ^ 0x2545f491;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (z | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const F2 = 0.3660254037844386; // (sqrt(3)-1)/2
const G2 = 0.21132486540518713; // (3-sqrt(3))/6

const GRAD_X = [1, -1, 1, -1, 1, -1, 0, 0];
const GRAD_Z = [1, 1, -1, -1, 0, 0, 1, -1];

/** Seeded permutation table (doubled) for simplex lookups. */
export function makePermutation(seed: number): Uint8Array {
  const rand = splitmix32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const a = p[i] as number;
    const b = p[j] as number;
    p[i] = b;
    p[j] = a;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255] as number;
  return perm;
}

/** Classic 2D open simplex in [-1, 1]. ~O(1), allocation-free. */
export function simplex2(perm: Uint8Array, x: number, y: number): number {
  const s = (x + y) * F2;
  const skewX = Math.floor(x + s);
  const skewY = Math.floor(y + s);
  const t = (skewX + skewY) * G2;
  const x0 = x - (skewX - t);
  const y0 = y - (skewY - t);

  const corner1 = x0 > y0 ? 1 : 0;
  const corner2 = x0 > y0 ? 0 : 1;

  const x1 = x0 - corner1 + G2;
  const y1 = y0 - corner1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;

  const ii = skewX & 255;
  const jj = skewY & 255;

  let n = 0;
  const pjj = perm[jj] as number;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = (perm[ii + pjj] as number) & 7;
    t0 *= t0;
    n += t0 * t0 * (GRAD_X[g]! * x0 + GRAD_Z[g]! * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = (perm[ii + corner1 + (perm[jj + corner2] as number)] as number) & 7;
    t1 *= t1;
    n += t1 * t1 * (GRAD_X[g]! * x1 + GRAD_Z[g]! * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = (perm[ii + 1 + (perm[jj + 1] as number)] as number) & 7;
    t2 *= t2;
    n += t2 * t2 * (GRAD_X[g]! * x2 + GRAD_Z[g]! * y2);
  }
  // Scale to [-1, 1]; hard clamp guards the rare corner-case overshoot.
  const v = 70.14805770653952 * n;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export interface NoiseStack {
  /** Fractal Brownian motion over simplex2, output ~[-1, 1]. */
  fbm(x: number, y: number, octaves: number, lacunarity: number, gain: number): number;
  /** Ridged multifractal in [0, 1]; produces sharp ridgelines from valleys. */
  ridged(x: number, y: number, octaves: number, lacunarity: number, gain: number): number;
}

export interface NoiseField {
  readonly perm: Uint8Array;
  fbm(x: number, y: number, octaves: number, freq: number, gain?: number): number;
  ridged(x: number, y: number, octaves: number, freq: number, gain?: number): number;
}

/** One independent noise field with its own permutation table. */
export function makeNoiseField(seed: number): NoiseField {
  const perm = makePermutation(seed);
  return {
    perm,
    fbm(x, y, octaves, freq, gain = 0.5) {
      let amp = 1;
      let sum = 0;
      let norm = 0;
      let f = freq;
      for (let o = 0; o < octaves; o++) {
        sum += amp * simplex2(perm, x * f, y * f);
        norm += amp;
        amp *= gain;
        f *= 2;
      }
      return sum / norm;
    },
    ridged(x, y, octaves, freq, gain = 0.5) {
      let amp = 1;
      let sum = 0;
      let norm = 0;
      let f = freq;
      for (let o = 0; o < octaves; o++) {
        const n = 1 - Math.abs(simplex2(perm, x * f, y * f));
        sum += amp * n * n;
        norm += amp;
        amp *= gain;
        f *= 2;
      }
      return sum / norm;
    },
  };
}
