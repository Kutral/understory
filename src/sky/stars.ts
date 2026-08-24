/**
 * Star field — seeded points on the upper hemisphere with TSL twinkle.
 * Opacity is a single uniform driven by nightFactor × cloud cover.
 */

import * as THREE from 'three/webgpu';
import { attribute, float, max, sin, time, uniform, vec4 } from 'three/tsl';

export function createStars(
  seed = 0x51a5,
  count = 1100,
  radius = 860,
): { points: THREE.Points; setOpacity(o: number): void; dispose(): void } {
  // Deterministic hemisphere distribution (mulberry32).
  let a = seed >>> 0;
  const rand = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const sizes = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Screen-uniform hemisphere distribution: pdf(y) ∝ y compensates the
    // 1/cos(θ) projection pile-up at zenith (plain uniform sampling clumps
    // stars near the top of the frame when the camera looks at the horizon).
    const yMin = 0.05;
    const y = Math.sqrt(yMin * yMin + rand() * (1 - yMin * yMin));
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = rand() * Math.PI * 2;
    positions[i * 3] = Math.cos(theta) * r * radius;
    positions[i * 3 + 1] = y * radius;
    positions[i * 3 + 2] = Math.sin(theta) * r * radius;
    phases[i] = rand() * Math.PI * 2;
    sizes[i] = 1.2 + rand() * rand() * 2.4; // few bright, many faint
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const uOpacity = uniform(0);
  const uColor = uniform(new THREE.Color(0.92, 0.94, 1.0));
  // Runtime accepts (name, 'float'); typings widen to string, so pin the node type.
  const phaseAttr = attribute('aPhase', 'float') as unknown as ReturnType<typeof float>;
  const sizeAttr = attribute('aSize', 'float') as unknown as ReturnType<typeof float>;

  const mat = new THREE.PointsNodeMaterial();
  // Twinkle: per-star phase offset over a slow sine; keep subtle.
  const twinkle = sin(time.mul(0.8).add(phaseAttr)).mul(0.18).add(0.82);
  const starCol = uColor.mul(twinkle);
  const starAlpha = uOpacity.mul(max(twinkle, 0.55));
  mat.colorNode = vec4(starCol, starAlpha);
  mat.sizeNode = sizeAttr;
  mat.sizeAttenuation = false;
  mat.transparent = true;
  mat.depthWrite = false;
  mat.fog = false;

  const points = new THREE.Points(geo, mat);
  points.name = 'stars';
  points.frustumCulled = false;
  points.renderOrder = -990;

  return {
    points,
    setOpacity(o: number) {
      uOpacity.value = o;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
