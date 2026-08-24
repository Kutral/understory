/**
 * Procedural noise buffers. The game ships zero audio assets: every sample
 * is synthesised into an AudioBuffer once at init (payload = 0 bytes).
 */

import { mulberry32, type Rng } from './rng';

export type NoiseKind = 'white' | 'pink' | 'brown';

/**
 * Fill `data` in place with the requested noise flavour, peak-normalised to
 * `peak` so headroom accounting upstream stays exact.
 */
export function fillNoise(
  data: Float32Array,
  kind: NoiseKind,
  peak: number,
  seed: number,
): void {
  const rng: Rng = mulberry32(seed);
  const n = data.length;

  if (kind === 'white') {
    for (let i = 0; i < n; i++) data[i] = rng() * 2 - 1;
  } else if (kind === 'pink') {
    // Paul Kellet's economical pink filter.
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  } else {
    // Brownian: integrated white, leaky to avoid DC runaway.
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc = 0.998 * acc + (rng() * 2 - 1) * 0.06;
      data[i] = acc;
    }
  }

  // Peak normalise.
  let maxAbs = 0;
  for (let i = 0; i < n; i++) {
    const a = Math.abs(data[i]!);
    if (a > maxAbs) maxAbs = a;
  }
  const scale = maxAbs > 0 ? peak / maxAbs : 0;
  if (scale !== 1) {
    for (let i = 0; i < n; i++) data[i] = data[i]! * scale;
  }
}

export function makeNoiseBuffer(
  ctx: BaseAudioContext,
  seconds: number,
  kind: NoiseKind,
  peak: number,
  seed: number,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, length, ctx.sampleRate);
  fillNoise(buf.getChannelData(0), kind, peak, seed);
  return buf;
}
