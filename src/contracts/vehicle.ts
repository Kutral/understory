import type { InputState } from './input';

/**
 * Vehicle state read by camera, audio, fx, UI. Written only by the vehicle sim.
 */
export interface VehicleState {
  /** Metres per second, signed along forward axis. */
  speedMs: number;
  /** 0..1 normalised engine effort. */
  rpm01: number;
  /** Selected gear label for the dial ('D', 'R', 'N'). */
  gear: 'D' | 'R' | 'N';
  /** Surface under the wheels (SURFACE_* constant). */
  surface: number;
  /** Wheels off ground (0..4) — used for soft landings and audio. */
  airborneWheels: number;
}

export type VehicleInput = InputState;

/** Soft-tuning knobs the vehicle agent may adjust inside these bounds. */
export interface VehicleTuning {
  suspensionTravelM: number; // target range 0.35..0.55
  suspensionStiffness: number; // low end for softness
  suspensionDamping: number; // high damping, no bounce
  gripFront: number;
  gripRear: number; // >= gripFront - epsilon: never oversteer-trap
  engineBrakeTorque: number; // strong enough to coast to a stop
}

/**
 * The car controller over Rapier's DynamicRayCastVehicleController.
 * All tuning defers to CALM.
 */
export interface VehicleController {
  init(world: unknown /* rapier.World */): Promise<void>;
  /** Spawn at world position on terrain surface. */
  place(x: number, z: number): void;
  fixedUpdate(dt: number, input: Readonly<VehicleInput>): void;
  readonly state: VehicleState;
  /** Gentle auto-righting when tipped past threshold. */
  recover(): void;
  dispose(): void;
}
