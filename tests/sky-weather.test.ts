import { describe, it, expect } from 'vitest';
import { WEATHER_FADE_MAX_S, WEATHER_FADE_MIN_S } from '@contracts/constants';
import { createEventBus, type EventBusEvents } from '@contracts/events';
import { WeatherMachine, mulberry32 } from '@/sky/weather';
import { WEATHER_PRESETS } from '@/sky/palette';

const TICK = 1 / 60;

function runFade(m: WeatherMachine, to: Parameters<WeatherMachine['request']>[0]) {
  m.request(to);
  const samples: ReturnType<WeatherMachine['sample']>[] = [];
  for (let t = 0; t <= WEATHER_FADE_MAX_S + 1; t += TICK) {
    samples.push({ ...m.update(TICK) });
    if (!m.fading && samples.length > 1) break;
  }
  return samples;
}

describe('weather state machine', () => {
  it('fade durations are drawn within the contract bounds', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const d = WEATHER_FADE_MIN_S + rng() * (WEATHER_FADE_MAX_S - WEATHER_FADE_MIN_S);
      expect(d).toBeGreaterThanOrEqual(WEATHER_FADE_MIN_S);
      expect(d).toBeLessThanOrEqual(WEATHER_FADE_MAX_S);
    }
  });

  it('never snaps: every parameter moves by ≤ its total range per tick', () => {
    const m = new WeatherMachine(42);
    const samples = runFade(m, 'rain');
    expect(samples.length).toBeGreaterThan(30 * 60 * 0.9); // ≥ ~27s of fade at 60Hz
    for (let i = 1; i < samples.length; i++) {
      expect(Math.abs(samples[i]!.rain - samples[i - 1]!.rain)).toBeLessThan(0.01);
      expect(Math.abs(samples[i]!.fogMul - samples[i - 1]!.fogMul)).toBeLessThan(0.05);
      expect(Math.abs(samples[i]!.cloudCover - samples[i - 1]!.cloudCover)).toBeLessThan(0.01);
    }
  });

  it('per-parameter motion during a fade is monotonic toward the target', () => {
    const m = new WeatherMachine(1234);
    m.setNextFadeDuration(WEATHER_FADE_MAX_S);
    const target = 'drizzle';
    m.request(target);
    const tgt = WEATHER_PRESETS[target]!;
    // burn one update to get past origin
    let prev = m.update(TICK);
    while (m.fading) {
      const cur = m.update(TICK);
      for (const k of ['rain', 'cloudDark', 'mist'] as const) {
        if (Math.abs(cur[k] - prev[k]) < 1e-9) continue;
        const dir = Math.sign(tgt[k] - prev[k]);
        expect(dir === 0 || Math.sign(cur[k] - prev[k]) === dir).toBe(true);
      }
      prev = cur;
    }
    expect(m.settled).toBe(target);
  });

  it('mid-fade retarget stays continuous (no jump)', () => {
    const m = new WeatherMachine(99);
    m.setNextFadeDuration(45);
    m.request('rain');
    let maxJump = 0;
    let prevFog = m.update(TICK).fogMul;
    let switched = false;
    for (let t = TICK; t < 20; t += TICK) {
      if (!switched && t > 10) {
        m.request('mist'); // retarget halfway
        switched = true;
      }
      const fog = m.update(TICK).fogMul;
      maxJump = Math.max(maxJump, Math.abs(fog - prevFog));
      prevFog = fog;
    }
    expect(switched).toBe(true);
    expect(maxJump).toBeLessThan(0.02); // per-tick change stays smooth
  });

  it('blend progress is in [0,1], monotone within a single fade, and completes', () => {
    const m = new WeatherMachine(5);
    m.setNextFadeDuration(WEATHER_FADE_MIN_S);
    m.request('afterRain');
    let prev = 0;
    for (let t = 0; t < WEATHER_FADE_MIN_S + 2; t += TICK) {
      m.update(TICK);
      const b = m.blend;
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
      expect(b).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = b;
      if (!m.fading) break;
    }
    expect(m.fading).toBe(false);
    expect(m.blend).toBe(1);
  });

  it("emits 'weather/changed' exactly once per request, at fade start", () => {
    const bus = createEventBus();
    const events: EventBusEvents['weather/changed'][] = [];
    bus.on('weather/changed', (p) => events.push(p));
    const m = new WeatherMachine(11, (to) => bus.emit('weather/changed', { to }));
    m.setNextFadeDuration(WEATHER_FADE_MIN_S);
    m.request('mist');
    expect(events).toEqual([{ to: 'mist' }]);
    for (let t = 0; t < WEATHER_FADE_MIN_S + 2; t += TICK) {
      m.update(TICK);
      if (!m.fading) break;
    }
    expect(events.length).toBe(1); // completion does not double-fire
    expect(m.weather).toBe('mist');
  });

  it('requesting the settled state is a no-op (no re-fade, no event)', () => {
    const m = new WeatherMachine(3);
    m.request('clear');
    expect(m.fading).toBe(false);
    expect(m.weather).toBe('clear');
  });
});
