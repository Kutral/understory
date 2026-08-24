/**
 * Sky dome — analytic single-scattering sky in TSL.
 *
 * Model: a Preetham-class analytic fit reduced to its visually load-bearing
 * terms for a forest-canopy game (we never see space except through gaps):
 *   - zenith→horizon gradient (Rayleigh term shape: pow(1−h, k) horizon
 *     brightening)
 *   - Mie forward-scatter glow around the sun, weighted toward the horizon
 *   - an occlusion-sized sun disc
 * The coefficients (colors, glow strength) come from computeAtmosphere(), which
 * derives them continuously from sun elevation + weather. All per-frame values
 * ride in uniform nodes; the shader itself never branches on light state.
 */

import * as THREE from 'three/webgpu';
import type { Color, Vector3 } from 'three/webgpu';
import {
  float,
  max,
  mix,
  min,
  normalize,
  pow,
  smoothstep,
  uniform,
  vec3,
  cameraPosition,
  positionWorld,
} from 'three/tsl';

export interface SkyDomeUniforms {
  zenith: { value: Color };
  horizon: { value: Color };
  glowColor: { value: Color };
  glowStrength: { value: number };
  sunDir: { value: Vector3 };
  /** Sun disc brightness (0 at night → disc hidden). */
  sunDisc: { value: number };
  /** Below-horizon fill color (matches fog so terrain seams vanish). */
  belowColor: { value: Color };
}

export function createSkyDome(radius = 900): {
  mesh: THREE.Mesh;
  uniforms: SkyDomeUniforms;
  dispose(): void;
} {
  const uZenith = uniform(new THREE.Color(0.36, 0.49, 0.55));
  const uHorizon = uniform(new THREE.Color(0.55, 0.6, 0.6));
  const uGlowColor = uniform(new THREE.Color(240 / 255, 178 / 255, 75 / 255));
  const uGlowStrength = uniform(0.5);
  const uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  const uSunDisc = uniform(1);
  const uBelow = uniform(new THREE.Color(0.45, 0.5, 0.5));

  // View ray and its height component.
  const dir = normalize(positionWorld.sub(cameraPosition));
  const up = max(dir.y, float(0)); // 0 at horizon → 1 at zenith

  // Rayleigh-shaped horizon brightening.
  const horizFactor = pow(up.oneMinus(), float(3.2));
  const base = mix(uZenith, uHorizon, horizFactor);

  // Mie forward-scatter lobe around the sun, weighted toward the horizon.
  const cosSun = max(dir.dot(uSunDir), float(0));
  const forward = pow(cosSun, float(8));
  const nearHorizon = pow(up.oneMinus(), float(1.5)).mul(float(0.9)).add(float(0.1));
  const glow = min(forward.mul(nearHorizon).mul(uGlowStrength), float(0.85));
  const withGlow = mix(base, uGlowColor, glow);

  // Sun disc (~0.53° diameter + slight bloom skirt).
  const disc = smoothstep(float(0.99988), float(0.99997), cosSun).mul(uSunDisc);
  const withDisc = mix(withGlow, vec3(1.0, 0.98, 0.92), disc);

  // Below-horizon fill: melt into fog color so no hard line under terrain.
  const belowAmt = min(pow(max(float(0).sub(dir.y), float(0)), float(0.4)), float(1));
  const finalCol = mix(withDisc, uBelow, belowAmt);

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = finalCol;
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.depthTest = false;
  material.fog = false;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), material);
  mesh.name = 'sky-dome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  return {
    mesh,
    uniforms: {
      zenith: uZenith,
      horizon: uHorizon,
      glowColor: uGlowColor,
      glowStrength: uGlowStrength,
      sunDir: uSunDir,
      sunDisc: uSunDisc,
      belowColor: uBelow,
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
