import * as THREE from 'three/webgpu';
import {
  ParticleBuffers,
  BIRD_FLUSH_RANGE_M,
  FIREFLY_NIGHT_COUNT,
  spawnDecision,
  type LightPhase,
  type WeatherKind,
} from './particles';

/**
 * FxWorld — life-and-particles facade.
 *
 * Owns every ambient particle system: rain, fireflies, dust motes,
 * falling leaves, and flushing birds. All state lives in preallocated
 * pools; `fixedUpdate` is allocation-free. Rendering attaches via the
 * exported Points objects (`points.rain` etc.) — one THREE.Points per
 * system, positions written in place from the pools each frame.
 *
 * Sky coupling is injected as a plain getter so fx never imports sky/.
 * CALM guarantees: reduced motion empties and freezes everything;
 * rates drift with a seeded noise rather than pulsing on a clock.
 */

export interface FxSkySnapshot {
  readonly weather: WeatherKind;
  readonly phase: LightPhase;
}

export interface FxWorldOptions {
  seed?: number;
  /** Max simultaneous rain particles. */
  rainCapacity?: number;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a ^ (a >>> 15);
    t = Math.imul(t, t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class FxWorld {
  /** Add these to the scene; all are optional to render. */
  readonly points: {
    rain: THREE.Points;
    fireflies: THREE.Points;
    motes: THREE.Points;
    leaves: THREE.Points;
    birds: THREE.Points;
  };

  private readonly rng: () => number;
  private readonly rain: ParticleBuffers;
  private readonly fireflies: ParticleBuffers;
  private readonly motes: ParticleBuffers;
  private readonly leaves: ParticleBuffers;
  private readonly birds: ParticleBuffers;
  private time = 0;

  private readonly geoms: THREE.BufferGeometry[] = [];
  private reducedMotion_ = false;

  constructor(options: FxWorldOptions = {}) {
    this.rng = mulberry(options.seed ?? 0xfacade);
    this.rain = new ParticleBuffers(options.rainCapacity ?? 1200);
    this.fireflies = new ParticleBuffers(FIREFLY_NIGHT_COUNT);
    this.motes = new ParticleBuffers(220);
    this.leaves = new ParticleBuffers(140);
    this.birds = new ParticleBuffers(48);

    const mk = (buf: ParticleBuffers, color: number, size: number): THREE.Points => {
      const geom = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(buf.capacity * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      geom.setAttribute('position', pos);
      // Simple depth-tested material; TSL upgrade lands with post pass.
      const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.75, depthWrite: false });
      const pts = new THREE.Points(geom, mat);
      pts.frustumCulled = false;
      pts.count = 0;
      this.geoms.push(geom);
      return pts;
    };

    this.points = {
      rain: mk(this.rain, 0x9db4c4, 0.06),
      fireflies: mk(this.fireflies, 0xd8e26a, 0.12),
      motes: mk(this.motes, 0xe6dcc6, 0.05),
      leaves: mk(this.leaves, 0x8a7a3a, 0.09),
      birds: mk(this.birds, 0x2a2a2a, 0.22),
    };
  }

  setReducedMotion(on: boolean): void {
    this.reducedMotion_ = on;
    for (const b of [this.rain, this.fireflies, this.motes, this.leaves, this.birds]) {
      b.setReducedMotion(on);
    }
  }

  get reducedMotion(): boolean {
    return this.reducedMotion_;
  }

  /**
   * Fixed-tick update. Allocation-free by design.
   * `carX/carZ` drive bird flushes; `groundYAt` should approximate local
   * terrain height for rain kill-planes (pass a constant if unknown).
   */
  fixedUpdate(
    dt: number,
    sky: FxSkySnapshot,
    carX: number,
    carZ: number,
    groundYAt: (x: number, z: number) => number,
  ): void {
    this.time += dt;
    const windX = Math.sin(this.time * 0.13) * 0.6;
    const windZ = Math.cos(this.time * 0.09) * 0.5;

    // --- rain ---------------------------------------------------------------
    if (!this.reducedMotion_) {
      const intensity = sky.weather === 'rain' ? 0.9 : sky.weather === 'drizzle' ? 0.45 : 0;
      let spawns = 0;
      while (spawns < 24 && spawnDecision(sky.weather, intensity, this.rng())) {
        const ang = this.rng() * Math.PI * 2;
        const r = 6 + this.rng() * 34;
        const x = carX + Math.cos(ang) * r;
        const z = carZ + Math.sin(ang) * r;
        const y = groundYAt(x, z) + 14 + this.rng() * 6;
        this.rain.spawn(this.rng(), x, y, z, windX * 0.3, -16 - this.rng() * 4, windZ * 0.3, 3);
        spawns++;
      }
      this.rain.step(dt, windX * 0.2, windZ * 0.2, groundYAt(carX, carZ) - 0.5);
    } else {
      this.rain.step(dt, 0, 0);
    }

    // --- fireflies (night only; drift, never blink on a clock) ----------------
    if (sky.phase === 'night') {
      while (this.fireflies.alive < FIREFLY_NIGHT_COUNT && !this.reducedMotion_) {
        const ang = this.rng() * Math.PI * 2;
        const r = 10 + this.rng() * 40;
        const x = carX + Math.cos(ang) * r;
        const z = carZ + Math.sin(ang) * r;
        this.fireflies.spawn(
          this.rng(),
          x,
          groundYAt(x, z) + 0.6 + this.rng() * 1.8,
          z,
          0,
          0,
          0,
          30 + this.rng() * 40,
        );
      }
      // Drift via per-particle sine wander baked into step's wind terms.
      this.fireflies.step(
        dt,
        Math.sin(this.time * 0.35) * 0.5,
        Math.cos(this.time * 0.27) * 0.4,
      );
    } else {
      this.fireflies.step(dt, 0, 0); // age out at dawn
    }

    // --- dust motes (daylight; slow float near the car) ----------------------
    if ((sky.phase === 'morning' || sky.phase === 'goldenHour') && !this.reducedMotion_) {
      while (this.motes.alive < this.motes.capacity) {
        const ang = this.rng() * Math.PI * 2;
        const r = this.rng() * 18;
        const x = carX + Math.cos(ang) * r;
        const z = carZ + Math.sin(ang) * r;
        this.motes.spawn(this.rng(), x, groundYAt(x, z) + 1 + this.rng() * 5, z, 0, 0, 0, 12 + this.rng() * 20);
      }
      this.motes.step(dt * 0.4, Math.sin(this.time * 0.21) * 0.25, 0);
    } else {
      this.motes.step(dt, 0, 0);
    }

    // --- falling leaves near trees (sparse; calm spiral) ---------------------
    if (!this.reducedMotion_ && this.leaves.alive < this.leaves.capacity && this.rng() < 0.12) {
      const ang = this.rng() * Math.PI * 2;
      const r = 8 + this.rng() * 26;
      const x = carX + Math.cos(ang) * r;
      const z = carZ + Math.sin(ang) * r;
      this.leaves.spawn(this.rng(), x, groundYAt(x, z) + 6 + this.rng() * 6, z, 0, -0.55, 0, 14);
    }
    this.leaves.step(
      dt,
      Math.sin(this.time * 0.5 + 1.3) * 0.9,
      Math.cos(this.time * 0.42) * 0.7,
    );

    // --- birds: flush when the car closes within range ------------------------
    this.birds.step(dt, 0, 0);

    // --- publish positions into the render attributes (no allocation) --------
    this.publish(this.points.rain.geometry, this.rain);
    this.publish(this.points.fireflies.geometry, this.fireflies);
    this.publish(this.points.motes.geometry, this.motes);
    this.publish(this.points.leaves.geometry, this.leaves);
    this.publish(this.points.birds.geometry, this.birds);
  }

  /** Birds react to the car explicitly (called from the vehicle tick). */
  flushBirdsNear(carX: number, carZ: number, treeX: number, treeZ: number): void {
    const d = Math.hypot(treeX - carX, treeZ - carZ);
    if (d > BIRD_FLUSH_RANGE_M) return;
    const dx = (treeX - carX) / (d || 1);
    const dz = (treeZ - carZ) / (d || 1);
    this.birds.spawn(this.rng(), treeX, 2.5, treeZ, dx * 7, 3.5, dz * 7, 6);
  }

  private publish(geom: THREE.BufferGeometry, buf: ParticleBuffers): void {
    const attr = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const d = buf.data;
    const n = Math.min(buf.alive, buf.capacity);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = d[i * 9] ?? 0;
      arr[i * 3 + 1] = d[i * 9 + 1] ?? 0;
      arr[i * 3 + 2] = d[i * 9 + 2] ?? 0;
    }
    attr.needsUpdate = true;
    geom.setDrawRange(0, n);
  }

  stats(): Record<string, number> {
    return {
      rain: this.rain.alive,
      fireflies: this.fireflies.alive,
      motes: this.motes.alive,
      leaves: this.leaves.alive,
      birds: this.birds.alive,
      reducedMotion: this.reducedMotion_ ? 1 : 0,
    };
  }

  dispose(): void {
    for (const g of this.geoms) g.dispose();
    this.geoms.length = 0;
  }
}
