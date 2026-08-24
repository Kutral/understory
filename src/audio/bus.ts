/**
 * UnderstoryAudio — the concrete AudioBus.
 *
 * GRAPH (built exactly once in init; topology is immutable afterwards):
 *
 *   engine rig ──┐
 *   tyre rig  ───┤
 *   ambience  ───┼─> channel gain ─> master gain ─> master lowpass ─> limiter ─> destination
 *   music rig ───┤        (mixer)         (mixer)      (opens w/ speed)   (safety)
 *   wind rig  ───┘
 *
 * update() is the ONLY per-tick entry point and touches AudioParams with
 * setTargetAtTime exclusively — no node creation, no connect/disconnect,
 * no allocation. stats().nodeCount is therefore flat forever after init,
 * which tests assert over a simulated 10-minute session (36k updates).
 */

import type { AudioBus, AudioChannel, AudioMixerState } from '@contracts/audio';
import type { LightState, WeatherState } from '@contracts/sky';
import { NodeRegistry } from './registry';
import { Mixer } from './mixer';
import { makeNoiseBuffer } from './noise';
import { buildEngine } from './engine';
import { buildTyres } from './tyres';
import { buildWind } from './wind';
import { buildAmbience, type AmbienceWithScheduler } from './ambience';
import { buildMusic } from './music';
import { masterCutoff, clamp01 } from './curves';

export class UnderstoryAudio implements AudioBus {
  private ctx: AudioContext | null = null;
  private reg = new NodeRegistry();
  private mixer = new Mixer();
  private engine?: ReturnType<typeof buildEngine>;
  private tyres?: ReturnType<typeof buildTyres>;
  private wind?: ReturnType<typeof buildWind>;
  private ambience?: AmbienceWithScheduler;
  private music?: ReturnType<typeof buildMusic>;
  private masterLp?: BiquadFilterNode;
  private disposed = false;

  /** Extra input the contract lacks (see docs/notes/audio.md): sky drives beds. */
  setSky(light: LightState, weather: WeatherState): void {
    this.ambience?.setSky(light, weather);
  }

  async init(ctx: AudioContext): Promise<void> {
    if (this.ctx || this.disposed) return;
    this.ctx = ctx;
    const reg = this.reg;

    // Master chain: gain -> lowpass -> limiter -> destination.
    const masterGain = reg.add(ctx.createGain());
    masterGain.gain.value = 1;
    const lp = reg.add(ctx.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = masterCutoff(0);
    lp.Q.value = 0.4;
    const limiter = reg.add(ctx.createDynamicsCompressor());
    // Gentle safety brickwall; with headroom accounting it should never bite.
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.004;
    limiter.release.value = 0.18;
    masterGain.connect(lp);
    lp.connect(limiter);
    limiter.connect(ctx.destination);
    this.mixer.attach('master', masterGain);
    this.masterLp = lp;

    // Shared noise buffers: ~2 s pink + brown at ctx rate (~768 KB total).
    const pink = makeNoiseBuffer(ctx, 2, 'pink', 1, 0x5eed_0001);
    const white = makeNoiseBuffer(ctx, 2, 'white', 1, 0x5eed_0002);
    const brown = makeNoiseBuffer(ctx, 3, 'brown', 1, 0x5eed_0003);

    // Channel gains first so rigs can attach below them.
    const channelOf = (ch: AudioChannel): GainNode => {
      const g = reg.add(ctx.createGain());
      g.gain.value = 1;
      g.connect(masterGain);
      this.mixer.attach(ch, g);
      return g;
    };

    const engCh = channelOf('engine');
    const tyreCh = channelOf('tyres');
    const ambCh = channelOf('ambience');
    const musCh = channelOf('music');
    const windCh = channelOf('wind');

    this.engine = buildEngine(ctx, reg, pink, engCh);
    this.tyres = buildTyres(ctx, reg, white, tyreCh);
    this.wind = buildWind(ctx, reg, pink, windCh);
    this.ambience = buildAmbience(ctx, reg, pink, brown, ambCh, 0x5eed_a1) as AmbienceWithScheduler;
    this.music = buildMusic(ctx, reg, musCh, 0x5eed_00a1);

    // Prime all params once so the first audible second is already correct.
    this.update(0, 0, 0, 0);
  }

  get currentPreset(): AudioMixerState['preset'] {
    return this.mixer.currentPreset;
  }

  /** Static worst-case peak at the output (headroom ledger, see tests). */
  peakEstimate(): number {
    return this.mixer.peakEstimate();
  }

  setVolume(ch: AudioChannel, v: number): void {
    this.mixer.setVolume(ch, v);
  }

  applyPreset(p: AudioMixerState['preset']): void {
    this.mixer.applyPreset(p);
  }

  update(vehicleSpeed01: number, rpm01: number, surface: number, windLevel: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const s01 = clamp01(vehicleSpeed01);
    this.engine?.update(t, rpm01);
    this.tyres?.update(t, surface, s01);
    this.wind?.update(t, windLevel, s01);
    this.ambience?.update(t);
    this.music?.update(t);
    this.masterLp?.frequency.setTargetAtTime(masterCutoff(s01), t, 0.25);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  stats(): { nodeCount: number } {
    return { nodeCount: this.reg.size };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.engine?.dispose();
      this.tyres?.dispose();
      this.wind?.dispose();
      this.ambience?.dispose();
      this.music?.dispose();
    } finally {
      this.reg.disconnectAll();
      this.ctx = null;
    }
  }
}

/** Factory used by main.ts wiring. */
export function createUnderstoryAudio(): UnderstoryAudio {
  return new UnderstoryAudio();
}
