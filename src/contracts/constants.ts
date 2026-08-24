/**
 * Shared numeric constants. Orchestrator-owned; subsystems read, never write.
 */

/** Fixed simulation tick rate. Physics and gameplay run at this rate only. */
export const TICK_HZ = 60;

/** Seconds per fixed tick. */
export const TICK_DT = 1 / TICK_HZ;

/** Maximum catch-up ticks per rendered frame before we surrender time (spiral-of-death guard). */
export const MAX_TICKS_PER_FRAME = 5;

/** Chunk edge length in metres. */
export const CHUNK_SIZE_M = 128;

/** Terrain vertex grid resolution per chunk (vertices per side). */
export const CHUNK_GRID = 128 + 1;

/** Ring LOD count around the camera chunk (ring 0 = current chunk). */
export const CHUNK_RINGS = 5;

/** View distance implied by rings, in metres. */
export const VIEW_DISTANCE_M = CHUNK_RINGS * CHUNK_SIZE_M;

/** Rapier heightfield colliders exist only within this Chebyshev ring distance of the car. */
export const PHYSICS_RING_CHUNKS = 1;

/** Flora trunk colliders exist within this radius of the car, in metres. */
export const TRUNK_COLLIDER_RADIUS_M = 40;

/** Top speed target, km/h. The car must FEEL slower than this number. */
export const TOP_SPEED_KMH = 85;

/** A full day passes in this many real seconds when "let it drift" is enabled (40 minutes). */
export const DAY_CYCLE_REAL_SECONDS = 40 * 60;

/** Weather crossfade duration bounds, seconds. */
export const WEATHER_FADE_MIN_S = 30;
export const WEATHER_FADE_MAX_S = 60;

/** HUD hides after this many seconds of steady driving. */
export const HUD_IDLE_HIDE_S = 4;

/** Sitting still longer than this leaves a specimen mark on The Trace. */
export const IDLE_MARK_S = 20;
