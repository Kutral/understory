/**
 * Engine rig: three crossfaded looped layers driven by rpm01 with subtle
 * inter-layer detune. Oscillator-based, sine/triangle only, all energy below
 * ~220 Hz plus a whisper of filtered noise — a warm hum, never a snarl.
 *
 * All nodes are built once here; update() touches parameters only.
 */

import type { EngineRig } from './types';
import { NodeRegistry } from './registry';
import {
  ENGINE_LAYERS,
  detuneCents,
  engineLayerFreq,
  engineLayerWeights,
  clamp01,
  lerp,
} from './curves';

/** Per-layer output amplitude; three overlapping layers sum near RIG_PEAKS.engine. */
const LAYER_AMP = 0.085;
const NOISE_AMP_MAX = 0.045;

export function buildEngine(
  ctx: BaseAudioContext,
  reg: NodeRegistry,
  pink: AudioBuffer,
  out: AudioNode,
): EngineRig {
  // Shared gentle lowpass keeps everything in the hum band even at full rpm.
  const tone = reg.add(ctx.createBiquadFilter());
  tone.type = 'lowpass';
  tone.frequency.value = 420;
  tone.Q.value = 0.4;
  tone.connect(out);

  const oscs: OscillatorNode[] = [];
  const layerGains: GainNode[] = [];
  for (let i = 0; i < ENGINE_LAYERS.length; i++) {
    const spec = ENGINE_LAYERS[i]!;
    const osc = reg.add(ctx.createOscillator());
    osc.type = spec.type;
    osc.frequency.value = engineLayerFreq(0, i);
    const g = reg.add(ctx.createGain());
    g.gain.value = LAYER_AMP;
    osc.connect(g);
    g.connect(tone);
    osc.start();
    oscs.push(osc);
    layerGains.push(g);
  }

  // Breath of filtered noise so the hum has texture without harshness.
  const noise = reg.add(ctx.createBufferSource());
  noise.buffer = pink;
  noise.loop = true;
  const noiseBp = reg.add(ctx.createBiquadFilter());
  noiseBp.type = 'bandpass';
  noiseBp.frequency.value = 140;
  noiseBp.Q.value = 0.7;
  const noiseGain = reg.add(ctx.createGain());
  noiseGain.gain.value = 0;
  noise.connect(noiseBp);
  noiseBp.connect(noiseGain);
  noiseGain.connect(tone);
  noise.start();

  return {
    peak: 0.23,
    update(t: number, rpmRaw: number): void {
      const rpm = clamp01(rpmRaw);
      const weights = engineLayerWeights(rpm);
      for (let i = 0; i < oscs.length; i++) {
        const w = weights[i] ?? 0;
        layerGains[i]!.gain.setTargetAtTime(LAYER_AMP * w, t, 0.08);
        oscs[i]!.frequency.setTargetAtTime(engineLayerFreq(rpm, i), t, 0.06);
        oscs[i]!.detune.setTargetAtTime(detuneCents(rpm, i), t, 0.12);
      }
      noiseBp.frequency.setTargetAtTime(lerp(120, 520, rpm), t, 0.15);
      noiseGain.gain.setTargetAtTime(NOISE_AMP_MAX * (0.25 + 0.75 * rpm), t, 0.15);
      tone.frequency.setTargetAtTime(lerp(300, 560, rpm), t, 0.2);
    },
    dispose(): void {
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      }
      try {
        noise.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
