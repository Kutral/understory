/** Mixer math: perceptual volume curve, presets, headroom ledger. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_VOLUMES, Mixer } from '@/audio/mixer';
import { RIG_PEAKS } from '@/audio/registry';
import { volumeCurve } from '@/audio/curves';
import type { AudioChannel } from '@contracts/audio';

/** Minimal gain-node double: records the applied (already curved) target. */
function mkGain(initial = 1): { gain: { value: number; setTargetAtTime(v: number): unknown }; context: { currentTime: number } } {
  return {
    gain: {
      value: initial,
      setTargetAtTime(v: number) {
        this.value = v;
        return this;
      },
    },
    context: { currentTime: 0 },
  };
}

describe('volume curve', () => {
  it('is the square of the fader position', () => {
    for (const v of [0, 0.25, 0.5, 0.75, 1]) {
      expect(volumeCurve(v)).toBeCloseTo(v * v, 12);
    }
  });
  it('clamps out-of-range positions', () => {
    expect(volumeCurve(-0.5)).toBe(0);
    expect(volumeCurve(1.5)).toBe(1);
  });
  it('is monotonic', () => {
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = volumeCurve(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('mixer defaults and setVolume', () => {
  it('applies default volumes as squared gains on attach', () => {
    const m = new Mixer();
    const gains: Partial<Record<AudioChannel, ReturnType<typeof mkGain>>> = {};
    for (const ch of Object.keys(DEFAULT_VOLUMES) as AudioChannel[]) {
      const g = mkGain();
      m.attach(ch, g as never);
      gains[ch] = g;
    }
    for (const ch of Object.keys(DEFAULT_VOLUMES) as AudioChannel[]) {
      const expected = DEFAULT_VOLUMES[ch] ** 2;
      expect(gains[ch]!.gain.value).toBeCloseTo(expected, 10);
    }
  });

  it('setVolume clamps to [0,1] and applies the squared target', () => {
    const m = new Mixer();
    const g = mkGain(0);
    m.attach('music', g as never);
    m.setVolume('music', 2);
    expect(m.getVolume('music')).toBe(1);
    m.setVolume('music', -3);
    expect(m.getVolume('music')).toBe(0);
    m.setVolume('music', 0.5);
    expect(g.gain.value).toBeCloseTo(0.25, 10);
  });
});

describe('presets', () => {
  function fullMixer(): Mixer {
    const m = new Mixer();
    for (const ch of Object.keys(DEFAULT_VOLUMES) as AudioChannel[]) {
      m.attach(ch, mkGain(0) as never);
    }
    return m;
  }

  it('silence zeroes every source channel but leaves master untouched', () => {
    const m = fullMixer();
    m.applyPreset('silence');
    for (const ch of ['engine', 'tyres', 'ambience', 'music', 'wind'] as AudioChannel[]) {
      expect(m.getVolume(ch)).toBe(0);
    }
    expect(m.getVolume('master')).toBe(DEFAULT_VOLUMES.master);
  });

  it('default preset restores factory volumes', () => {
    const m = fullMixer();
    m.applyPreset('silence');
    m.applyPreset('default');
    for (const ch of Object.keys(DEFAULT_VOLUMES) as AudioChannel[]) {
      expect(m.getVolume(ch)).toBe(DEFAULT_VOLUMES[ch]);
    }
  });

  it('tracks the active preset', () => {
    const m = fullMixer();
    expect(m.currentPreset).toBe('default');
    m.applyPreset('silence');
    expect(m.currentPreset).toBe('silence');
  });
});

describe('headroom ledger (nothing clips)', () => {
  it('at default preset the worst-case output peak is far below full scale', () => {
    const m = new Mixer();
    expect(m.peakEstimate()).toBeLessThan(0.3);
    expect(m.peakEstimate()).toBeGreaterThan(0);
  });

  it('even with every fader at unity, rig peaks sum below 1.0', () => {
    const m = new Mixer();
    for (const ch of Object.keys(DEFAULT_VOLUMES) as AudioChannel[]) {
      m.setVolume(ch, 1);
    }
    const peak = m.peakEstimate(RIG_PEAKS);
    expect(peak).toBeLessThan(1.0);
  });

  it('rig peak table sums under unity before any fader math', () => {
    const rawSum =
      RIG_PEAKS.engine +
      RIG_PEAKS.tyres +
      RIG_PEAKS.ambience +
      RIG_PEAKS.music +
      RIG_PEAKS.wind;
    expect(rawSum).toBeLessThanOrEqual(0.96);
  });

  it('master at zero silences everything regardless of sources', () => {
    const m = new Mixer();
    for (const ch of Object.keys(DEFAULT_VOLUMES) as AudioChannel[]) {
      m.setVolume(ch, 1);
    }
    m.setVolume('master', 0);
    expect(m.peakEstimate(RIG_PEAKS)).toBe(0);
  });
});
