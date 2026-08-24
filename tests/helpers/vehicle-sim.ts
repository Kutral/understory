import RAPIER from '@dimforge/rapier3d-compat';
import { SoftVehicle } from '@/vehicle/vehicle';
import type { InputState } from '@contracts/input';
import { TICK_DT } from '@contracts/constants';

/**
 * Deterministic fixed-tick accumulator shared by the vehicle tests.
 * `renderFps` only controls how much wall time lands in the accumulator per
 * frame; the simulation ALWAYS advances in TICK_DT steps — this is exactly
 * the production loop shape (contracts/frame.ts).
 */
export class FixedLoop {
  private acc = 0;
  ticksRun = 0;
  constructor(
    private readonly renderFps: number,
    private readonly onTick: () => void,
  ) {}

  /** Advance one rendered frame of wall time; returns ticks executed. */
  frame(): number {
    this.acc += 1 / this.renderFps;
    let ticks = 0;
    while (this.acc >= TICK_DT && ticks < 5) {
      this.acc -= TICK_DT;
      ticks++;
      this.onTick();
    }
    // MAX_TICKS_PER_FRAME surrender: drop excess time (spiral-of-death guard)
    if (this.acc > TICK_DT) this.acc = 0;
    this.ticksRun += ticks;
    return ticks;
  }
}

/**
 * Render frames at `fps` until the loop has executed EXACTLY `seconds` worth
 * of fixed ticks — isolates tick-sequence equality from accumulator float
 * residue at the final partial frame.
 */
export function runSeconds(loop: FixedLoop, fps: number, seconds: number): void {
  const target = Math.round(seconds * 60);
  while (loop.ticksRun < target) loop.frame();
}

export interface Ground {
  world: RAPIER.World;
}

let rapierInit: Promise<void> | null = null;

/** Boot Rapier once for the test process and build a flat-ground physics world. */
export async function makeWorld(): Promise<RAPIER.World> {
  rapierInit ??= RAPIER.init();
  await rapierInit;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  return world;
}

export function addFlatGround(world: RAPIER.World): void {
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  // Huge so multi-second test drives never run off the edge.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(20000, 0.5, 20000).setTranslation(0, -0.5, 0).setFriction(1.0),
    body,
  );
}

/**
 * Bumpy synthetic heightfield: deterministic sum of sines, ~±1.2 m relief
 * over 30–60 m wavelengths — lumpy enough to load the suspension hard.
 */
export function bumpyHeight(x: number, z: number): number {
  return (
    0.6 * Math.sin(x / 7.1) +
    0.45 * Math.sin(z / 5.3 + 1.2) +
    0.25 * Math.sin((x + z) / 9.4 + 0.4) +
    0.12 * Math.sin((x - z) / 3.7)
  );
}

export function addBumpyGround(world: RAPIER.World, half: number = 256): void {
  const n = 128; // vertices per side
  const heights = new Float32Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = -half + (2 * half * j) / (n - 1);
      const z = -half + (2 * half * i) / (n - 1);
      heights[i * n + j] = bumpyHeight(x, z);
    }
  }
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(
    RAPIER.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: 2 * half, y: 1, z: 2 * half }).setFriction(1.0),
    body,
  );
}

export interface SpawnedVehicle {
  vehicle: SoftVehicle;
  world: RAPIER.World;
  step: (input: Partial<InputState>) => void;
  /** Total tilt of the chassis up-axis away from world up, degrees. */
  tiltDeg: () => number;
}

const IDLE: InputState = { steer: 0, throttle: 0, brake: 0, recover: false };

/** Spawn a SoftVehicle on the given ground and return tick helpers. */
export async function spawn(
  world: RAPIER.World,
  x: number,
  z: number,
  ground: 'flat' | 'bumpy',
): Promise<SpawnedVehicle> {
  const heightAt = ground === 'bumpy' ? bumpyHeight : null;
  const vehicle = new SoftVehicle({
    ...(heightAt ? { heightAt } : {}),
    surfaceAt: () => 0, // SURFACE_TRAIL everywhere in these tests
  });
  await vehicle.init(world);
  vehicle.place(x, z);

  // Let it settle onto its suspension before any driving input.
  for (let i = 0; i < 90; i++) {
    vehicle.fixedUpdate(TICK_DT, IDLE);
  }

  return {
    vehicle,
    world,
    step(input: Partial<InputState>): void {
      vehicle.fixedUpdate(TICK_DT, { ...IDLE, ...input });
    },
    tiltDeg(): number {
      const q = vehicle.transform;
      const u = quatUp({ x: q.qx, y: q.qy, z: q.qz, w: q.qw });
      return (Math.acos(Math.max(-1, Math.min(1, u.y))) * 180) / Math.PI;
    },
  };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}
type Quat = { x: number; y: number; z: number; w: number };

function quatUp(q: Quat): Vec3 {
  const lx = 0;
  const ly = 1;
  const lz = 0;
  const ix = q.w * lx + q.y * lz - q.z * ly;
  const iy = q.w * ly + q.z * lx - q.x * lz;
  const iz = q.w * lz + q.x * ly - q.y * lx;
  const iw = -q.x * lx - q.y * ly - q.z * lz;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/** Deterministic scripted inputs over simulated time (no Math.random). */
export function scriptInput(tSec: number): InputState {
  return {
    steer: Math.sin(tSec / 2.3),
    throttle: 0.5 + 0.5 * Math.sin(tSec / 5.1),
    brake: Math.max(0, Math.sin(tSec / 7.7)) > 0.93 ? 0.6 : 0,
    recover: false,
  };
}
