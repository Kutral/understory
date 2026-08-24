import * as THREE from 'three/webgpu';

/**
 * Procedural pine geometry — three LOD meshes generated entirely in code
 * (no asset files), plus a two-quad crossed-billboard frame for impostors.
 *
 * Per-vertex data baked alongside positions:
 *   aFlex — wind coupling in [0,1]. Trunk stays ≤~0.15 (the 10% hierarchy),
 *           foliage tips reach 1.0. The TSL wind material reads this.
 *   aPart — 0 = bark, 1 = foliage. Lets one shared material split colors.
 *
 * All builders are plain CPU array math; tri counts are asserted in
 * tests/flora-lod.test.ts against the budget table.
 */

export type PineLod = 'full' | 'mid' | 'far';

/** Pine proportions at scale 1 (metres). */
export const PINE_HEIGHT_M = 15;
export const PINE_FOLIAGE_SPREAD_M = 6.4;
/** Impostor quad size (slightly larger than the foliage spread). */
export const IMPOSTOR_WIDTH_M = 8;
export const IMPOSTOR_HEIGHT_M = PINE_HEIGHT_M;

interface TierSpec {
  readonly yBase: number;
  readonly yTip: number;
  readonly radius: number;
  readonly radial: number;
  readonly strips: number;
}

interface PineSpec {
  readonly trunk: { readonly radial: number; readonly strips: number };
  readonly tiers: readonly TierSpec[];
}

const FULL_TIERS: TierSpec[] = [
  { yBase: 2.6, yTip: 6.4, radius: 3.2, radial: 18, strips: 2 },
  { yBase: 4.6, yTip: 8.4, radius: 2.85, radial: 18, strips: 2 },
  { yBase: 6.6, yTip: 10.2, radius: 2.45, radial: 18, strips: 2 },
  { yBase: 8.6, yTip: 11.9, radius: 2.0, radial: 18, strips: 2 },
  { yBase: 10.6, yTip: 13.5, radius: 1.55, radial: 18, strips: 2 },
  { yBase: 12.6, yTip: 15.0, radius: 1.0, radial: 18, strips: 2 },
];

const MID_TIERS: TierSpec[] = [
  { yBase: 2.6, yTip: 7.0, radius: 3.2, radial: 10, strips: 1 },
  { yBase: 5.2, yTip: 9.6, radius: 2.6, radial: 10, strips: 1 },
  { yBase: 7.8, yTip: 12.2, radius: 1.9, radial: 10, strips: 1 },
  { yBase: 10.4, yTip: 15.0, radius: 1.1, radial: 10, strips: 1 },
];

const FAR_TIERS: TierSpec[] = [
  { yBase: 3.0, yTip: 8.5, radius: 3.1, radial: 5, strips: 1 },
  { yBase: 6.5, yTip: 11.5, radius: 2.2, radial: 5, strips: 1 },
  { yBase: 10.0, yTip: 15.0, radius: 1.2, radial: 5, strips: 1 },
];

export const PINE_SPECS: Record<PineLod, PineSpec> = {
  full: { trunk: { radial: 14, strips: 10 }, tiers: FULL_TIERS },
  mid: { trunk: { radial: 6, strips: 2 }, tiers: MID_TIERS },
  far: { trunk: { radial: 4, strips: 1 }, tiers: FAR_TIERS },
};

/** Exact triangle count for a LOD spec — pure math, unit-tested. */
export function pineTriangleCount(spec: PineSpec): number {
  // Trunk: radial * strips * 2 (open-ended tapered tube).
  let tris = spec.trunk.radial * spec.trunk.strips * 2;
  for (const t of spec.tiers) {
    // Quad strips below the apex + apex fan.
    tris += t.strips * t.radial * 2 + t.radial;
  }
  return tris;
}

class MeshBuilder {
  readonly pos: number[] = [];
  readonly flex: number[] = [];
  readonly part: number[] = [];
  readonly idx: number[] = [];

  vertex(x: number, y: number, z: number, flex: number, part: number): number {
    this.pos.push(x, y, z);
    this.flex.push(flex);
    this.part.push(part);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  get triangleCount(): number {
    return this.idx.length / 3;
  }
}

/** Hierarchical wind weight: ~0.06 near the ground, 1.0 at the crown tips. */
function flexFor(y: number): number {
  const u = Math.min(1, Math.max(0, y / PINE_HEIGHT_M));
  return 0.06 + 0.94 * Math.pow(u, 1.7);
}

function addTrunk(b: MeshBuilder, spec: PineSpec['trunk']): void {
  const h = 5.2; // bare bole height; foliage starts overlapping from 2.6
  const rBase = 0.38;
  const rTip = 0.16;
  for (let s = 0; s <= spec.strips; s++) {
    const v = s / spec.strips;
    const y = v * h;
    const r = rBase + (rTip - rBase) * v;
    const flex = flexFor(y) * 0.55; // trunk damps harder than canopy math suggests
    for (let i = 0; i < spec.radial; i++) {
      const a = (i / spec.radial) * Math.PI * 2;
      b.vertex(Math.cos(a) * r, y, Math.sin(a) * r, flex, 0);
    }
  }
  const R = spec.radial;
  for (let s = 0; s < spec.strips; s++) {
    for (let i = 0; i < R; i++) {
      const a = s * R + i;
      const bb = s * R + ((i + 1) % R);
      const c = (s + 1) * R + i;
      const d = (s + 1) * R + ((i + 1) % R);
      b.tri(a, c, bb);
      b.tri(bb, c, d);
    }
  }
}

function addTier(b: MeshBuilder, t: TierSpec): void {
  // Ring rows from base up to just under the tip; tip is a shared apex vertex.
  for (let s = 0; s < t.strips; s++) {
    const v = s / t.strips;
    const y = t.yBase + (t.yTip - t.yBase) * v;
    const r = t.radius * (1 - v);
    for (let i = 0; i < t.radial; i++) {
      const a = (i / t.radial) * Math.PI * 2;
      b.vertex(Math.cos(a) * r, y, Math.sin(a) * r, flexFor(y), 1);
    }
  }
  const apex = b.vertex(
    0,
    t.yTip,
    0,
    flexFor(t.yTip),
    1,
  );
  const R = t.radial;
  for (let s = 0; s < t.strips; s++) {
    for (let i = 0; i < R; i++) {
      const a = s * R + i;
      const bb = s * R + ((i + 1) % R);
      const c = (s + 1) * R + i;
      const d = (s + 1) * R + ((i + 1) % R);
      b.tri(a, c, bb);
      b.tri(bb, c, d);
    }
  }
  const lastRow = (t.strips - 1) * R;
  for (let i = 0; i < R; i++) {
    b.tri(lastRow + i, lastRow + ((i + 1) % R), apex);
  }
}

/** Build one pine LOD mesh. Centered on the trunk axis, base at y=0. */
export function buildPine(lod: PineLod): { geometry: THREE.BufferGeometry; triangles: number } {
  const spec = PINE_SPECS[lod];
  const b = new MeshBuilder();
  addTrunk(b, spec.trunk);
  for (const t of spec.tiers) addTier(b, t);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(b.flex, 1));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  geometry.setIndex(b.idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, triangles: b.triangleCount };
}

export interface ImpostorFrame {
  readonly geometry: THREE.BufferGeometry;
  readonly quads: number;
  readonly triangles: number;
}

/**
 * Crossed-billboard frame: two vertical quads at 90° to each other, UV-mapped
 * to the full impostor texture. aFlex runs 0.05 (base) → 1 (top) so impostors
 * sway with the same gust field as real geometry.
 */
export function buildImpostorFrame(): ImpostorFrame {
  const w = IMPOSTOR_WIDTH_M / 2;
  const h = IMPOSTOR_HEIGHT_M;
  const pos: number[] = [];
  const uv: number[] = [];
  const flex: number[] = [];
  const idx: number[] = [];

  const addQuad = (angle: number): void => {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const base = pos.length / 3;
    // corners: bl, br, tr, tl
    const corners: Array<[number, number]> = [
      [-w, 0],
      [w, 0],
      [w, h],
      [-w, h],
    ];
    const uvs: Array<[number, number]> = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      const [lx, ly] = corners[i] as [number, number];
      pos.push(lx * c, ly, lx * s);
      uv.push(uvs[i]?.[0] ?? 0, uvs[i]?.[1] ?? 0);
      flex.push(ly === 0 ? 0.05 : 1);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  addQuad(0);
  addQuad(Math.PI / 2);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(flex, 1));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(1), 1));
  // Normal-up so the lit impostor material shades like sky-lit canopy rather
  // than going black edge-on.
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3),
  );
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  return { geometry, quads: 2, triangles: idx.length / 3 };
}
