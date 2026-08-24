/**
 * Tyre rig: one looping noise source through four parallel filter chains,
 * crossfaded by surface code (trail/grass/mud/rock) and scaled by speed.
 *
 *   trail — mid bandpass, the "packed earth" baseline
 *   grass — soft lowpass, swishy
 *   mud   — dark lowpass, heavy
 *   rock  — brighter bandpass, gritty
 *
 * Nodes built once; update() automates parameters only.
 */

import type { TyreRig } from './types';
import { NodeRegistry } from './registry';
import { surfaceWeights, clamp01 } from './curves';

interface ChainSpec {
  type: BiquadFilterType;
  freq: number;
  q: number;
}

const CHAINS: readonly ChainSpec[] = [
  { type: 'bandpass', freq: 420, q: 0.8 }, // trail
  { type: 'lowpass', freq: 260, q: 0.5 }, // grass
  { type: 'lowpass', freq: 170, q: 0.6 }, // mud
  { type: 'bandpass', freq: 950, q: 1.4 }, // rock
] as const;

/** Per-chain amplitude when active at full speed; sums stay under RIG_PEAKS.tyres. */
const CHAIN_AMP = 0.16;

export function buildTyres(
  ctx: BaseAudioContext,
  reg: NodeRegistry,
  whiteNoise: AudioBuffer,
  out: AudioNode,
): TyreRig {
  const src = reg.add(ctx.createBufferSource());
  src.buffer = whiteNoise;
  src.loop = true;

  const chains = CHAINS.map((spec) => {
    const f = reg.add(ctx.createBiquadFilter());
    f.type = spec.type;
    f.frequency.value = spec.freq;
    f.Q.value = spec.q;
    const g = reg.add(ctx.createGain());
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(out);
    return g;
  });
  src.start();

  return {
    peak: 0.17,
    update(t: number, surface: number, speedRaw: number): void {
      const w = surfaceWeights(surface);
      const level = clamp01(speedRaw);
      for (let i = 0; i < chains.length; i++) {
        chains[i]!.gain.setTargetAtTime(CHAIN_AMP * (w[i] ?? 0) * level, t, 0.12);
      }
    },
    dispose(): void {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
