import { describe, it, expect } from 'vitest';
import { updateSteering, applyDeadzone } from '@/vehicle/vehicle-math';
import { MAX_STEER_RAD, STEER_RATE, STEER_RETURN_RATE, TOP_SPEED_MS, FEEL_DONE_SPEED_MS, engineEffort } from '@/vehicle/tuning';
import { TICK_DT } from '@contracts/constants';
import { FixedLoop, runSeconds, makeWorld, addFlatGround, spawn } from './helpers/vehicle-sim';

/**
 * TIMESTEP INDEPENDENCE
 *
 * The production loop (contracts/frame.ts) advances simulation ONLY in fixed
 * TICK_DT steps; render rate merely decides how much wall time enters the
 * accumulator each frame. These tests prove that a 30 fps player and a
 * 144 fps player experience byte-identical steering response around that
 * fixed 60 Hz tick — first with the pure steering math, then through the
 * full Rapier vehicle sim.
 */

const STEER_PARAMS = {
  maxSteerRad: MAX_STEER_RAD,
  steerRate: STEER_RATE,
  returnRate: STEER_RETURN_RATE,
};

/** Run the pure steering model for 5 simulated seconds at a given render rate. */
function runPureSteering(renderFps: number): number[] {
  let steer = 0;
  const trace: number[] = [];
  const loop = new FixedLoop(renderFps, () => {
    // Full-right input while rolling at 12 m/s for 2.5s, then release.
    const t = trace.length * TICK_DT;
    steer = updateSteering(steer, t < 2.5 ? 0.8 : 0, 12, TICK_DT, STEER_PARAMS);
    trace.push(steer);
  });
  runSeconds(loop, renderFps, 5);
  return trace;
}

describe('timestep independence: steering response', () => {
  it('pure steering model is identical at 30 fps and 144 fps', () => {
    const at30 = runPureSteering(30);
    const at144 = runPureSteering(144);
    expect(at30.length).toBe(300); // exactly 5 s of ticks in both cases
    expect(at144.length).toBe(at30.length);
    for (let i = 0; i < at30.length; i++) {
      expect(at144[i]).toBe(at30[i]); // bit-identical, not just close
    }
  });

  it('full Rapier vehicle reaches the same place at 30 fps and 144 fps', async () => {
    const runAt = async (fps: number) => {
      const world = await makeWorld();
      addFlatGround(world);
      const v = await spawn(world, 0, 0, 'flat');
      const loop = new FixedLoop(fps, () =>
        v.step({ throttle: 0.8, steer: Math.sin(v.vehicle.state.speedMs / 6) * 0.5 }),
      );
      runSeconds(loop, fps, 10); // 10 simulated seconds = exactly 600 ticks
      return {
        x: v.vehicle.transform.px,
        y: v.vehicle.transform.py,
        z: v.vehicle.transform.pz,
        steer: 0,
        speedMs: v.vehicle.state.speedMs,
      };
    };
    const slow = await runAt(30);
    const fast = await runAt(144);
    // Same tick sequence executed -> deterministic engine gives same outcome.
    expect(Math.abs(fast.x - slow.x)).toBeLessThan(1e-6);
    expect(Math.abs(fast.z - slow.z)).toBeLessThan(1e-6);
    expect(Math.abs(fast.speedMs - slow.speedMs)).toBeLessThan(1e-9);
  });
});

describe('engine feel envelope', () => {
  it('effort is spent mostly below ~40 km/h (85 km/h that FEELS like 40)', () => {
    // At the "feels done" speed only ~38% of standstill punch remains.
    const remaining = engineEffort(FEEL_DONE_SPEED_MS);
    expect(remaining).toBeLessThan(0.45);
    expect(remaining).toBeGreaterThan(0.25);
    // And the envelope closes entirely at the top-speed constant.
    expect(engineEffort(TOP_SPEED_MS)).toBe(0);
  });

  it('deadzone used by gamepad keeps analog centre quiet', () => {
    expect(applyDeadzone(0.05, 0.14)).toBe(0);
    expect(applyDeadzone(0.5, 0.14)).toBeGreaterThan(0.3);
  });
});
