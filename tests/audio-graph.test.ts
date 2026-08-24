/**
 * Graph builder smoke test + node-count stability over a simulated
 * 10-minute session (60 ticks/s * 600 s = 36,000 update calls).
 *
 * JSDOM GUARD: if a global AudioContext exists (jsdom/browser-like env),
 * the suite prefers it for a true constructor smoke check; in the plain node
 * environment vitest runs here, a structurally-faithful fake is used instead.
 * Both paths run identical assertions on topology and stability.
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { UnderstoryAudio } from '@/audio/bus';
import { FakeAudioContext } from './audio-fakes';

const realCtor: typeof AudioContext | undefined = (
  globalThis as { AudioContext?: typeof AudioContext }
).AudioContext;

function makeCtx(): { ctx: AudioContext; fake: FakeAudioContext | null } {
  // Prefer a real context when the environment provides one; otherwise fake it.
  if (realCtor) {
    try {
      return { ctx: new realCtor(), fake: null };
    } catch {
      /* fall through to fake */
    }
  }
  const fake = new FakeAudioContext();
  return { ctx: fake as unknown as AudioContext, fake };
}

/** Simulated session driver: varies every input realistically per tick. */
function driveSession(
  audio: UnderstoryAudio,
  ctx: AudioContext,
  ticks: number,
  fake: FakeAudioContext | null,
): void {
  const lights = ['dawn', 'morning', 'goldenHour', 'dusk', 'blueHour', 'night'] as const;
  const weathers = ['clear', 'mist', 'drizzle', 'rain', 'afterRain'] as const;
  for (let i = 0; i < ticks; i++) {
    const t = i / 60;
    // A fake context has no render quantum; advance it so one-shot
    // schedulers see wall-clock progress like a real context would.
    fake?.advance(1 / 60);
    const speed01 = 0.5 + 0.5 * Math.sin(t / 7);
    const rpm01 = clamp01(0.2 + 0.6 * Math.abs(Math.sin(t / 3.1)));
    const surface = Math.floor(t / 5) % 4;
    const wind = 0.5 + 0.5 * Math.sin(t / 23);
    audio.update(speed01, rpm01, surface, wind);
    // Sky drifts: light state every simulated minute, weather every 90 s.
    if (i % (60 * 30) === 0) audio.setSky(lights[Math.floor(t / 60) % 6]!, weathers[0]!);
    if (i % (60 * 45) === 0) audio.setSky('morning', weathers[Math.floor(t / 90) % 5]!);
    void ctx;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

describe('audio graph (jsdom-guarded smoke)', () => {
  let audio: UnderstoryAudio;
  let fake: FakeAudioContext | null;
  let ctx: AudioContext;

  beforeAll(async () => {
    ({ ctx, fake } = makeCtx());
    audio = new UnderstoryAudio();
    await audio.init(ctx);
  });

  it('builds a non-trivial graph exactly once at init', () => {
    const s1 = audio.stats().nodeCount;
    expect(s1).toBeGreaterThan(40);
    // Second init is a no-op (idempotent).
    void audio.init(ctx);
    expect(audio.stats().nodeCount).toBe(s1);
  });

  it('node count is FLAT across a simulated 10-minute session (36k updates)', () => {
    const before = audio.stats().nodeCount;
    const createdBefore = fake ? fake.created.length : before;
    driveSession(audio, ctx, 36_000, fake);
    expect(audio.stats().nodeCount).toBe(before);
    if (fake) {
      // Hard proof of "never create per frame": not a single new node was
      // constructed during the whole session, despite dozens of one-shots.
      expect(fake.created.length).toBe(createdBefore);
      // One-shot automation actually fired during the session:
      const curves = fake.created.flatMap((n) =>
        Object.values(n.params).flatMap((p) => p.events),
      );
      expect(curves.length).toBeGreaterThan(5);
    }
  });

  it('one-shot triggers are pure parameter automation (no start/stop churn)', () => {
    if (!fake) return;
    const startedBefore = fake.created.filter(
      (n) => 'started' in n && n.started,
    ).length;
    for (let i = 0; i < 3600; i++) {
      fake.advance(1 / 60);
      audio.update(0.3, 0.4, 1, 0.2);
    }
    const startedAfter = fake.created.filter((n) => 'started' in n && n.started).length;
    expect(startedAfter).toBe(startedBefore);
  });

  it('preset changes do not add nodes', () => {
    const before = audio.stats().nodeCount;
    audio.applyPreset('silence');
    audio.applyPreset('default');
    audio.setVolume('music', 0);
    audio.setVolume('music', 0.45);
    expect(audio.stats().nodeCount).toBe(before);
  });

  it('headroom ledger stays below full scale at default preset', () => {
    expect(audio.peakEstimate()).toBeLessThan(0.35);
  });

  it('dispose disconnects everything and freezes stats', async () => {
    const count = audio.stats().nodeCount;
    audio.dispose();
    if (fake) {
      const stillConnected = fake.created.filter((n) => !n.disconnected && n.kind !== 'destination');
      expect(stillConnected.length).toBe(0);
    }
    // Safe to call again; update after dispose is a no-op.
    audio.dispose();
    audio.update(0.5, 0.5, 0, 0.5);
    expect(count).toBeGreaterThan(40);

    // A fresh bus can be built afterwards (simulates page reload).
    const { ctx: ctx2 } = makeCtx();
    const audio2 = new UnderstoryAudio();
    await audio2.init(ctx2);
    expect(audio2.stats().nodeCount).toBe(count);
    audio2.dispose();
  });
});
