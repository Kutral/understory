/**
 * HUD idle-timer logic — the "fades after 4s steady driving, returns on
 * input" rule from ART-DIRECTION, with HUD_IDLE_HIDE_S = 4 (constants.ts).
 * Pure logic with an injected clock: no DOM, no fake timers.
 */
import { describe, expect, it } from 'vitest';
import { HudIdleTimer, type IdleClock } from '@/ui/idle';
import { HUD_IDLE_HIDE_S } from '@contracts/constants';

function manualClock(start = 0): { clock: IdleClock; set(t: number): void } {
  let now = start;
  return {
    clock: { now: () => now },
    set: (t) => {
      now = t;
    },
  };
}

describe('HudIdleTimer', () => {
  it('uses HUD_IDLE_HIDE_S (4s) by default', () => {
    const { clock, set } = manualClock(0);
    const timer = new HudIdleTimer(undefined, clock);
    set(HUD_IDLE_HIDE_S - 0.001);
    expect(timer.update()).toBe(true);

    const freshClock = manualClock(0);
    const fresh = new HudIdleTimer(undefined, freshClock.clock);
    freshClock.set(HUD_IDLE_HIDE_S);
    expect(fresh.update()).toBe(false);
  });

  it('is visible at rest before any update', () => {
    const { clock } = manualClock(100);
    const timer = new HudIdleTimer(undefined, clock);
    expect(timer.isHidden).toBe(false);
  });

  it('hides after exactly the configured seconds of steady driving', () => {
    const { clock, set } = manualClock();
    const timer = new HudIdleTimer(4, clock);
    for (let t = 0.5; t <= 3.99; t += 0.5) {
      set(t);
      expect(timer.update()).toBe(true);
    }
    set(4);
    expect(timer.update()).toBe(false); // boundary is inclusive
    set(10);
    expect(timer.update()).toBe(false);
    expect(timer.isHidden).toBe(true);
  });

  it('returns immediately on input', () => {
    const { clock, set } = manualClock();
    const timer = new HudIdleTimer(4, clock);
    set(10);
    timer.update();
    expect(timer.isHidden).toBe(true);
    set(10.5);
    timer.notifyInput();
    expect(timer.isHidden).toBe(false);
    expect(timer.update()).toBe(true);
  });

  it('repeated inputs keep it visible indefinitely', () => {
    const { clock, set } = manualClock();
    const timer = new HudIdleTimer(4, clock);
    for (let t = 0; t <= 60; t += 1) {
      timer.notifyInput();
      set(t + 2); // never more than 2s between inputs
      expect(timer.update()).toBe(true);
    }
  });

  it('a single input resets the whole window', () => {
    const { clock, set } = manualClock();
    const timer = new HudIdleTimer(4, clock);
    set(3.9);
    timer.notifyInput(); // window restarts here
    set(7.89);
    expect(timer.update()).toBe(true); // 3.99s since input
    set(7.9);
    expect(timer.update()).toBe(false); // 4.00s since input
  });
});
