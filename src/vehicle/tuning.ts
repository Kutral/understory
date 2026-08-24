import type { VehicleTuning } from '@contracts/vehicle';
import { TOP_SPEED_KMH } from '@contracts/constants';

/**
 * SOFT tuning for the Understory estate wagon. CALM overrides everything:
 * long travel, heavy damping, understeer-biased grip, gentle forces.
 * These are the DEFAULTS the controller clamps to; per-surface multipliers
 * in surfaces.ts scale grip/engine on top. Matches contracts/vehicle.ts
 * `VehicleTuning` exactly (extra Rapier-specific knobs live below).
 */
export const SOFT_TUNING: VehicleTuning = {
  /** 0.45 m — mid-range of the mandated 0.35..0.55 window. */
  suspensionTravelM: 0.45,
  /** Low stiffness so bumps soak instead of kick (three.js example uses ~30). */
  suspensionStiffness: 24,
  /** High damping; split into compression/relaxation below (relax > compress). */
  suspensionDamping: 6.0,
  /**
   * Friction slip (grip). Rear >= front by design: the car can never spin
   * into an oversteer trap — it ploughs gently wide instead.
   */
  gripFront: 6.0,
  gripRear: 7.5,
  /**
   * Engine braking strength handed to setWheelBrake when coasting:
   * strong enough that lifting off coasts to a stop without the pedal
   * (measured in tests/vehicle-tuning.test.ts).
   */
  engineBrakeTorque: 16,
};

// --- Rapier-specific refinements of the contract knobs ---------------------

/** Damping while the spring compresses (hits). */
export const DAMPING_COMPRESSION = 5.2;
/** Damping while the spring extends; higher so it never overshoots/bounces. */
export const DAMPING_RELAXATION = 6.8;
/** Cap on raw suspension force (N) so landings stay soft. */
export const MAX_SUSPENSION_FORCE_N = 14000;
/** Brake impulse strength at full pedal, handed to setWheelBrake. */
export const BRAKE_STRENGTH = 14;
/** Handbrake adds this much extra brake on the rear axle only (Space). */
export const HANDBRAKE_STRENGTH = 8;

/** Top speed in m/s derived from the shared constant (85 km/h ≈ 23.61 m/s). */
export const TOP_SPEED_MS = TOP_SPEED_KMH / 3.6;

/**
 * Speed where the engine effort curve has spent most of its punch.
 * Above this the car still creeps toward TOP_SPEED_MS but feels done —
 * the "85 km/h that FEELS like 40" contract point.
 */
export const FEEL_DONE_SPEED_MS = 40 / 3.6;

/** Full-lock steering angle at standstill, radians (~31.5°). */
export const MAX_STEER_RAD = 0.55;
/** Steering rate toward a new target, rad/s (slow on purpose). */
export const STEER_RATE = 2.2;
/** Rate the wheel recenters when input releases, rad/s. */
export const STEER_RETURN_RATE = 3.4;

/**
 * Steering authority shrinks with speed so high-speed inputs are calm
 * sweeps rather than twitches: limit = 1 / (1 + v/14).
 */
export function steerLimitAtSpeed(speedMs: number): number {
  return 1 / (1 + Math.max(0, speedMs) / 14);
}

/** Total drive force available at the wheels at full throttle, Newtons. */
export const MAX_ENGINE_FORCE_N = 2600;

/**
 * Engine effort envelope vs forward speed: (1 - v/vMax)^1.5, so roughly
 * 60% of the punch is spent by ~40 km/h ("feels like 40") and the car
 * eases asymptotically toward TOP_SPEED_MS instead of slamming a limiter.
 * A low-speed tamer (0.3 -> 1 over the first ~11 m/s) keeps the launch
 * unhurried — power-brokered, not torque-slammed.
 */
export function engineEffort(speedMs: number): number {
  const v = Math.abs(speedMs);
  const x = Math.min(v / TOP_SPEED_MS, 1);
  const lowSpeedTamer = Math.min(1, 0.18 + v / 22);
  return Math.pow(1 - x, 1.5) * lowSpeedTamer;
}
