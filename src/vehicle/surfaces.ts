import { SURFACE_TRAIL, SURFACE_GRASS, SURFACE_MUD, SURFACE_ROCK } from '@contracts/world';

/**
 * Per-surface response for the wagon, keyed to the terrain mask codes.
 * Multipliers apply on top of SOFT_TUNING: grip scales wheelFrictionSlip,
 * side scales sideFrictionStiffness (lateral hold), engine scales drive
 * force, roll adds a speed-proportional brake while coasting.
 */
export interface SurfaceResponse {
  /** Longitudinal/traction grip multiplier. */
  readonly gripMul: number;
  /** Lateral friction multiplier — mud slides, rock holds. */
  readonly sideMul: number;
  /** Engine effectiveness multiplier. */
  readonly engineMul: number;
  /** Rolling-resistance brake strength added when coasting. */
  readonly rollBrake: number;
}

const TRAIL: SurfaceResponse = { gripMul: 1.0, sideMul: 1.0, engineMul: 1.0, rollBrake: 0.0 };
const GRASS: SurfaceResponse = { gripMul: 0.9, sideMul: 0.95, engineMul: 0.92, rollBrake: 0.5 };
const MUD: SurfaceResponse = { gripMul: 0.55, sideMul: 0.6, engineMul: 0.6, rollBrake: 1.6 };
const ROCK: SurfaceResponse = { gripMul: 0.8, sideMul: 1.05, engineMul: 0.95, rollBrake: 0.35 };

export const SURFACE_RESPONSES: Readonly<Record<number, SurfaceResponse>> = {
  [SURFACE_TRAIL]: TRAIL,
  [SURFACE_GRASS]: GRASS,
  [SURFACE_MUD]: MUD,
  [SURFACE_ROCK]: ROCK,
};

/** Unknown/missing mask values fall back to grass behaviour, never a crash. */
export function surfaceResponse(code: number): SurfaceResponse {
  return SURFACE_RESPONSES[code] ?? GRASS;
}
