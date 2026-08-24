/**
 * Photo mode (P): free-orbit camera around the car, framing guides,
 * horizon level toggle, plate caption, PNG export at 2x.
 *
 * The camera itself is driven through ChaseCameraRig.setPhotoMode — this
 * module owns only the DOM overlay + orbit input + export. Aperture is a
 * reported value for now: the DOF post pass lands with the fx/post owner;
 * noted honestly in docs/notes/the-trace.md.
 */
import type { ChaseCameraRig } from '../camera/rig';

export interface PlateCaption {
  seed: number;
  distanceM: number;
  timeOfDay: string;
  weather: string;
}

export interface PhotoModeHandle {
  readonly isActive: boolean;
  toggle(): void;
  update(dtS: number): void; // orbit inertia decay
  dispose(): void;
}

export function createPhotoMode(
  rig: ChaseCameraRig,
  getCaption: () => PlateCaption,
  capture2x: () => Promise<void>,
): PhotoModeHandle {
  let active = false;
  let yaw = 0.6;
  let pitch = 0.32;
  let yawVel = 0;
  let pitchVel = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const root = document.createElement('div');
  root.className = 'us-photo';
  root.hidden = true;
  root.innerHTML =
    `<div class="us-photo__guides" aria-hidden="true"></div>` +
    `<header class="us-photo__caption"></header>` +
    `<footer class="us-photo__bar">` +
    `<button type="button" class="us-photo__level">Horizon level</button>` +
    `<button type="button" class="us-photo__export">Export plate</button>` +
    `<span class="us-photo__hint">Drag to orbit · scroll to zoom · P or Escape to exit</span>` +
    `</footer>`;
  document.body.append(root);

  const captionEl = root.querySelector('.us-photo__caption') as HTMLElement;
  const renderCaption = (): void => {
    const c = getCaption();
    captionEl.textContent =
      `seed ${c.seed} · ${(c.distanceM / 1000).toFixed(1)} km · ${c.timeOfDay} · ${c.weather}`;
  };

  // Orbit input (pointer events cover mouse + touch).
  root.addEventListener('pointerdown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    yawVel = (e.clientX - lastX) * -0.005;
    pitchVel = (e.clientY - lastY) * 0.003;
    yaw += yawVel * 8;
    pitch = Math.min(1.2, Math.max(-0.15, pitch + pitchVel * 8));
    lastX = e.clientX;
    lastY = e.clientY;
  });
  const endDrag = (): void => {
    dragging = false;
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      rig.setPhotoZoom(Math.min(2.2, Math.max(0.55, rig.photoZoom() * (1 + Math.sign(e.deltaY) * 0.08))));
    },
    { passive: false },
  );

  (root.querySelector('.us-photo__level') as HTMLButtonElement).addEventListener('click', () => {
    rig.setPhotoLevel(true);
  });
  (root.querySelector('.us-photo__export') as HTMLButtonElement).addEventListener('click', () => {
    void capture2x();
  });

  function enter(): void {
    active = true;
    rig.setPhotoMode(true);
    root.hidden = false;
    renderCaption();
  }
  function exit(): void {
    active = false;
    rig.setPhotoMode(false);
    root.hidden = true;
  }

  return {
    get isActive(): boolean {
      return active;
    },
    toggle(): void {
      if (active) exit();
      else enter();
    },
    /** Called per rendered frame while active: applies orbit to the rig. */
    update(dtS: number): void {
      if (!active || dragging) return;
      // Gentle inertia so orbits glide, never snap (CALM).
      yaw += yawVel * dtS * 60;
      pitch = Math.min(1.2, Math.max(-0.15, pitch + pitchVel * dtS * 60));
      yawVel *= Math.pow(0.02, dtS);
      pitchVel *= Math.pow(0.02, dtS);
      rig.setPhotoOrbit(yaw, pitch);
    },
    dispose(): void {
      exit();
      root.remove();
    },
  };
}
