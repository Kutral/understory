import { describe, expect, it } from 'vitest';
import { TICK_DT } from '@contracts/constants';
import { GameLoop } from '@/core/loop';

const TICK_MS = TICK_DT * 1000;

function makeLoop(): {
  loop: GameLoop;
  ticks: number[];
  alphas: number[];
} {
  const ticks: number[] = [];
  const alphas: number[] = [];
  const loop = new GameLoop(
    () => ticks.push(ticks.length),
    (alpha) => alphas.push(alpha),
  );
  return { loop, ticks, alphas };
}

describe('GameLoop accumulator math', () => {
  it('runs one tick per elapsed TICK_DT', () => {
    const { loop, ticks } = makeLoop();
    loop.start(0);
    // 16 animation frames at ~60Hz: each frame lands almost exactly on a tick
    let now = 0;
    for (let i = 0; i < 16; i++) {
      now += TICK_MS + 0.01; // tiny drift so acc never goes negative
      loop.frame(now);
    }
    expect(ticks.length).toBe(16);
  });

  it('catches up with multiple ticks after a slow frame', () => {
    const { loop, ticks } = makeLoop();
    let now = 0;
    loop.start(now);
    now += TICK_MS + 1e-6; // 1 tick
    loop.frame(now);
    now += TICK_MS * 3 + 1e-6; // 3 more ticks owed
    loop.frame(now);
    expect(loop.ticksLastFrame).toBe(3);
    expect(ticks.length).toBe(4);
  });

  it('interpolation alpha stays in [0,1) and reflects leftover time', () => {
    const { loop, alphas } = makeLoop();
    loop.start(0);
    loop.frame(TICK_MS); // consumed fully → alpha ~0 next render
    expect(alphas[0]).toBeLessThan(0.001);
    loop.frame(TICK_MS + TICK_MS * 0.5); // half a tick left over
    expect(alphas[1]).toBeCloseTo(0.5, 5);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('clamps huge frame gaps to 0.25s', () => {
    const { loop, ticks } = makeLoop();
    loop.start(0);
    loop.frame(0);
    loop.frame(60_000); // tab was hidden for a minute
    // 0.25s / TICK_DT = 15 ticks wanted, capped at MAX_TICKS_PER_FRAME
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(loop.droppedBacklogLastFrame).toBe(true);
  });

  it('spiral-of-death guard: caps ticks per frame and drops the backlog', () => {
    const { loop, ticks } = makeLoop();
    loop.start(0);
    // Sustained 6x overload: each frame wants 6 ticks, gets 5, drops 1.
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now += TICK_MS * 6 + 1e-4;
      loop.frame(now);
      expect(loop.ticksLastFrame).toBe(5);
      // Guard must reset the accumulator so debt never compounds.
      expect(loop.droppedBacklogLastFrame).toBe(true);
    }
    // Total sim time stayed bounded instead of spiraling: 100 frames × 5 ticks.
    expect(ticks.length).toBe(500);
  });

  it('recovers cleanly the frame after the guard fires', () => {
    const { loop, alphas } = makeLoop();
    loop.start(0);
    loop.frame(TICK_MS * 100); // guard fires
    loop.frame(TICK_MS * 100 + TICK_MS); // normal frame afterwards
    expect(loop.ticksLastFrame).toBe(1);
    expect(loop.droppedBacklogLastFrame).toBe(false);
    expect(alphas[alphas.length - 1] ?? -1).toBeLessThan(1);
  });

  it('does nothing while stopped', () => {
    const { loop, ticks, alphas } = makeLoop();
    loop.start(0);
    loop.stop();
    loop.frame(TICK_MS);
    expect(ticks.length).toBe(0);
    expect(alphas.length).toBe(0);
  });

  it('measures phase timings on every frame', () => {
    const { loop } = makeLoop();
    loop.start(0);
    loop.frame(TICK_MS);
    expect(loop.frameMs).toBeGreaterThanOrEqual(0);
    expect(loop.simMs).toBeGreaterThanOrEqual(0);
    expect(loop.renderMs).toBeGreaterThanOrEqual(0);
    expect(loop.avgFrameMs).toBeGreaterThan(0);
  });
});
