/**
 * Real mixer: one fader per AudioChannel, presets, headroom accounting.
 *
 * Signal flow (built once in the bus):
 *   rig -> channel gain -> master gain -> master lowpass -> limiter -> out
 *
 * Fader position v maps to gain v^2 (perceptual, see curves.volumeCurve).
 */

import type { AudioMixerState, AudioChannel } from '@contracts/audio';
import { RIG_PEAKS } from './registry';
import { volumeCurve } from './curves';

export const DEFAULT_VOLUMES: Readonly<Record<AudioChannel, number>> = {
  engine: 0.55,
  tyres: 0.4,
  ambience: 0.6,
  music: 0.45,
  wind: 0.35,
  master: 0.85,
};

/** Source channels in fader order (master handled separately). */
export const SOURCE_CHANNELS: readonly AudioChannel[] = [
  'engine',
  'tyres',
  'ambience',
  'music',
  'wind',
] as const;

export class Mixer {
  /** Live channel gain nodes, owned by the bus graph. */
  readonly gains: Partial<Record<AudioChannel, GainNode>> = {};

  private volumes: Record<AudioChannel, number> = { ...DEFAULT_VOLUMES };
  private preset: AudioMixerState['preset'] = 'default';

  attach(ch: AudioChannel, gain: GainNode): void {
    this.gains[ch] = gain;
    this.applyVolume(ch);
  }

  get currentPreset(): AudioMixerState['preset'] {
    return this.preset;
  }

  getVolume(ch: AudioChannel): number {
    return this.volumes[ch];
  }

  setVolume(ch: AudioChannel, v: number): void {
    const clamped = v < 0 ? 0 : v > 1 ? 1 : v;
    this.volumes[ch] = clamped;
    this.applyVolume(ch);
  }

  applyPreset(p: AudioMixerState['preset']): void {
    this.preset = p;
    if (p === 'default') {
      this.volumes = { ...DEFAULT_VOLUMES };
    } else {
      // 'silence': every source channel to zero; master untouched so the
      // graph stays warm and a later preset/volume change is instant.
      for (const ch of SOURCE_CHANNELS) this.volumes[ch] = 0;
    }
    for (const ch of Object.keys(this.volumes) as AudioChannel[]) {
      this.applyVolume(ch);
    }
  }

  private applyVolume(ch: AudioChannel): void {
    const g = this.gains[ch];
    if (!g) return;
    const target = volumeCurve(this.volumes[ch]);
    const t = g.context.currentTime;
    // Parameter automation only — never node creation.
    g.gain.setTargetAtTime(target, t, 0.05);
  }

  /**
   * Static worst-case peak at the master output for a given set of rig
   * peaks: sum over channels of peak * volCurve(vol). The limiter downstream
   * is a safety net; this number is the design guarantee.
   */
  peakEstimate(peaks: Readonly<Record<AudioChannel, number>> = RIG_PEAKS): number {
    let sum = 0;
    for (const ch of SOURCE_CHANNELS) {
      sum += (peaks[ch] ?? 0) * volumeCurve(this.volumes[ch]);
    }
    return sum * volumeCurve(this.volumes.master);
  }
}
