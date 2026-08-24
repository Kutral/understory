/**
 * Exponential height fog with sun in-scattering tint — assigned to
 * scene.fogNode so every world material with fog=true (terrain, flora,
 * vehicle) is fogged by the same physically-shaped term.
 *
 * Density: d(y) = density · exp(−falloff · avgY) integrated as
 *   factor = 1 − exp(−d · viewDist)
 * using the ray midpoint height (standard cheap approximation of the exact
 * exponential integral; error is invisible under a canopy).
 *
 * In-scatter: looking toward the sun, fog picks up the --lamp warm tint during
 * day/golden hour and cools toward --mist for rain/dusk/night — all driven by
 * uniform values computed on the CPU from the continuous palette.
 */

import { Color, Vector3, type Scene } from 'three/webgpu';
import {
  cameraPosition,
  clamp,
  exp,
  float,
  fog,
  length,
  max,
  min,
  mix,
  oneMinus,
  pow,
  positionWorld,
  uniform,
} from 'three/tsl';
import { BASE_FOG_DENSITY, FOG_FALLOFF } from './palette';

export interface FogUniforms {
  fogColor: { value: Color };
  /** Base density at y=0 (per metre), already includes weather multiplier. */
  density: { value: number };
  sunTint: { value: Color };
  /** 0..1 strength of the forward in-scatter tint. */
  inScatter: { value: number };
  sunDir: { value: Vector3 };
}

export function createHeightFog(): {
  apply(scene: Scene): void;
  uniforms: FogUniforms;
  dispose(scene: Scene): void;
} {
  const uColor = uniform(new Color(0.55, 0.6, 0.62));
  const uDensity = uniform(BASE_FOG_DENSITY);
  const uSunTint = uniform(new Color(240 / 255, 178 / 255, 75 / 255));
  const uInScatter = uniform(0.35);
  const uSunDir = uniform(new Vector3(0, 1, 0));

  // factor = 1 − exp(−d(y_mid) · viewDist), midpoint-height approximation.
  const toFrag = positionWorld.sub(cameraPosition);
  const dist = max(length(toFrag), float(0.001));
  const midY = cameraPosition.y.add(positionWorld.y).mul(float(0.5));
  const heightAtten = exp(max(midY.mul(float(-FOG_FALLOFF)), float(-8)));
  const dens = uDensity.mul(min(heightAtten, float(1)));
  const f = oneMinus(exp(dens.mul(dist).mul(-1)));

  // Forward Mie in-scatter toward the sun (--lamp warmth by day, keyed off
  // keyColor so it cools toward --mist at dusk/night/rain automatically).
  const cosSun = clamp(toFrag.div(dist).dot(uSunDir), 0, 1);
  const mie = pow(cosSun, float(14)).mul(uInScatter);
  const inscatterColor = mix(uColor, uSunTint, mie);

  const node = fog(inscatterColor, f);

  let applied = false;

  return {
    uniforms: {
      fogColor: uColor,
      density: uDensity,
      sunTint: uSunTint,
      inScatter: uInScatter,
      sunDir: uSunDir,
    },
    apply(scene) {
      if (applied) return;
      applied = true;
      scene.fogNode = node as typeof scene.fogNode;
    },
    dispose(scene) {
      scene.fogNode = null;
      applied = false;
    },
  };
}
