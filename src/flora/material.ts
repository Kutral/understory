import * as THREE from 'three/webgpu';
import {
  attribute,
  float,
  instancedBufferAttribute,
  mix,
  positionLocal,
  sin,
  smoothstep,
  texture,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * Pine TSL materials — pure node graphs (no GLSL, no onBeforeCompile).
 *
 * WIND: travelling gusts, not global wobble. A two-octave sine field scrolls
 * along the wind direction; each tree samples it at its own world XZ
 * (passed via the `aData` instanced attribute), so gust fronts visibly travel
 * ACROSS the forest. Amplitude is hierarchical through the baked `aFlex`
 * vertex attribute: trunk vertices sit at ≤~0.12 coupling (the "trunk 10%"
 * tier), foliage tips at 1.0.
 *
 * Per-instance variation: `aData = (worldX, worldZ, phase, hue)` — phase
 * decorrelates the small flutter, hue shifts the foliage tint.
 */

export interface WindUniforms {
  readonly time: { value: number };
  /** Normalised wind direction in XZ. */
  readonly dir: { value: THREE.Vector2 };
  /** Tip amplitude in metres. */
  readonly amp: { value: number };
}

export interface PineMaterial {
  readonly material: THREE.MeshStandardNodeMaterial;
  readonly uniforms: WindUniforms;
}

/** Per-instance payload: (worldX, worldZ, phase01, hue[-1..1]). */
export function makeInstanceData(capacity: number): THREE.InstancedBufferAttribute {
  return new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
}

function windGraph(dataAttr: THREE.InstancedBufferAttribute): {
  offset: ReturnType<typeof vec3>;
  uniforms: WindUniforms;
} {
  const time = uniform(0);
  const dir = uniform(new THREE.Vector2(0.8, 0.35).normalize());
  const amp = uniform(0.42);

  const data = instancedBufferAttribute<'vec4'>(dataAttr, 'vec4');
  const originXZ = data.xy;
  const phase = data.z;

  const flex = attribute<'float'>('aFlex', 'float');
  const p = positionLocal;

  // Gust coordinate: tree origin dominates so the wave is coherent across the
  // whole crown; a little local position adds intra-tree ripples.
  const g = originXZ.add(p.xz.mul(0.18));
  const d = dir;
  const perp = vec2(d.y.mul(-1), d.x);

  // Two travelling octaves: a broad swell plus a faster chop, both moving
  // along the wind vector as t advances.
  const s1 = sin(g.dot(d).mul(0.09).sub(time.mul(1.9)));
  const s2 = sin(g.dot(perp).mul(0.037).add(g.dot(d).mul(0.043)).sub(time.mul(0.77)));
  const gust = s1.mul(0.5).add(0.5).pow(1.8).mul(0.75)
    .add(s2.mul(0.5).add(0.5).pow(2).mul(0.55));

  // Hierarchical amplitude: flex already encodes trunk≈0.1 / foliage≈1.
  const swayAmt = gust.mul(amp).mul(flex);
  const sway = d.mul(swayAmt);

  // Small high-frequency flutter around the gust level, per-instance phase.
  const flutterPhase = time.mul(2.6).add(phase.mul(6.283)).add(p.y.mul(0.55));
  const flutter = perp.mul(sin(flutterPhase)).mul(flex.pow(2)).mul(amp.mul(0.22)).mul(swayAmt.add(0.15));

  return { offset: vec3(sway.x.add(flutter.x), float(0), sway.y.add(flutter.y)), uniforms: { time, dir, amp } };
}

/**
 * Shared by all three geometry LODs — one pipeline, three draws. All three
 * geometries register the SAME `aData` attribute object so one buffer feeds
 * every band.
 */
export function createPineMaterial(data: THREE.InstancedBufferAttribute): PineMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  const { offset, uniforms } = windGraph(data);

  const part = attribute<'float'>('aPart', 'float');
  const dataNode = instancedBufferAttribute<'vec4'>(data, 'vec4');
  const hue = dataNode.w.mul(0.5).add(0.5); // [-1,1] → [0,1]

  // Bark: grey-brown, darker toward the roots.
  const bark = mix(vec3(0.23, 0.165, 0.115), vec3(0.32, 0.24, 0.17), smoothstep(0, 4, positionLocal.y));
  // Foliage hue variation: yellow-green ↔ blue-green needle cast.
  const needlesA = vec3(0.11, 0.185, 0.075);
  const needlesB = vec3(0.135, 0.21, 0.14);
  const foliage = mix(needlesA, needlesB, hue);
  mat.colorNode = mix(bark, foliage, part);
  mat.roughnessNode = mix(float(0.95), float(0.85), part);

  mat.positionNode = positionLocal.add(offset);
  return { material: mat, uniforms };
}

/** Crossed-billboard impostor material sampling the pre-rendered canvas. */
export function createImpostorMaterial(
  map: THREE.Texture | null,
  data: THREE.InstancedBufferAttribute,
): PineMaterial {
  const mat = new THREE.MeshStandardNodeMaterial();
  mat.side = THREE.DoubleSide;
  const { offset, uniforms } = windGraph(data);

  if (map) {
    map.colorSpace = THREE.SRGBColorSpace;
    const tex = texture(map);
    mat.colorNode = tex.rgb;
    // Alpha-cut so no sorting is needed between impostors.
    mat.transparent = false;
    mat.alphaTest = 0.45;
    mat.opacityNode = tex.a;
  } else {
    // Node-env fallback (tests/tooling without DOM canvas): opaque green card.
    mat.colorNode = vec3(0.11, 0.19, 0.08);
  }

  mat.positionNode = positionLocal.add(offset);
  return { material: mat, uniforms };
}
