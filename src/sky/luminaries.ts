/**
 * Sun/moon directional rig.
 *
 * ONE shadow-casting DirectionalLight represents whichever luminary dominates
 * (sun by day, moon by night) — a single fixed ortho frustum sized for the
 * ~120 m near field means there is no cascade boundary to pop and no
 * re-projection when the key light hands over between sun and moon.
 *
 * Anti-shimmer: the shadow camera's focus point is snapped to texel-size steps
 * in light space every frame, so sub-texel camera motion cannot crawl the
 * shadow map. Frustum extents never change at runtime.
 */

import * as THREE from 'three/webgpu';
import type { RGB } from './palette';

export const SHADOW_HALF_EXTENT_M = 70; // ±70 m → 140 m box, covers the 120 m near field
export const SHADOW_MAP_SIZE = 2048;
const LIGHT_DIST = 220;
const SHADOW_NEAR = 20;
const SHADOW_FAR = 460;

export interface Luminaries {
  /** Shadow-casting key light (sun or moon). */
  key: THREE.DirectionalLight;
  /** Non-casting fill light for ambient sky bounce (cheap hemisphere proxy). */
  ambient: THREE.HemisphereLight;
  moonMesh: THREE.Mesh;
  update(sunDir: THREE.Vector3, moonDir: THREE.Vector3, keyColor: RGB, keyIntensity: number, ambientColor: RGB, ambientIntensity: number, moonOpacity: number, camPos: THREE.Vector3): void;
  dispose(): void;
}

const _focus = new THREE.Vector3();
const _lightDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export function createLuminaries(): Luminaries {
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  const cam = key.shadow.camera;
  cam.left = -SHADOW_HALF_EXTENT_M;
  cam.right = SHADOW_HALF_EXTENT_M;
  cam.top = SHADOW_HALF_EXTENT_M;
  cam.bottom = -SHADOW_HALF_EXTENT_M;
  cam.near = SHADOW_NEAR;
  cam.far = SHADOW_FAR;
  key.shadow.bias = -0.00035;
  key.shadow.normalBias = 0.6; // canopy-scale geometry: generous normal offset kills acne without peter-panning at this scale
  cam.updateProjectionMatrix();

  // Fixed extent → constant world-units-per-texel → stable snapping grid.
  const texel = (2 * SHADOW_HALF_EXTENT_M) / SHADOW_MAP_SIZE;

  const ambient = new THREE.HemisphereLight(0x7c9aa6, 0x101a16, 0.5);

  // Moon disc: soft-edged billboard placed along the moon direction.
  const moonGeo = new THREE.CircleGeometry(22, 32);
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xdde6f2,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.name = 'moon-disc';
  moonMesh.frustumCulled = false;
  moonMesh.renderOrder = -980;

  const _v = new THREE.Vector3();

  return {
    key,
    ambient,
    moonMesh,
    update(sunDir, moonDir, keyColor, keyIntensity, ambientColor, ambientIntensity, moonOpacity, camPos) {
      // Dominant luminary drives the key light; direction flips at the
      // elevation crossover where both intensities are equal (no intensity pop).
      if (sunDir.y >= moonDir.y) {
        _lightDir.copy(sunDir);
      } else {
        _lightDir.copy(moonDir);
      }

      // Texel-snap the shadow focus point in light space (kills shimmer from
      // sub-texel camera motion). Extents are static, so the grid is stable.
      _right.setFromMatrixColumn(key.matrixWorld, 0);
      _up.setFromMatrixColumn(key.matrixWorld, 1);
      const fx = Math.round(_right.dot(camPos) / texel) * texel;
      const fy = Math.round(_up.dot(camPos) / texel) * texel;
      _focus.copy(camPos);
      _focus.addScaledVector(_right, fx - _right.dot(camPos));
      _focus.addScaledVector(_up, fy - _up.dot(camPos));

      key.position.copy(_lightDir).multiplyScalar(LIGHT_DIST).add(_focus);
      key.target.position.copy(_focus);
      key.target.updateMatrixWorld();
      key.color.setRGB(keyColor[0], keyColor[1], keyColor[2]);
      key.intensity = keyIntensity;

      ambient.color.setRGB(ambientColor[0], ambientColor[1], ambientColor[2]);
      ambient.intensity = ambientIntensity;

      moonMesh.position.copy(moonDir).multiplyScalar(800).add(camPos);
      moonMesh.lookAt(camPos);
      moonMat.opacity = moonOpacity;
      moonMesh.visible = moonOpacity > 0.01;
    },
    dispose() {
      moonGeo.dispose();
      moonMat.dispose();
    },
  };
}
