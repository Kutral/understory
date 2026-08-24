/**
 * Ambience rig: spatialised beds parameterised by LightState x WeatherState,
 * plus four one-shot voices (birdsong, distant crow, dripping leaves, far
 * thunder).
 *
 * SPATIALISATION: each bed is stereo-widened by a very slow LFO drifting a
 * StereoPannerNode (cheap, allocation-free; HRTF panners were rejected for
 * CPU cost — see docs/notes/audio.md).
 *
 * ONE-SHOTS WITHOUT NEW NODES: every shot owns a persistent voice built once
 * at init. A "trigger" is purely parameter automation
 * (setValueCurveAtTime on gain/frequency), so graph topology never changes,
 * even during a shot. The scheduler guarantees min gap >= 1.2x curve length
 * so automation curves never overlap on the same AudioParam.
 */

import type { LightState, WeatherState } from '@contracts/sky';
import type { AmbienceRig } from './types';
import type { ShotSpec } from './scheduler';
import { NodeRegistry } from './registry';
import { OneShotScheduler } from './scheduler';
import { mulberry32 } from './rng';

export const LIGHT_STATES: readonly LightState[] = [
  'dawn',
  'morning',
  'goldenHour',
  'dusk',
  'blueHour',
  'night',
] as const;

export const WEATHER_STATES: readonly WeatherState[] = [
  'clear',
  'mist',
  'drizzle',
  'rain',
  'afterRain',
] as const;

export interface BedParams {
  /** Forest-air bed level 0..1. */
  airGain: number;
  /** Forest-air lowpass cutoff, Hz. */
  airFreq: number;
  /** Rain/moisture bed level 0..1. */
  rainGain: number;
  /** Rain bandpass centre, Hz. */
  rainTone: number;
  birdBias: number;
  crowBias: number;
  dripBias: number;
  thunderBias: number;
}

/** Deterministic bed lookup — pure, unit-testable, covers all 30 combos. */
export function bedParams(light: LightState, weather: WeatherState): BedParams {
  const p: BedParams = {
    airGain: 0.62,
    airFreq: 900,
    rainGain: 0,
    rainTone: 1400,
    birdBias: 0.9,
    crowBias: 0.4,
    dripBias: 0.15,
    thunderBias: 0.06,
  };

  switch (weather) {
    case 'mist':
      p.airGain = 0.5;
      p.airFreq = 620; // closer, hushed
      p.dripBias = 0.25;
      break;
    case 'drizzle':
      p.rainGain = 0.34;
      p.rainTone = 1700;
      p.birdBias = 0.45;
      p.dripBias = 0.5;
      break;
    case 'rain':
      p.airGain = 0.42;
      p.rainGain = 0.62;
      p.rainTone = 1350;
      p.birdBias = 0.2;
      p.crowBias = 0.15;
      p.dripBias = 0.7;
      p.thunderBias = 0.5;
      break;
    case 'afterRain':
      p.airGain = 0.68;
      p.airFreq = 1050;
      p.rainGain = 0.08;
      p.rainTone = 2200;
      p.birdBias = 1;
      p.dripBias = 1; // dripping leaves everywhere
      p.thunderBias = 0.12;
      break;
    default:
      break; // clear
  }

  switch (light) {
    case 'dawn':
      p.birdBias = Math.min(1, p.birdBias + 0.15);
      p.airFreq *= 0.92;
      break;
    case 'goldenHour':
      p.crowBias = Math.min(1, p.crowBias + 0.2); // evening crows
      break;
    case 'dusk':
      p.birdBias *= 0.55;
      p.crowBias = Math.min(1, p.crowBias + 0.1);
      p.thunderBias = Math.min(1, p.thunderBias * 1.2);
      break;
    case 'blueHour':
      p.birdBias *= 0.3;
      p.airGain *= 0.95;
      break;
    case 'night':
      p.birdBias *= 0.08;
      p.crowBias *= 0.25;
      p.airGain *= 0.85;
      p.airFreq *= 0.8;
      p.thunderBias = Math.min(1, p.thunderBias * 1.1);
      break;
    default:
      break; // morning
  }

  return p;
}

// ---------------------------------------------------------------------------
// One-shot automation curves (Float32Array value curves)
// ---------------------------------------------------------------------------

const BIRD_S = 1.4;
const CROW_S = 1.3;
const DRIP_S = 0.22;
const THUNDER_S = 5.5;

function chirpCurve(points: Array<[number, number]>, n = 48): Float32Array {
  // Piecewise-linear through [t01, hz] points.
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let k = 0;
    while (k < points.length - 2 && points[k + 1]![0] < t) k++;
    const [t0, f0] = points[k]!;
    const [t1, f1] = points[k + 1]!;
    const u = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    c[i] = f0 + (f1 - f0) * Math.max(0, Math.min(1, u));
  }
  return c;
}

const BIRD_FREQ = chirpCurve([
  [0, 2100],
  [0.18, 2600],
  [0.36, 1900],
  [0.5, 2500],
  [0.72, 1750],
  [1, 1500],
]);
const BIRD_ENV = (() => {
  const c = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    // Three syllable swells then silence.
    const s =
      0.7 * Math.exp(-((t - 0.14) ** 2) / 0.004) +
      0.9 * Math.exp(-((t - 0.45) ** 2) / 0.005) +
      0.6 * Math.exp(-((t - 0.75) ** 2) / 0.006);
    c[i] = Math.min(1, s);
  }
  return c;
})();

const CROW_FREQ = chirpCurve([
  [0, 300],
  [0.08, 520],
  [0.3, 430],
  [0.42, 380],
  [0.5, 300],
  [0.58, 520],
  [0.82, 400],
  [1, 280],
]);
const CROW_ENV = (() => {
  const c = new Float32Array(64);
  for (let i = 0; i < 64; i++) {
    const t = i / 63;
    const a = 0.9 * Math.exp(-Math.max(0, t - 0.05) / 0.13) * (t > 0.02 ? 1 : t / 0.02);
    const b = 0.7 * Math.exp(-Math.max(0, t - 0.6) / 0.16) * (t > 0.57 ? 1 : 0);
    c[i] = Math.min(1, Math.max(a, b));
  }
  return c;
})();

const DRIP_FREQ = chirpCurve([
  [0, 1900],
  [0.35, 1150],
  [1, 700],
]);
const DRIP_ENV = (() => {
  const c = new Float32Array(48);
  for (let i = 0; i < 48; i++) {
    const t = i / 47;
    c[i] = Math.exp(-t / 0.28) * Math.min(1, t / 0.06);
  }
  return c;
})();
const THUNDER_ENV = (() => {
  const c = new Float32Array(96);
  for (let i = 0; i < 96; i++) {
    const t = i / 95;
    // Slow swell, long rumble decay — far away, never alarming.
    const swell = Math.min(1, t / 0.28);
    const decay = Math.exp(-Math.max(0, t - 0.28) / 1.9);
    c[i] = swell * decay;
  }
  return c;
})();

// ---------------------------------------------------------------------------

interface ShotVoice {
  fire(t: number): void;
}

const SHOT_AMP = 0.12;

/** Pre-scaled envelope curves so firing allocates nothing. */
function scaledEnv(c: Float32Array, amp: number): Float32Array {
  const o = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) o[i] = c[i]! * amp;
  return o;
}
const BIRD_ENV_A = scaledEnv(BIRD_ENV, SHOT_AMP);
const CROW_ENV_A = scaledEnv(CROW_ENV, SHOT_AMP);
const DRIP_ENV_A = scaledEnv(DRIP_ENV, SHOT_AMP);
const THUNDER_ENV_A = scaledEnv(THUNDER_ENV, 0.16);

export function buildAmbience(
  ctx: BaseAudioContext,
  reg: NodeRegistry,
  pink: AudioBuffer,
  brown: AudioBuffer,
  out: AudioNode,
  seed: number,
): AmbienceRig & { scheduler: OneShotScheduler } {
  let light: LightState = 'morning';
  let weather: WeatherState = 'clear';

  // --- Forest-air bed -----------------------------------------------------
  const air = reg.add(ctx.createBufferSource());
  air.buffer = pink;
  air.loop = true;
  const airLp = reg.add(ctx.createBiquadFilter());
  airLp.type = 'lowpass';
  airLp.frequency.value = 900;
  airLp.Q.value = 0.3;
  const airGain = reg.add(ctx.createGain());
  airGain.gain.value = 0.4;
  const airPan = reg.add(ctx.createStereoPanner());
  air.connect(airLp);
  airLp.connect(airGain);
  airGain.connect(airPan);
  airPan.connect(out);

  // Slow pan drift LFO (created once, connected to the AudioParam).
  const airLfo = reg.add(ctx.createOscillator());
  airLfo.frequency.value = 0.041;
  const airLfoDepth = reg.add(ctx.createGain());
  airLfoDepth.gain.value = 0.35;
  airLfo.connect(airLfoDepth);
  airLfoDepth.connect(airPan.pan);
  airLfo.start();

  // --- Rain/moisture bed --------------------------------------------------
  const rain = reg.add(ctx.createBufferSource());
  rain.buffer = pink;
  rain.loop = true;
  const rainBp = reg.add(ctx.createBiquadFilter());
  rainBp.type = 'bandpass';
  rainBp.frequency.value = 1400;
  rainBp.Q.value = 0.45;
  const rainGain = reg.add(ctx.createGain());
  rainGain.gain.value = 0;
  const rainPan = reg.add(ctx.createStereoPanner());
  rain.connect(rainBp);
  rainBp.connect(rainGain);
  rainGain.connect(rainPan);
  rainPan.connect(out);

  const rainLfo = reg.add(ctx.createOscillator());
  rainLfo.frequency.value = 0.027;
  const rainLfoDepth = reg.add(ctx.createGain());
  rainLfoDepth.gain.value = 0.3;
  rainLfo.connect(rainLfoDepth);
  rainLfoDepth.connect(rainPan.pan);
  rainLfo.start();

  air.start();
  rain.start();

  // --- One-shot voices (persistent; triggers are automation only) --------
  const shotOscs: OscillatorNode[] = [];
  const mkOscVoice = (
    type: OscillatorType,
    baseFreq: number,
    freqCurve: Float32Array,
    envAmpCurve: Float32Array,
    durS: number,
    filter?: { type: BiquadFilterType; freq: number; q: number },
  ): ShotVoice => {
    const osc = reg.add(ctx.createOscillator());
    osc.type = type;
    osc.frequency.value = baseFreq;
    let head: AudioNode = osc;
    if (filter) {
      const f = reg.add(ctx.createBiquadFilter());
      f.type = filter.type;
      f.frequency.value = filter.freq;
      f.Q.value = filter.q;
      osc.connect(f);
      head = f;
    }
    const g = reg.add(ctx.createGain());
    g.gain.value = 0;
    head.connect(g);
    g.connect(out);
    osc.start();
    shotOscs.push(osc);
    return {
      fire(t) {
        osc.frequency.setValueCurveAtTime(freqCurve, t, durS);
        g.gain.setValueCurveAtTime(envAmpCurve, t, durS);
      },
    };
  };

  const bird = mkOscVoice('sine', 2000, BIRD_FREQ, BIRD_ENV_A, BIRD_S);
  const crow = mkOscVoice('triangle', 420, CROW_FREQ, CROW_ENV_A, CROW_S, {
    type: 'bandpass',
    freq: 620,
    q: 0.9,
  });
  const drip = mkOscVoice('sine', 1500, DRIP_FREQ, DRIP_ENV_A, DRIP_S);

  // Thunder reuses the shared brown-noise loop through its own dark chain.
  const thSrc = reg.add(ctx.createBufferSource());
  thSrc.buffer = brown;
  thSrc.loop = true;
  const thLp = reg.add(ctx.createBiquadFilter());
  thLp.type = 'lowpass';
  thLp.frequency.value = 110;
  thLp.Q.value = 0.5;
  const thGain = reg.add(ctx.createGain());
  thGain.gain.value = 0;
  thSrc.connect(thLp);
  thLp.connect(thGain);
  thGain.connect(out);
  thSrc.start();
  const thunder: ShotVoice = {
    fire(t) {
      thGain.gain.setValueCurveAtTime(THUNDER_ENV_A, t, THUNDER_S);
    },
  };

  const voices: Record<string, ShotVoice> = { bird, crow, drip, thunder };
  const specs: Record<string, ShotSpec> = {
    bird: { minGapS: 7, maxGapS: 26, durationS: BIRD_S, bias: 0.9 },
    crow: { minGapS: 24, maxGapS: 90, durationS: CROW_S, bias: 0.4 },
    drip: { minGapS: 2.5, maxGapS: 9, durationS: DRIP_S, bias: 0.15 },
    thunder: { minGapS: 70, maxGapS: 240, durationS: THUNDER_S, bias: 0.06 },
  };
  // Invariant the automation scheme depends on: gap always clears the curve.
  for (const k of Object.keys(specs)) {
    const s = specs[k]!;
    if (s.minGapS < s.durationS * 1.2) {
      throw new Error(`shot ${k}: minGapS must exceed duration*1.2`);
    }
  }

  const rng = mulberry32(seed);
  const scheduler = new OneShotScheduler(specs, rng, () => ctx.currentTime);

  return {
    scheduler,
    peak: 0.19,
    setSky(nextLight: string, nextWeather: string): void {
      if (LIGHT_STATES.includes(nextLight as LightState)) light = nextLight as LightState;
      if (WEATHER_STATES.includes(nextWeather as WeatherState))
        weather = nextWeather as WeatherState;
      const p = bedParams(light, weather);
      const t = ctx.currentTime;
      airGain.gain.setTargetAtTime(p.airGain * 0.65, t, 1.5);
      airLp.frequency.setTargetAtTime(p.airFreq, t, 2);
      rainGain.gain.setTargetAtTime(p.rainGain * 0.3, t, 1.5);
      rainBp.frequency.setTargetAtTime(p.rainTone, t, 2);
      scheduler.specs['bird']!.bias = p.birdBias;
      scheduler.specs['crow']!.bias = p.crowBias;
      scheduler.specs['drip']!.bias = p.dripBias;
      scheduler.specs['thunder']!.bias = p.thunderBias;
    },
    update(t: number): void {
      const due = scheduler.tick();
      for (const key of due) voices[key]?.fire(t);
    },
    dispose(): void {
      try {
        air.stop();
        rain.stop();
        airLfo.stop();
        rainLfo.stop();
        thSrc.stop();
        for (const o of shotOscs) o.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

export type AmbienceWithScheduler = ReturnType<typeof buildAmbience>;
