import { describe, it, expect } from 'vitest';
import type { InputState } from '@contracts/input';
import { TICK_DT } from '@contracts/constants';
import { TOP_SPEED_MS } from '@/vehicle/tuning';
import {
  makeWorld,
  addFlatGround,
  addBumpyGround,
  bumpyHeight,
  spawn,
  scriptInput,
} from './helpers/vehicle-sim';

const IDLE: InputState = { steer: 0, throttle: 0, brake: 0, recover: false };

/**
 * FLIP-RESISTANCE HEURISTIC
 *
 * Drive hard over a bumpy synthetic heightfield with deterministic scripted
 * inputs and assert the car never approaches inverted:
 *  - max tilt stays well under 90° (heuristic threshold: 80°),
 *  - no sustained inversion (>90°) for more than a quarter second,
 *  - it ends the run essentially upright.
 */
describe('flip resistance over a bumpy synthetic heightfield', () => {
  it('never approaches inverted during 40 s of scripted driving', async () => {
    const world = await makeWorld();
    addBumpyGround(world);
    const v = await spawn(world, 0, bumpyHeight(0, 0), 'bumpy');

    let maxTilt = 0;
    let invertedRun = 0;
    let worstInvertedRun = 0;
    const totalTicks = 40 / TICK_DT; // 40 simulated seconds
    for (let i = 0; i < totalTicks; i++) {
      v.step(scriptInput(i * TICK_DT));
      const tilt = v.tiltDeg();
      maxTilt = Math.max(maxTilt, tilt);
      if (tilt > 90) {
        invertedRun += TICK_DT;
        worstInvertedRun = Math.max(worstInvertedRun, invertedRun);
      } else {
        invertedRun = 0;
      }
    }

     
    console.log(
      `[flip-heuristic] maxTilt=${maxTilt.toFixed(1)}deg worstInvertedRun=${worstInvertedRun.toFixed(3)}s endTilt=${v.tiltDeg().toFixed(1)}deg`,
    );
    expect(maxTilt).toBeLessThan(80);
    expect(worstInvertedRun).toBeLessThan(0.25);
    expect(v.tiltDeg()).toBeLessThan(30);
  }, 120_000);

  it('the Recover key gently rights a tipped car within ~3 s', async () => {
    const world = await makeWorld();
    addFlatGround(world);
    const v = await spawn(world, 0, 0, 'flat');

    // Force-tip the chassis onto its roof (deterministic setup, not physics).
    const body = v.vehicle.chassisBody;
    expect(body).not.toBeNull();
    const halfAngle = (170 * Math.PI) / 360; // ~85° roll onto its side/roof
    body!.setRotation({ x: Math.sin(halfAngle), y: 0, z: 0, w: Math.cos(halfAngle) }, true);
    body!.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body!.setAngvel({ x: 0, y: 0, z: 0 }, true);

    // Hold Recover for 3 simulated seconds.
    for (let i = 0; i < 3 / TICK_DT; i++) {
      v.step({ recover: true });
    }
    const afterRecover = v.tiltDeg();
     
    console.log(`[recover] tiltAfter3s=${afterRecover.toFixed(1)}deg`);
    expect(afterRecover).toBeLessThan(35);

    // And it must stay settled afterwards (no oscillation).
    for (let i = 0; i < 2 / TICK_DT; i++) v.step({});
    expect(v.tiltDeg()).toBeLessThan(15);
  }, 60_000);
});

/**
 * TUNING MEASUREMENTS — acceptance numbers for docs/notes/vehicle-input.md.
 */
describe('soft tuning measurements on flat trail ground', () => {
  it('top speed asymptotes under 85 km/h and 0–40 km/h feels unhurried', async () => {
    const world = await makeWorld();
    addFlatGround(world);
    const v = await spawn(world, 0, 0, 'flat');

    let tToFeelDone = -1;
    let topSpeed = 0;
    const seconds = 45;
    for (let i = 0; i < seconds / TICK_DT; i++) {
      v.step({ throttle: 1 });
      const kmh = Math.abs(v.vehicle.state.speedMs) * 3.6;
      topSpeed = Math.max(topSpeed, kmh);
      if (tToFeelDone < 0 && kmh >= 39.5) tToFeelDone = i * TICK_DT;
    }
    const finalKmh = Math.abs(v.vehicle.state.speedMs) * 3.6;
     
    console.log(
      `[top-speed] top=${topSpeed.toFixed(1)}km/h (cap ${(TOP_SPEED_MS * 3.6).toFixed(1)}) t-to-40=${tToFeelDone.toFixed(1)}s final=${finalKmh.toFixed(1)}km/h`,
    );
    expect(topSpeed * (1000 / 3600)).toBeLessThanOrEqual(TOP_SPEED_MS + 1e-6); // governor holds
    expect(tToFeelDone).toBeGreaterThan(4.0); // not a sports-car launch
    expect(tToFeelDone).toBeLessThan(20.0); // ...but not a tractor either
  }, 120_000);

  it('strong engine braking coasts the car to a full stop without the pedal', async () => {
    const world = await makeWorld();
    addFlatGround(world);
    const v = await spawn(world, 0, 0, 'flat');

    // Get up to ~60 km/h first.
    for (let i = 0; i < 12 / TICK_DT; i++) v.step({ throttle: 1 });
    const startKmh = Math.abs(v.vehicle.state.speedMs) * 3.6;

    // Lift off completely and coast.
    let stopTime = -1;
    let distance = 0;
    for (let i = 0; i < 20 / TICK_DT; i++) {
      const before = v.vehicle.transform.pz;
      v.step(IDLE);
      distance += Math.abs(v.vehicle.transform.pz - before);
      if (Math.abs(v.vehicle.state.speedMs) < 0.05 && stopTime < 0) {
        stopTime = i * TICK_DT;
        break;
      }
    }
     
    console.log(
      `[engine-brake] from ${startKmh.toFixed(1)}km/h stopped in ${stopTime.toFixed(1)}s over ${distance.toFixed(0)}m`,
    );
    expect(stopTime).toBeGreaterThan(0);
    expect(stopTime).toBeLessThan(15); // lifts off -> glides -> eases to a halt
  }, 120_000);
});
