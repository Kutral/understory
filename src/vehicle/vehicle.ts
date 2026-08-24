import RAPIER from '@dimforge/rapier3d-compat';
import type {
  World as RapierWorld,
  RigidBody,
  Collider,
  DynamicRayCastVehicleController,
} from '@dimforge/rapier3d-compat';
import type { VehicleController, VehicleState } from '@contracts/vehicle';
import type { InputState } from '@contracts/input';
import {
  SOFT_TUNING,
  MAX_ENGINE_FORCE_N,
  MAX_STEER_RAD,
  STEER_RATE,
  STEER_RETURN_RATE,
  DAMPING_COMPRESSION,
  DAMPING_RELAXATION,
  MAX_SUSPENSION_FORCE_N,
  BRAKE_STRENGTH,
  TOP_SPEED_MS,
  engineEffort,
} from './tuning';
import { surfaceResponse } from './surfaces';
import { updateSteering, clamp } from './vehicle-math';
import { createPlaceholderWagon } from './chassis-placeholder';

/**
 * Understory wagon (agent C). Rapier DynamicRayCastVehicleController tuned
 * SOFT: CALM overrides everything. See docs/notes/vehicle-input.md for the
 * full tuning rationale and measured numbers.
 *
 * Frame contract: this phase owns rapier world.step() (contracts/frame.ts),
 * so fixedUpdate = pre-step input application -> updateVehicle -> world.step
 * -> post-step softening/state.
 */

let rapierReady: Promise<void> | null = null;
function ensureRapier(): Promise<void> {
  rapierReady ??= RAPIER.init();
  return rapierReady;
}

export interface VehicleOptions {
  /** Terrain mask sampler from the world subsystem (SURFACE_* codes). */
  readonly surfaceAt?: (x: number, z: number) => number;
  /** Terrain height for spawn placement; defaults to flat 0. */
  readonly heightAt?: (x: number, z: number) => number;
  /** Optional scene to attach the PLACEHOLDER chassis mesh (visual pass replaces it). */
  readonly scene?: { add: (o: object) => void };
  /** Soft tree-thud hook for audio/fx, severity 0..1. */
  readonly onThud?: (severity: number) => void;
}

interface WheelDef {
  readonly x: number;
  readonly z: number;
  readonly front: boolean;
}

/** Forward = +Z local, up = +Y, axle = X (matches chassis-placeholder mesh). */
const WHEELS: readonly WheelDef[] = [
  { x: -0.78, z: 1.25, front: true },
  { x: 0.78, z: 1.25, front: true },
  { x: -0.78, z: -1.3, front: false },
  { x: 0.78, z: -1.3, front: false },
];

const WHEEL_RADIUS_M = 0.34;
const SUSPENSION_REST_M = 0.55;

// Tree-thud softening constants.
const THUD_MIN_INTO_SPEED_MS = 1.0;
const THUD_KEEP_FRACTION = 0.35; // how much of the into-obstacle speed survives
const THUD_NUDGE_MS = 1.2; // sideways slide-away speed added

// Auto-recover (gentle, only after being tipped a while).
const AUTO_RECOVER_TILT_COS = 0.35; // up.y below this counts as "tipped"
const AUTO_RECOVER_DELAY_S = 1.5;
const RECOVER_DURATION_S = 1.4;
/** Righting torque impulse coefficient (N·m·s per second of hold, scaled by tilt). */
const RECOVER_TORQUE = 17000;

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Rotate a local axis (1=+Y up, 2=+Z forward) by quaternion q -> world dir. */
function quatAxis(q: { x: number; y: number; z: number; w: number }, axis: 1 | 2): Vec3Like {
  const lx = 0;
  const ly = axis === 1 ? 1 : 0;
  const lz = axis === 1 ? 0 : 1;
  // v' = q * v * q*  (expanded quaternion sandwich)
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

function signedForwardSpeed(lv: Vec3Like, fwd: Vec3Like): number {
  return lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z;
}

export class SoftVehicle implements VehicleController {
  readonly state: VehicleState = {
    speedMs: 0,
    rpm01: 0,
    gear: 'N',
    surface: 1,
    airborneWheels: 4,
  };

  private world: RapierWorld | null = null;
  private body: RigidBody | null = null;
  private chassisCollider: Collider | null = null;
  private vehicle: DynamicRayCastVehicleController | null = null;
  private mesh: ReturnType<typeof createPlaceholderWagon> | null = null;

  private steerRad = 0;
  private recoverTimer = 0;
  private tippedFor = 0;
  private rpmSmooth = 0;
  private gravityEased = false;

  /** Last-tick transform snapshot (world space) for camera/render/UI readers. */
  readonly transform = { px: 0, py: 0, pz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  /** Direct chassis body access for camera rig/debug/tests (read-only intent). */
  get chassisBody(): RigidBody | null {
    return this.body;
  }

  constructor(private readonly opts: VehicleOptions = {}) {}

  async init(world: unknown): Promise<void> {
    await ensureRapier();
    this.world = world as RapierWorld;
    const w = this.world;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, 3, 0)
      .setCanSleep(false)
      .setLinearDamping(0.012)
      .setAngularDamping(1.4); // heavy rotational damping = calm responses
    this.body = w.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.cuboid(0.8, 0.42, 1.95)
      .setTranslation(0, 0.12, 0)
      .setDensity(190) // ≈ 1000 kg estate wagon
      .setFriction(0.35)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
      .setRestitution(0); // no bounce off trunks
    this.chassisCollider = w.createCollider(colDesc, this.body);

    const v = new RAPIER.DynamicRayCastVehicleController(
      this.body,
      w.broadPhase,
      w.narrowPhase,
      w.bodies,
      w.colliders,
    );
    v.indexUpAxis = 1; // setIndexForwardAxis is a JS property-setter quirk:
    v.setIndexForwardAxis = 2; // both are declared as accessor pairs in rapier.d.ts

    WHEELS.forEach((def, i) => {
      v.addWheel(
        { x: def.x, y: 0.1, z: def.z },
        { x: 0, y: -1, z: 0 },
        { x: -1, y: 0, z: 0 },
        SUSPENSION_REST_M,
        WHEEL_RADIUS_M,
      );
      v.setWheelMaxSuspensionTravel(i, SOFT_TUNING.suspensionTravelM);
      v.setWheelSuspensionStiffness(i, SOFT_TUNING.suspensionStiffness);
      v.setWheelSuspensionCompression(i, DAMPING_COMPRESSION);
      v.setWheelSuspensionRelaxation(i, DAMPING_RELAXATION);
      v.setWheelMaxSuspensionForce(i, MAX_SUSPENSION_FORCE_N);
      // gripRear >= gripFront: understeer-biased, never an oversteer trap.
      v.setWheelFrictionSlip(i, def.front ? SOFT_TUNING.gripFront : SOFT_TUNING.gripRear);
      v.setWheelSideFrictionStiffness(i, 1.0);
      v.setWheelBrake(i, 0);
      v.setWheelEngineForce(i, 0);
      v.setWheelSteering(i, 0);
    });

    this.vehicle = v;

    if (this.opts.scene !== undefined) {
      // ⚠️ placeholder visual — see chassis-placeholder.ts header.
      this.mesh = createPlaceholderWagon();
      this.opts.scene.add(this.mesh);
    }
  }

  place(x: number, z: number): void {
    const body = this.requireBody();
    const h = this.opts.heightAt ? this.opts.heightAt(x, z) : 0;
    body.setTranslation({ x, y: h + SUSPENSION_REST_M + WHEEL_RADIUS_M + 0.6, z }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerRad = 0;
    this.recoverTimer = 0;
    this.tippedFor = 0;
    this.gravityEased = false;
  }

  /** Manual gentle righting (the Recover key / touch button / pad Y). */
  recover(): void {
    this.recoverTimer = RECOVER_DURATION_S;
  }

  fixedUpdate(dt: number, input: Readonly<InputState>): void {
    const v = this.vehicle;
    const body = this.body;
    const w = this.world;
    if (!v || !body || !w) throw new Error('SoftVehicle.fixedUpdate before init');

    // Recover key: gentle righting for a short window.
    if (input.recover) this.recover();

    // --- pre-step: inputs -> controller -----------------------------------
    const fwd = quatAxis(body.rotation(), 2); // local +Z in world space
    const lv = body.linvel();
    const speedFwd = signedForwardSpeed(lv, fwd);

    // Steering (rate-limited pure function — see vehicle-math.ts).
    this.steerRad = updateSteering(this.steerRad, input.steer, Math.abs(speedFwd), dt, {
      maxSteerRad: MAX_STEER_RAD,
      steerRate: STEER_RATE,
      returnRate: STEER_RETURN_RATE,
    });
    v.setWheelSteering(0, this.steerRad);
    v.setWheelSteering(1, this.steerRad);

    // Surface under the car drives all multipliers this tick.
    const t = body.translation();
    const surfCode = this.opts.surfaceAt ? this.opts.surfaceAt(t.x, t.z) : 1;
    const surf = surfaceResponse(surfCode);

    // Gear behaviour: S/Down becomes reverse once nearly stopped (automatic,
    // no gear lever to learn — CALM).
    let driveForce = 0;
    let brakeAmount = 0;
    const wantsReverse = input.brake > 0 && !input.throttle && speedFwd < 0.5;

    if (input.throttle > 0 && speedFwd > -0.5) {
      // Forward drive with cubic falloff so 85 km/h feels like 40.
      driveForce =
        input.throttle * MAX_ENGINE_FORCE_N * engineEffort(speedFwd) * surf.engineMul;
    } else if (input.throttle > 0 && speedFwd <= -0.5) {
      brakeAmount += BRAKE_STRENGTH * input.throttle * 0.6; // braking out of reverse
    } else if (wantsReverse) {
      driveForce =
        -input.brake * MAX_ENGINE_FORCE_N * 0.45 * engineEffort(-speedFwd) * surf.engineMul;
    } else if (input.brake > 0) {
      brakeAmount += BRAKE_STRENGTH * input.brake;
    }

    // Engine braking + rolling resistance when coasting: strong enough to
    // stop the car without touching the pedal, easing out near zero so it
    // glides to a halt instead of clamping (floor keeps the last crawl
    // decaying too).
    const coasting = input.throttle < 0.05 && !wantsReverse;
    if (coasting && Math.abs(speedFwd) > 0.02) {
      const engBrake =
        SOFT_TUNING.engineBrakeTorque * clamp(Math.abs(speedFwd) / 4, 0.3, 1);
      brakeAmount += engBrake + surf.rollBrake * 0.8;
    }

    for (let i = 0; i < v.numWheels(); i++) {
      const front = i < 2;
      const share = front ? 0.4 : 0.6; // slightly rear-biased AWD = stable
      v.setWheelEngineForce(i, driveForce * share);
      // Space folds into brake at reduced strength; bias it rearward for a
      // handbrake feel that cannot spin the car.
      const handbraking = coasting && input.brake > 0;
      const bias = handbraking ? (front ? 0.45 : 0.75) : front ? 0.55 : 0.45;
      v.setWheelBrake(i, brakeAmount * bias);
    }

    // --- physics step ------------------------------------------------------
    v.updateVehicle(dt);
    w.step();

    // --- post-step: thud softening, recovery, state ------------------------
    this.softenTreeImpacts();
    this.updateRecovery(dt);
    this.syncState();

    void fwd;
  }

  dispose(): void {
    if (!this.world) return;
    this.vehicle?.free();
    this.vehicle = null;
    if (this.body) this.world.removeRigidBody(this.body);
    this.body = null;
    this.chassisCollider = null;
    this.mesh?.removeFromParent();
    this.mesh = null;
    this.world = null;
  }

  // -------------------------------------------------------------------------

  private requireBody(): RigidBody {
    if (!this.body) throw new Error('SoftVehicle.place/init required first');
    return this.body;
  }

  /**
   * Trees nudge you off with a soft thud instead of a wall-stop: any chassis
   * contact whose world normal is mostly horizontal (trunks, boulders) has its
   * into-obstacle velocity damped to ~35 % plus a gentle sideways slide-away.
   * Ground contacts (vertical normals) are untouched.
   */
  private softenTreeImpacts(): void {
    const w = this.world;
    const col = this.chassisCollider;
    const body = this.body;
    if (!w || !col || !body) return;
    const me = body.translation();
    w.contactPairsWith(col, (other) => {
      const ot = other.translation();
      w.contactPair(col, other, (manifold) => {
        const n = manifold.normal();
        // Orient the normal away from the other collider toward us.
        const dx = me.x - ot.x;
        const dz = me.z - ot.z;
        const len = Math.hypot(dx, dz) || 1;
        let nx = n.x;
        let nz = n.z;
        if ((nx * dx + nz * dz) / len < 0) {
          nx = -nx;
          nz = -nz;
        }
        // Mostly-horizontal normal => trunk/boulder-like contact.
        if (Math.abs(n.y) > 0.6) return;
        const lv = body.linvel();
        const into = -(lv.x * nx + lv.z * nz);
        if (into < THUD_MIN_INTO_SPEED_MS) return;
        const vnAfter = into * THUD_KEEP_FRACTION;
        const nvx = lv.x + nx * (into - vnAfter);
        const nvz = lv.z + nz * (into - vnAfter);
        // Nudge: slide away along the tangent, sign chosen by approach side.
        const sideSign = lv.x * -nz + lv.z * nx >= 0 ? 1 : -1;
        body.setLinvel(
          {
            x: nvx + -nz * sideSign * THUD_NUDGE_MS,
            z: nvz + nx * sideSign * THUD_NUDGE_MS,
            y: lv.y,
          },
          true,
        );
        this.opts.onThud?.(Math.min(1, into / 12));
      });
    });
  }

  /** Gentle righting torque while recovering; also auto-triggers when tipped. */
  private updateRecovery(dt: number): void {
    const body = this.body;
    if (!body) return;
    const up = quatAxis(body.rotation(), 1);
    if (up.y < AUTO_RECOVER_TILT_COS) {
      this.tippedFor += dt;
      if (this.tippedFor > AUTO_RECOVER_DELAY_S) {
        this.recoverTimer = RECOVER_DURATION_S;
      }
    } else {
      this.tippedFor = 0;
    }

    if (this.recoverTimer <= 0) {
      if (this.gravityEased) {
        body.setGravityScale(1, true);
        this.gravityEased = false;
      }
      return;
    }
    this.recoverTimer -= dt;
    if (!this.gravityEased) {
      // Lighten the car so a gentle roll can actually start (CALM: no launch).
      body.setGravityScale(0.3, true);
      this.gravityEased = true;
    }

    // Damp spin, then ease the local up axis toward world up with a torque
    // impulse around cross(up, worldUp) = (-up.z, 0, up.x).
    const av = body.angvel();
    body.setAngvel({ x: av.x * 0.82, y: av.y * 0.82, z: av.z * 0.82 }, true);
    let ax = -up.z;
    let az = up.x;
    const axisLen = Math.hypot(ax, az);
    if (axisLen < 0.05) {
      ax = 1; // degenerate perfectly-inverted pose: pick any horizontal axis
      az = 0;
    } else {
      ax /= axisLen;
      az /= axisLen;
    }
    const strength = RECOVER_TORQUE * dt * clamp(1 - up.y, 0, 2);
    body.applyTorqueImpulse({ x: ax * strength, y: 0, z: az * strength }, true);
  }

  private syncState(): void {
    const body = this.body;
    const v = this.vehicle;
    if (!body || !v) return;

    if (this.mesh) {
      const t = body.translation();
      const r = body.rotation();
      this.mesh.position.set(t.x, t.y, t.z);
      this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      // Spin wheel visuals from Rapier's own rotation accumulator. Wheel
      // child names are wheelLF/RF/LR/RR in chassis-placeholder.ts.
      const names = ['wheelLF', 'wheelRF', 'wheelLR', 'wheelRR'];
      for (let i = 0; i < 4; i++) {
        const wm = this.mesh.getObjectByName(names[i] ?? '');
        if (wm) wm.rotation.x = v.wheelRotation(i) ?? 0;
      }
    }

    const lv = body.linvel();
    const fwd = quatAxis(body.rotation(), 2);
    const speedFwd = signedForwardSpeed(lv, fwd);
    const t = body.translation();

    let airborne = 0;
    for (let i = 0; i < v.numWheels(); i++) if (!v.wheelIsInContact(i)) airborne++;
    this.state.airborneWheels = airborne;
    this.state.speedMs = speedFwd;

    const rpmTarget = clamp(Math.abs(speedFwd) / TOP_SPEED_MS + 0.08, 0.08, 1);
    this.rpmSmooth += (rpmTarget - this.rpmSmooth) * 0.12;
    this.state.rpm01 = this.rpmSmooth;
    this.state.gear = speedFwd < -0.3 ? 'R' : Math.abs(speedFwd) < 0.15 ? 'N' : 'D';
    this.state.surface = this.opts.surfaceAt ? this.opts.surfaceAt(t.x, t.z) : 1;

    const r = body.rotation();
    this.transform.px = t.x;
    this.transform.py = t.y;
    this.transform.pz = t.z;
    this.transform.qx = r.x;
    this.transform.qy = r.y;
    this.transform.qz = r.z;
    this.transform.qw = r.w;
  }
}
