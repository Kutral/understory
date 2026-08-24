/**
 * Generative ambient music: four slow pad voices (two gently detuned
 * oscillators each) drifting through a modal chord cycle. Chords are chosen
 * by a seeded RNG on 18-34 s intervals and retuned with long exponential
 * glides — no rhythmic content, no melody, pure calm.
 *
 * Amplitude swells come from two sub-0.05 Hz LFOs hard-wired to voice gain
 * params at init, so the music breathes with zero per-frame work beyond the
 * occasional chord retune.
 *
 * Independently mutable: it sits alone on the 'music' mixer channel, so a
 * fader at 0 or the 'silence' preset removes it entirely.
 */

import type { MusicRig } from './types';
import { NodeRegistry } from './registry';
import { mulberry32, rngRange } from './rng';

/** Chord voicings in Hz (A Aeolian, low-mid register). */
const CHORDS: readonly number[][] = [
  [110.0, 164.81, 196.0, 261.63], // Am7
  [87.31, 130.81, 174.61, 220.0], // Fmaj7
  [130.81, 196.0, 261.63, 329.63], // C
  [98.0, 146.83, 246.94, 293.66], // Gsus-ish
] as const;

const VOICES = 4;
/** Per-voice summed oscillator amplitude; 4 voices * this <= RIG_PEAKS.music. */
const VOICE_AMP = 0.055;
const DETUNE_CENTS = 4;
const CHORD_MIN_S = 18;
const CHORD_MAX_S = 34;

export function buildMusic(
  ctx: BaseAudioContext,
  reg: NodeRegistry,
  out: AudioNode,
  seed: number,
): MusicRig {
  const lp = reg.add(ctx.createBiquadFilter());
  lp.type = 'lowpass';
  lp.frequency.value = 850;
  lp.Q.value = 0.3;
  lp.connect(out);

  interface Voice {
    oscA: OscillatorNode;
    oscB: OscillatorNode;
    gain: GainNode;
  }
  const voices: Voice[] = [];
  const startChord = CHORDS[0]!;
  for (let i = 0; i < VOICES; i++) {
    const oscA = reg.add(ctx.createOscillator());
    oscA.type = 'sine';
    oscA.frequency.value = startChord[i] ?? 110;
    const oscB = reg.add(ctx.createOscillator());
    oscB.type = 'triangle';
    oscB.frequency.value = startChord[i] ?? 110;
    oscB.detune.value = DETUNE_CENTS;
    const g = reg.add(ctx.createGain());
    // Base level sits at half so the LFO can swell both ways around it.
    g.gain.value = VOICE_AMP * 0.5;
    oscA.connect(g);
    oscB.connect(g);
    g.connect(lp);
    oscA.start();
    oscB.start();
    voices.push({ oscA, oscB, gain: g });
  }

  // Breathing LFOs: each drives alternate voices' gain params.
  const lfoSpecs = [
    { hz: 0.031, depth: VOICE_AMP * 0.45, targets: [0, 2] },
    { hz: 0.047, depth: VOICE_AMP * 0.45, targets: [1, 3] },
  ] as const;
  for (const spec of lfoSpecs) {
    const lfo = reg.add(ctx.createOscillator());
    lfo.frequency.value = spec.hz;
    const depth = reg.add(ctx.createGain());
    depth.gain.value = spec.depth;
    lfo.connect(depth);
    for (const vi of spec.targets) {
      depth.connect(voices[vi]!.gain.gain);
    }
    lfo.start();
  }

  const rng = mulberry32(seed);
  let chordIdx = 0;
  let nextChordAt = ctx.currentTime + rngRange(rng, CHORD_MIN_S, CHORD_MAX_S);

  return {
    peak: 0.23,
    update(t: number): void {
      if (t < nextChordAt) return;
      let next = Math.floor(rng() * CHORDS.length);
      if (next === chordIdx) next = (next + 1 + Math.floor(rng() * (CHORDS.length - 1))) % CHORDS.length;
      chordIdx = next;
      const chord = CHORDS[chordIdx]!;
      for (let i = 0; i < voices.length; i++) {
        const f = chord[i] ?? 110;
        voices[i]!.oscA.frequency.setTargetAtTime(f, t, 5);
        voices[i]!.oscB.frequency.setTargetAtTime(f, t, 6);
      }
      nextChordAt = t + rngRange(rng, CHORD_MIN_S, CHORD_MAX_S);
    },
    dispose(): void {
      try {
        for (const v of voices) {
          v.oscA.stop();
          v.oscB.stop();
        }
      } catch {
        /* already stopped */
      }
    },
  };
}
