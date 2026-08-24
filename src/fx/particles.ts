/**
 * fx/particles — life-and-particles core (Wave 2).
 *
 * Pure simulation + preallocated buffers; rendering attaches separately in
 * particles-render.ts. CALM rules enforced here:
 *   - nothing pulses at a fixed rhythm (all rates drift with noise),
 *   - reduced motion kills every system and blocks spawning,
 *   - zero allocation per frame (fixed Float32 pools, swap-remove recycle).
 */

export type WeatherKind = 'clear' | 'mist' | 'drizzle' | 'rain' | 'after-rain';
export type LightPhase = 'dawn' | 'morning' | 'goldenHour' | 'dusk' | 'blueHour' | 'night';

/** Rain spawn rate at full intensity (particles/second). Calm, not a storm. */
export const RAIN_RATE = 700;
/** Firefly population at night. Sparse on purpose. */
export const FIREFLY_NIGHT_COUNT = 96;
/** Birds flush when the car gets within this range of a tree. */
export const BIRD_FLUSH_RANGE_M = 15;

/**
 * Whether to emit one rain particle this tick. `intensity` is the weather
 * strength [0..1]; `roll` an external rng sample so callers stay
 * deterministic. Clear/mist never rain.
 */
export function spawnDecision(weather: WeatherKind, intensity: number, roll: number): boolean {
  if (weather !== 'rain' && weather !== 'drizzle') return false;
  const base = weather === 'rain' ? RAIN_RATE : RAIN_RATE * 0.35;
  // dt-normalised probability is applied by the caller via roll < p.
  const p = Math.min(1, base / 60_000 + intensity);
  return roll < p;
}

/**
 * Fixed-capacity particle pool in flat arrays. Swap-remove keeps `alive`
 * compact; capacity never changes after construction.
 *
 * Layout per particle: x, y, z, vx, vy, vz, age, life, seed01
 */
export class ParticleBuffers {
  readonly data: Float32Array;
  readonly capacity: number;
  alive = 0;
  private reduced = false;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * 9);
  }

  setReducedMotion(on: boolean): void {
    this.reduced = on;
    if (on) this.alive = 0;
  }

  get reducedMotion(): boolean {
    return this.reduced;
  }

  spawn(seed: number, x: number, y: number, z: number, vx = 0, vy = 0, vz = 0, lifeS = 4): void {
    if (this.reduced || this.alive >= this.capacity) return;
    const i = this.alive * 9;
    const d = this.data;
    d[i] = x;
    d[i + 1] = y;
    d[i + 2] = z;
    d[i + 3] = vx;
    d[i + 4] = vy;
    d[i + 5] = vz;
    d[i + 6] = 0; // age
    d[i + 7] = lifeS;
    d[i + 8] = seed % 1;
    this.alive++;
  }

  /** Swap-remove the particle at slot i (i must be < alive). */
  kill(i: number): void {
    const last = (this.alive - 1) * 9;
    const dst = i * 9;
    if (dst !== last) {
      for (let k = 0; k < 9; k++) {
        const v = this.data[last + k];
        this.data[dst + k] = v ?? 0;
      }
    }
    this.alive--;
  }

  /**
   * Advance physics: integrate velocity, age, kill expired or fallen
   * particles. `groundY` kills rain below the terrain plane.
   */
  step(dt: number, windX: number, windZ: number, groundY = -Infinity): void {
    if (this.reduced) {
      this.alive = 0;
      return;
    }
    for (let n = this.alive - 1; n >= 0; n--) {
      this.ageBy(n, dt);
      const i = n * 9;
      const d = this.data;
      d[i] = (d[i] ?? 0) + ((d[i + 3] ?? 0) + windX) * dt;
      d[i + 1] = (d[i + 1] ?? 0) + (d[i + 4] ?? 0) * dt;
      d[i + 2] = (d[i + 2] ?? 0) + ((d[i + 5] ?? 0) + windZ) * dt;
      const age = d[i + 6] ?? 0;
      const life = d[i + 7] ?? 1;
      if (age >= life || (d[i + 1] ?? 0) < groundY) this.kill(n);
    }
  }

  private ageBy(n: number, dt: number): void {
    const i = n * 9 + 6;
    this.data[i] = (this.data[i] ?? 0) + dt;
  }
}
