/**
 * Camera rig contract. Chase rig with springs; photo camera is free.
 * Horizon lock and roll limits live here for motion-sickness comfort.
 */
export interface CameraRig {
  /** Chase target = interpolated vehicle transform. Must not allocate. */
  fixedUpdate(dt: number, targetX: number, targetY: number, targetZ: number): void;
  render(alpha: number): void;
  setPhotoMode(on: boolean): void;
  setHorizonLock(on: boolean): void;
  dispose(): void;
}
