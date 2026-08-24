/**
 * Wind rig: bandpassed noise bed whose level tracks sky wind plus the car's
 * slipstream. Nodes built once; update() automates parameters only.
 */

import type { WindRig } from './types';
import { NodeRegistry } from './registry';
import { windGain, clamp01 } from './curves';

const WIND_AMP = 0.13;

export function buildWind(
  ctx: BaseAudioContext,
  reg: NodeRegistry,
  pink: AudioBuffer,
  out: AudioNode,
): WindRig {
  const src = reg.add(ctx.createBufferSource());
  src.buffer = pink;
  src.loop = true;

  // Two bandpasses in series give a hollow "gust through canopy" tone
  // without any additional sources.
  const bp1 = reg.add(ctx.createBiquadFilter());
  bp1.type = 'bandpass';
  bp1.frequency.value = 480;
  bp1.Q.value = 0.6;
  const bp2 = reg.add(ctx.createBiquadFilter());
  bp2.type = 'bandpass';
  bp2.frequency.value = 900;
  bp2.Q.value = 0.5;

  const gain = reg.add(ctx.createGain());
  gain.gain.value = 0;

  src.connect(bp1);
  bp1.connect(bp2);
  bp2.connect(gain);
  gain.connect(out);
  src.start();

  return {
    peak: 0.13,
    update(t: number, windLevelRaw: number, speedRaw: number): void {
      const target = windGain(windLevelRaw, speed01(speedRaw));
      gain.gain.setTargetAtTime(WIND_AMP * target, t, 0.4);
      // Slight brightening with strength.
      bp2.frequency.setTargetAtTime(700 + 500 * clamp01(windLevelRaw), t, 0.6);
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

function speed01(v: number): number {
  return clamp01(v);
}
