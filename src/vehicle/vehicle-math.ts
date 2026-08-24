/**
 * Pure, deterministic vehicle/input math. No DOM, no Rapier, no allocation.
 * These are the functions the timestep-independence and deadzone unit tests
 * exercise directly.
 */

/** Clamp to [lo, hi]. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Analog deadzone with smoothstep rescale.
 * |v| <= dz -> 0; above dz the remaining span is remapped 0..1 through
 * smoothstep so small thumb deflections stay gentle (CALM) while full
 * deflection still reaches exactly ±1. Monotonic, sign-preserving, C1 at dz.
 */
export function applyDeadzone(v: number, dz: number): number {
  const a = Math.abs(v);
  if (!(dz >= 0 && dz < 1) || a <= dz) return 0;
  const n = (a - dz) / (1 - dz);
  return Math.sign(v) * n * n * (3 - 2 * n);
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function stepToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export interface SteeringParams {
  maxSteerRad: number;
  steerRate: number;
  returnRate: number;
}

/**
 * One fixed-tick steering update. Rate-limited approach to
 * input * maxSteer * speedLimit; recenters faster than it turns.
 * Depends ONLY on (current, steerInput, speedMs, dt) — no hidden state,
 * which is what makes render-rate independence provable.
 */
export function updateSteering(
  currentRad: number,
  steerInput: number,
  speedMs: number,
  dt: number,
  p: SteeringParams,
): number {
  const speedLimit = 1 / (1 + Math.max(0, speedMs) / 14);
  const target = clamp(steerInput, -1, 1) * p.maxSteerRad * speedLimit;
  const rate = Math.abs(target) < Math.abs(currentRad) ? p.returnRate : p.steerRate;
  return stepToward(currentRad, target, rate * dt);
}
