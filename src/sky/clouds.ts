/**
 * Layered cloud sheets — world-anchored curl-noise-warped FBM in TSL.
 *
 * Three stacked horizontal sheets (120/165/210 m) sample a shared noise field
 * evaluated in WORLD space, so the camera can drive under them with no UV
 * swimming. The FBM domain is warped by the numerical curl of a potential
 * noise field (∂ψ/∂z, −∂ψ/∂x via central differences), which gives the
 * sheared, filamented look of real cloud deformation instead of blob-by-blob
 * value noise. Wind advects both layers and the warp field over time.
 */

import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  positionWorld,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

/** A TSL uniform node handle — set `.value` per frame from the CPU. */
export interface TslNumberUniform {
  value: number;
}

export interface CloudUniforms {
  /** 0..1 coverage — threshold on the fbm field. */
  cover: TslNumberUniform;
  /** 0..1 darkness toward storm bottoms. */
  dark: TslNumberUniform;
  /** Global opacity multiplier (weather + night). */
  opacity: TslNumberUniform;
  /** Wind speed factor. */
  wind: TslNumberUniform;
  cloudColor: { value: THREE.Color };
}

interface LayerSpec {
  y: number;
  scale: number; // noise frequency, cycles/m
  alphaMul: number;
  warpStrength: number;
}

const LAYERS: LayerSpec[] = [
  { y: 120, scale: 1 / 260, alphaMul: 0.85, warpStrength: 60 },
  { y: 165, scale: 1 / 340, alphaMul: 0.7, warpStrength: 90 },
  { y: 210, scale: 1 / 460, alphaMul: 0.55, warpStrength: 120 },
];

export function createCloudSheets(sizeM = 1600): {
  group: THREE.Group;
  uniforms: CloudUniforms;
  dispose(): void;
} {
  const cover = uniform(0.25);
  const dark = uniform(0.1);
  const opacity = uniform(1);
  const wind = uniform(0.35);
  const cloudColor = uniform(new THREE.Color(0.9, 0.88, 0.84));

  const group = new THREE.Group();
  group.name = 'cloud-sheets';
  const mats: THREE.MeshBasicNodeMaterial[] = [];

  LAYERS.forEach((spec: LayerSpec, layerIndex: number) => {
    // Curl-of-potential domain warp (divergence-free), slowly animated.
    const e = float(24);
    const tSlow = time.mul(float(0.05));
    const p = positionWorld.xz;
    const s = p.mul(float(spec.scale).mul(float(0.35)));
    const px = mx_noise_float(vec3(s.x.add(e), tSlow, s.y));
    const nx = mx_noise_float(vec3(s.x.sub(e), tSlow, s.y));
    const pz = mx_noise_float(vec3(s.x, tSlow, s.y.add(e)));
    const nz = mx_noise_float(vec3(s.x, tSlow, s.y.sub(e)));
    // (∂ψ/∂z, −∂ψ/∂x) scaled into metres of warp.
    const warp = vec2(pz.sub(nz), nx.sub(px))
      .mul(float(spec.warpStrength))
      .mul(e.div(float(2)).reciprocal());

    // Wind advection across the sheet.
    const adv = time.mul(wind).mul(float(6));

    // Coverage threshold: higher cover → lower threshold; storm dark softens edges.
    const thr = mix(float(0.5), float(-0.5), cover);
    const soft = mix(float(0.2), float(0.36), dark);
    // 5-octave FBM over the warped, advected world-space domain.
    const n = mx_fractal_noise_float(
      vec3(p.x.add(warp.x).add(adv), float(spec.y * 0.01), p.y.add(warp.y).add(adv.mul(0.6))),
      5,
      2.0,
      0.5,
    );
    const body = smoothstep(thr, thr.add(soft), n);

    // Edge falloff so the finite sheet never shows a hard border.
    const edge = smoothstep(float(1500), float(900), p.length());

    // Shading: thicker regions read darker (storm bottoms / shadow side).
    const shade = mix(float(1), dark.oneMinus().mul(float(0.6)).add(float(0.25)), body);

    const cloudFn = Fn(() => {
      return vec4(cloudColor.mul(shade), body.mul(edge).mul(float(spec.alphaMul)).mul(opacity));
    });

    const geo = new THREE.PlaneGeometry(sizeM, sizeM, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.colorNode = cloudFn();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    mat.fog = false;
    mats.push(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = spec.y;
    mesh.name = `cloud-sheet-${spec.y}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = -800 + layerIndex;
    group.add(mesh);
  });

  return {
    group,
    uniforms: { cover, dark, opacity, wind, cloudColor },
    dispose() {
      for (const child of group.children) {
        (child as THREE.Mesh).geometry.dispose();
      }
      for (const m of mats) m.dispose();
    },
  };
}
