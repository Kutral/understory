/**
 * Frame contract.
 *
 * LOOP SHAPE
 * - `renderer.setAnimationLoop(frame)` drives everything (WebGPU-safe).
 * - Each frame: accumulate wall dt (clamped to 0.25s), run 0..MAX_TICKS_PER_FRAME
 *   fixed TICK_DT ticks, then render once with interpolation alpha = acc/TICK_DT.
 *
 * UPDATE ORDER (per fixed tick):
 *   1. input      — sample keyboard/gamepad/touch into an immutable InputState signal
 *   2. vehicle    — rapier vehicle step (physics world.step inside this phase)
 *   3. world      — chunk streaming decisions + collider attach/detach (budgeted)
 *   4. flora      — density queries for newly streamed chunks, trunk colliders
 *   5. sky        — advance time-of-day + weather state machine
 *   6. fx         — particles/wildlife sim (reads sky + vehicle state)
 *   7. audio      — parameter updates from vehicle/sky signals
 *   8. ui         — signal store flushes to DOM at most once per FRAME (not per tick)
 *
 * RENDER (once per frame, after ticks):
 *   - interpolate vehicle + chase-camera transforms with alpha
 *   - camera rig update, then renderer.renderAsync via PostProcessing
 *
 * ALLOCATION RULES
 *   - No allocations inside any phase. All vectors/quaternions preallocated.
 *   - UI never touches the DOM during ticks; only the frame-boundary flush may.
 */

/** Ordered phases of one fixed tick. */
export const TICK_PHASES = [
  'input',
  'vehicle',
  'world',
  'flora',
  'sky',
  'fx',
  'audio',
] as const;

export type TickPhase = (typeof TICK_PHASES)[number];

/** A system participating in the fixed loop. */
export interface FixedSystem {
  readonly phase: TickPhase | 'render';
  /** Called once per fixed tick with TICK_DT. Must not allocate. */
  fixedUpdate(dt: number): void;
}

/** A system that renders once per animation frame. */
export interface RenderSystem {
  /** alpha in [0,1): interpolation fraction between last two ticks. */
  render(alpha: number): void;
}

/** Transform snapshot pair used to interpolate a body across ticks. */
export interface InterpolatedTransform {
  prev: Entity;
  curr: Entity;
}

import type { Entity } from './entity';
