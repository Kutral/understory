import { describe, it, expect } from 'vitest';
import { DAY_CYCLE_REAL_SECONDS } from '@contracts/constants';
import { DRIFT_HOURS_PER_SECOND, wrap24 } from '@/sky/time';
import { SkySystemImpl } from '@/sky/SkySystemImpl';

const TICK = 1 / 60;

describe('drift mode + scrub API', () => {
  it('rate math: a full day passes in DAY_CYCLE_REAL_SECONDS', () => {
    expect(DRIFT_HOURS_PER_SECOND).toBeCloseTo(24 / DAY_CYCLE_REAL_SECONDS);
    expect(DRIFT_HOURS_PER_SECOND).toBeCloseTo(0.01); // 0.01 game-hours per real second
    const sky = new SkySystemImpl();
    sky.setDriftMode(true);
    sky.setTimeOfDay(0);
    // Advance the full day in fixed ticks (chunked to keep the test fast).
    const totalTicks = Math.round(DAY_CYCLE_REAL_SECONDS / TICK); // 144_000
    for (let i = 0; i < totalTicks; i++) sky.fixedUpdate(TICK);
    const t = sky.timeOfDay;
    expect(t).toBeGreaterThanOrEqual(23.9999);
    expect(wrap24(t + 0.0001)).toBeLessThan(0.001);
  });

  it('drift advances time linearly between scrubs', () => {
    const sky = new SkySystemImpl();
    sky.setDriftMode(true);
    sky.setTimeOfDay(12);
    for (let i = 0; i < 600; i++) sky.fixedUpdate(TICK); // 10 s
    expect(sky.timeOfDay).toBeCloseTo(12 + DRIFT_HOURS_PER_SECOND * 10, 3);
    for (let i = 0; i < 600; i++) sky.fixedUpdate(TICK);
    expect(sky.timeOfDay).toBeCloseTo(12 + DRIFT_HOURS_PER_SECOND * 20, 3);
  });

  it('scrub API sets absolute time immediately and wraps out-of-range values', () => {
    const sky = new SkySystemImpl();
    sky.setTimeOfDay(18.05);
    expect(sky.timeOfDay).toBeCloseTo(18.05);
    expect(sky.lightState).toBe('dusk');
    sky.setTimeOfDay(25);
    expect(sky.timeOfDay).toBeCloseTo(1);
    sky.setTimeOfDay(-2);
    expect(sky.timeOfDay).toBeCloseTo(22);
    expect(sky.getSnapshot().timeOfDay).toBeCloseTo(22);
  });

  it('drift is off by default; time holds still without it', () => {
    const sky = new SkySystemImpl();
    expect(sky.driftEnabled).toBe(false);
    const t0 = sky.timeOfDay;
    for (let i = 0; i < 120; i++) sky.fixedUpdate(TICK);
    expect(sky.timeOfDay).toBe(t0);
  });

  it('scrubbing mid-drift continues from the new point', () => {
    const sky = new SkySystemImpl();
    sky.setDriftMode(true);
    sky.setTimeOfDay(23.99);
    for (let i = 0; i < 600; i++) sky.fixedUpdate(TICK); // +0.1h, clearly past midnight
    expect(sky.timeOfDay).toBeLessThan(1);
  });
});
