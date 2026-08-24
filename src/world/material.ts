import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  mix,
  mx_noise_float,
  normalLocal,
  positionLocal,
  smoothstep,
  vec3,
} from 'three/tsl';

/**
 * Forest-floor surface material — pure TSL node graph (no GLSL strings, no
 * onBeforeCompile).
 *
 * Blends procedural surfaces driven by per-vertex data from the worker
 * (surface code, moisture) plus shader-side slope and altitude:
 *   - moss (default ground cover, noise-mottled)
 *   - leaf litter (patchy, noise-driven)
 *   - compacted trail dirt (SURFACE_TRAIL mask carved into the heightfield)
 *   - mud (high moisture, low slope)
 *   - wet rock (steep slopes / high rock code; wetness darkens + glosses)
 *
 * "Triplanar" detail: every noise lookup evaluates the three axis projections
 * of the local position and blends them by |normal| weights, so cliff faces
 * show no texture stretching without needing any textures.
 */

export function createTerrainMaterial(): THREE.MeshStandardNodeMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();

  const surf = attribute<'float'>('aSurf', 'float');
  const moist = attribute<'float'>('aMoisture', 'float');

  // Slope in [0,1]: 0 flat, 1 vertical. Mesh transform is translation-only so
  // local normals equal world normals.
  const nrm = normalLocal.normalize();
  const slope = float(1).sub(nrm.y.abs());
  const altitude = positionLocal.y;

  // ---- masks --------------------------------------------------------------
  const trailMask = smoothstep(0.5, 0.25, surf); // SURF_TRAIL == 0 → 1
  const slopeRock = smoothstep(0.38, 0.62, slope);
  const codeRock = smoothstep(2.5, 2.85, surf); // SURF_ROCK == 3 → 1
  const rockMask = slopeRock.max(codeRock);
  const mudMask = smoothstep(0.68, 0.8, moist).mul(rockMask.oneMinus());

  // ---- triplanar noise ----------------------------------------------------
  const p = positionLocal;
  const wY = nrm.y.abs().pow(4);
  const wX = nrm.x.abs().pow(4);
  const wZ = nrm.z.abs().pow(4);
  const wSum = wX.add(wY).add(wZ).max(1e-4);

  /** Triplanar-blended MaterialX noise in ~[-1,1]; `off` decorrelates layers. */
  const triNoise = (scale: number, off = 0) =>
    mx_noise_float(vec3(p.y.mul(scale), p.z.mul(scale), off))
      .mul(wX)
      .add(mx_noise_float(vec3(p.x.mul(scale), p.z.mul(scale), off)).mul(wY))
      .add(mx_noise_float(vec3(p.x.mul(scale), p.y.mul(scale), off)).mul(wZ))
      .div(wSum);

  /** Map noise ~[-1,1] → [0,1]. */
  const uni = (node: ReturnType<typeof triNoise>) => node.mul(0.5).add(0.5);

  // ---- albedo palette -----------------------------------------------------
  // Moss: deep forest green, large-scale mottling.
  const mottle = uni(triNoise(0.09));
  const moss = mix(vec3(0.145, 0.235, 0.118), vec3(0.224, 0.318, 0.153), mottle);

  // Leaf litter: rust/brown patches scattered over the moss.
  const litterPatch = uni(triNoise(0.055, 7.3));
  const groundRoom = trailMask.oneMinus().mul(rockMask.oneMinus()).mul(mudMask.oneMinus());
  const litterMask = smoothstep(0.55, 0.78, litterPatch).mul(groundRoom);
  const litter = mix(vec3(0.372, 0.255, 0.129), vec3(0.486, 0.333, 0.161), mottle);

  // Trail dirt: compacted tan-brown, darker when wet.
  const dirt = mix(
    vec3(0.361, 0.278, 0.184),
    vec3(0.29, 0.216, 0.141),
    moist.mul(0.6).add(uni(triNoise(0.14, 3.1))).mul(0.5),
  );

  // Mud: dark saturated humus.
  const mud = vec3(0.184, 0.137, 0.09).add(triNoise(0.2, 11.7).mul(0.03));

  // Wet rock: grey granite; moisture darkens it further.
  const rock = mix(vec3(0.302, 0.294, 0.278), vec3(0.196, 0.192, 0.184), moist);
  // Lichen tint high up on ridgelines (subtle).
  const rockAlt = mix(rock, vec3(0.42, 0.416, 0.4), smoothstep(18, 34, altitude).mul(0.35));

  // ---- blend chain --------------------------------------------------------
  let col = mix(moss, litter, litterMask);
  col = mix(col, mud, mudMask);
  col = mix(col, dirt, trailMask);
  col = mix(col, rockAlt, rockMask);
  // Global moisture grime everywhere except the trail crown.
  col = mix(col, col.mul(0.82), smoothstep(0.5, 0.9, moist).mul(trailMask.oneMinus()).mul(0.6));

  mat.colorNode = col;

  // ---- roughness ----------------------------------------------------------
  const baseRough = mix(float(0.92), float(0.72), rockMask);
  const wet = moist.max(trailMask.mul(0.25));
  mat.roughnessNode = mix(baseRough, float(0.38), smoothstep(0.55, 0.95, wet));

  return mat;
}
