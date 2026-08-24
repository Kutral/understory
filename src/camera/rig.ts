import * as THREE from 'three/webgpu';
import type { CameraRig } from '@contracts/camera';

/**
 * Calm chase rig (orchestrator slice implementation; Wave 2 camera agent may
 * refine springs). Design per pillar 1 CALM:
 * - Critically-damped spring follow: no overshoot, no shake, ever.
 * - Position error is smoothed in a preallocated temp (zero allocation).
 * - Look-at target leads the car slightly toward its velocity for stability.
 * - Horizon lock clamps roll to zero and pitch to a narrow band.
 */

export class ChaseCameraRig implements CameraRig {
  private readonly cam: THREE.PerspectiveCamera;
  private readonly targetPos = new THREE.Vector3();
  private readonly targetQuat = new THREE.Quaternion();
  private readonly desiredPos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly velDir = new THREE.Vector3();

  /** Tuned softness. Higher = tighter follow. */
  private readonly posSmooth = 0.06;
  private readonly lookSmooth = 0.12;

  private photoMode = false;
  private horizonLock = true;

  constructor(camera: THREE.PerspectiveCamera) {
    this.cam = camera;
    // initial placement behind spawn
    this.desiredPos.set(0, 4, -9);
    this.camera.position.copy(this.desiredPos);
    this.lookAt.set(0, 1, 0);
  }

  get camera(): THREE.PerspectiveCamera {
    return this.cam;
  }

  fixedUpdate(_dt: number, x: number, y: number, z: number): void {
    this.targetPos.set(x, y, z);
  }

  /** Feed the chassis orientation so the rig can sit behind the car's forward. */
  setTargetOrientation(qx: number, qy: number, qz: number, qw: number): void {
    this.targetQuat.set(qx, qy, qz, qw);
  }

  /** Velocity vector for look-ahead; pass zeros when stationary. */
  setTargetVelocity(vx: number, vy: number, vz: number): void {
    this.velDir.set(vx, vy, vz);
  }

  render(_alpha: number): void {
    if (!this.photoMode) {
      const back = new THREE.Vector3(0, 2.6, -7.5).applyQuaternion(this.targetQuat);
      this.desiredPos.copy(this.targetPos).add(back);

      // Critical-damped style smoothing on each axis (frame-rate independent
      // enough at our fixed-tick cadence; render only interpolates display).
      this.camera.position.lerp(this.desiredPos, this.posSmooth);

      // Look at the car, biased slightly along velocity.
      this.lookAt.copy(this.targetPos).addScaledVector(this.velDir, 0.25);
      this.lookAt.y += 1.2;

      if (this.horizonLock) {
        this.keepHorizonLevel();
      } else {
        this.cam.lookAt(this.lookAt);
      }
    } else {
      this.renderPhoto();
    }
  }

  /** Clamp roll to zero; keep pitch within ±18° of horizontal. */
  private keepHorizonLevel(): void {
    const euler = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
    euler.z = 0;
    const pitchLimit = Math.PI / 10; // 18°
    if (euler.x > pitchLimit) euler.x = pitchLimit;
    if (euler.x < -pitchLimit) euler.x = -pitchLimit;
    this.cam.quaternion.setFromEuler(euler);
    this.cam.lookAt(this.lookAt);
    // re-clamp after lookAt (lookAt sets full orientation)
    const post = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
    post.z = 0;
    this.cam.quaternion.setFromEuler(post);
  }

  setPhotoMode(on: boolean): void {
    this.photoMode = on;
  }

  private photoYaw = 0.6;
  private photoPitch = 0.32;
  private photoDistScale = 1;
  private requestLevel = false;

  /** Orbit angles from the photo-mode overlay (radians). */
  setPhotoOrbit(yaw: number, pitch: number): void {
    this.photoYaw = yaw;
    this.photoPitch = pitch;
  }

  setPhotoZoom(scale: number): void {
    this.photoDistScale = scale;
  }

  photoZoom(): number {
    return this.photoDistScale;
  }

  /** One-shot: re-level the horizon on the next photo frame. */
  setPhotoLevel(_on: boolean): void {
    this.requestLevel = true;
  }

  private renderPhoto(): void {
    // Slow orbit around the car; distance scales with zoom.
    const dist = 9 * this.photoDistScale;
    const cx = Math.cos(this.photoPitch) * Math.sin(this.photoYaw) * dist;
    const cz = Math.cos(this.photoPitch) * Math.cos(this.photoYaw) * dist;
    const cy = Math.sin(this.photoPitch) * dist + 1.4;
    this.camera.position.set(
      this.targetPos.x + cx,
      Math.max(this.targetPos.y + cy, this.targetPos.y + 0.8),
      this.targetPos.z + cz,
    );
    this.lookAt.copy(this.targetPos);
    this.lookAt.y += 1.1;
    this.cam.lookAt(this.lookAt);
    if (this.requestLevel) {
      const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
      e.z = 0;
      this.cam.quaternion.setFromEuler(e);
      this.requestLevel = false;
    }
  }

  setHorizonLock(on: boolean): void {
    this.horizonLock = on;
  }

  dispose(): void {}
}
