/**
 * Deterministic visual harness for the sky subsystem (NOT part of the game
 * boot path — agent A owns main.ts). Loaded by tests/sky/harness.html and
 * driven by tests/sky/screenshot-sky.mjs.
 *
 * Exposes on window:
 *   __skyReady      — promise resolving once the first frame is rendered
 *   __setTime(h)    — scrub time-of-day
 *   __setWeather(w) — settle instantly into a weather state (no fade)
 */

import * as THREE from 'three/webgpu';
import { createSkySystem } from '@/sky';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('#scene canvas missing');

// Forced WebGL2 lets headless Chromium (SwiftShader) render deterministically.
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: true });
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.position.set(0, 3, -8);
camera.lookAt(0, 1, 0);

// Simple reference ground + a few posts so shadows/fog read in screenshots.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
  new THREE.MeshStandardNodeMaterial({ color: 0x2f4234 }),
);
ground.receiveShadow = true;
scene.add(ground);

const postMat = new THREE.MeshStandardNodeMaterial({ color: 0x101a16 });
for (let i = 0; i < 7; i++) {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 9, 6), postMat);
  post.position.set(-30 + i * 10, 4.5, -14 + (i % 3) * 12);
  post.castShadow = true;
  post.receiveShadow = true;
  scene.add(post);
}

const sky = createSkySystem({ scene, seed: 1234 });
sky.setDriftMode(false);
renderer.shadowMap.enabled = true;

function resize(): void {
  renderer.setSize(1280, 720);
  camera.aspect = 1280 / 720;
  camera.updateProjectionMatrix();
}
resize();

let frameCount = 0;
renderer.setAnimationLoop(() => {
  sky.fixedUpdate(1 / 60);
  sky.applyVisuals(camera);
  void renderer.renderAsync(scene, camera).then(() => {
    frameCount++;
  });
});

declare global {
  interface Window {
    __setTime: (h: number) => void;
    __setWeather: (w: 'clear' | 'mist' | 'drizzle' | 'rain' | 'afterRain') => void;
  }
}

window.__setTime = (h: number): void => {
  sky.setTimeOfDay(h);
};
window.__setWeather = (w: 'clear' | 'mist' | 'drizzle' | 'rain' | 'afterRain'): void => {
  sky.debugSettleWeather(w);
};

// Resolve readiness only after several rendered frames (shader warm-up).
await new Promise<void>((resolve) => {
  const check = (): void => {
    if (frameCount >= 5) resolve();
    else setTimeout(check, 50);
  };
  check();
});

export {};
