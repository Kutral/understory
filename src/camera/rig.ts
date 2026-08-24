import type { CameraRig } from '@contracts/camera';

/** camera agent (part of A/C integration; stub holds a static transform). */
export class StubCameraRig implements CameraRig {
  fixedUpdate(): void {}
  render(): void {}
  setPhotoMode(): void {}
  setHorizonLock(): void {}
  dispose(): void {}
}
