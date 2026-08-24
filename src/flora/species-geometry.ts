import * as THREE from 'three/webgpu';
import type { PineLod } from './geometry';

/**
 * Procedural geometry for the Wave 2 species — birch, oak, dead snag —
 * generated entirely in code alongside the existing pine builders.
 *
 * Reuses the pine MeshBuilder contract: per-vertex `aFlex` (wind coupling,
 * trunk ≤~0.15 → foliage 1.0) and `aPart` (0 = bark, 1 = foliage), so all
 * species share ONE TSL material pipeline and one impostor system.
 *
 * Tri budgets per LOD mirror pine's table so the combined draw-call budget
 * in tests/flora-species.test.ts holds: full ~800, mid ~150, far ~40.
 */

export type SpeciesLod = PineLod;

export interface SpeciesShape {
  /** Total height at scale 1. */
  readonly heightM: number;
  /** Foliage spread radius at scale 1. */
  readonly spreadM: number;
}

export const SPECIES_SHAPES: Record<'birch' | 'oak' | 'snag', SpeciesShape> = {
  birch: { heightM: 12, spreadM: 3.6 },
  oak: { heightM: 13, spreadM: 7.2 },
  snag: { heightM: 9, spreadM: 1.4 },
};

// ---- shared low-level builders ---------------------------------------------

interface Builder {
  vertex(x: number, y: number, z: number, flex: number, part: number): number;
  tri(a: number, b: number, c: number): void;
}

function addTaperedTrunk(
  b: Builder,
  h: number,
  rBase: number,
  rTip: number,
  radial: number,
  strips: number,
  maxH: number,
  bend: number,
): void {
  for (let s = 0; s <= strips; s++) {
    const v = s / strips;
    const y = v * h;
    // Gentle lean: snags and birches are not perfectly straight.
    const bx = Math.sin(v * 2.2) * bend * v;
    const r = rBase + (rTip - rBase) * v;
    const flex = (0.06 + 0.94 * Math.pow(Math.min(1, y / maxH), 1.7)) * 0.55;
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      b.vertex(Math.cos(a) * r + bx, y, Math.sin(a) * r, flex, 0);
    }
  }
  for (let s = 0; s < strips; s++) {
    for (let i = 0; i < radial; i++) {
      const a = s * radial + i;
      const bb = s * radial + ((i + 1) % radial);
      const c = (s + 1) * radial + i;
      const d = (s + 1) * radial + ((i + 1) % radial);
      b.tri(a, c, bb);
      b.tri(bb, c, d);
    }
  }
}

function addBlob(
  b: Builder,
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  rings: number,
  segments: number,
  maxH: number,
): void {
  // UV-sphere-ish canopy blob (poles collapsed to single vertices).
  for (let ring = 1; ring < rings; ring++) {
    const phi = (ring / rings) * Math.PI;
    const y = cy + Math.cos(phi) * ry;
    const rr = Math.sin(phi);
    const flex = 0.06 + 0.94 * Math.pow(Math.min(1, y / maxH), 1.7);
    for (let i = 0; i < segments; i++) {
      const th = (i / segments) * Math.PI * 2;
      b.vertex(
        cx + Math.cos(th) * rx * rr,
        y,
        cz + Math.sin(th) * rz * rr,
        flex,
        1,
      );
    }
  }
  const top = b.vertex(cx, cy + ry, cz, 1, 1);
  const bot = b.vertex(cx, cy - ry, cz, 0.35, 1);
  const segs = segments;
  for (let ring = 0; ring < rings - 2; ring++) {
    for (let i = 0; i < segs; i++) {
      const a = ring * segs + i;
      const bb = ring * segs + ((i + 1) % segs);
      const c = (ring + 1) * segs + i;
      const d = (ring + 1) * segs + ((i + 1) % segs);
      b.tri(a, c, bb);
      b.tri(bb, c, d);
    }
  }
  const lastRow = (rings - 2) * segs;
  for (let i = 0; i < segs; i++) {
    b.tri(lastRow + i, top, lastRow + ((i + 1) % segs));
    b.tri(i, bot, (i + 1) % segs);
  }
}

function addBranch(
  b: Builder,
  ox: number,
  oy: number,
  oz: number,
  angleY: number,
  len: number,
  r0: number,
  radial: number,
  maxH: number,
): void {
  // Straight tapered branch as a small open tube along its own axis.
  const dx = Math.cos(angleY);
  const dz = Math.sin(angleY);
  const rise = len * 0.45;
  const steps = 2;
  for (let s = 0; s <= steps; s++) {
    const v = s / steps;
    const x = ox + dx * len * v;
    const z = oz + dz * len * v;
    const y = oy + rise * v;
    const r = r0 * (1 - v * 0.8);
    const flex = 0.06 + 0.94 * Math.pow(Math.min(1, y / maxH), 1.7);
    for (let i = 0; i < radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      // Perpendicular offset in the horizontal plane is enough at this size.
      b.vertex(
        x + Math.cos(a) * r * Math.cos(angleY + Math.PI / 2),
        y,
        z + Math.cos(a) * r * Math.sin(angleY + Math.PI / 2),
        flex,
        0,
      );
    }
  }
  for (let s = 0; s < steps; s++) {
    for (let i = 0; i < radial; i++) {
      const a = s * radial + i;
      const bb = s * radial + ((i + 1) % radial);
      const c = (s + 1) * radial + i;
      const d = (s + 1) * radial + ((i + 1) % radial);
      b.tri(a, c, bb);
      b.tri(bb, c, d);
    }
  }
}

// ---- species LOD tables ------------------------------------------------------

/** Birch: slim white trunk, small oval canopy high up. */
const BIRCH_SPECIES: Record<SpeciesLod, { trunk: [number, number]; blobs: Array<[number, number, number, number, number, number]>; blobRings: number; blobSegs: number }> = {
  full: {
    trunk: [10, 10],
    blobs: [
      [0, 9.6, 0, 2.6, 1.9, 2.6],
      [1.2, 8.6, 0.7, 1.7, 1.3, 1.7],
      [-1.0, 9.0, -0.8, 1.5, 1.2, 1.5],
    ],
    blobRings: 6,
    blobSegs: 10,
  },
  mid: {
    trunk: [5, 3],
    blobs: [[0, 9.6, 0, 2.6, 2.0, 2.6]],
    blobRings: 4,
    blobSegs: 7,
  },
  far: {
    trunk: [3, 1],
    blobs: [[0, 9.6, 0, 2.6, 2.1, 2.6]],
    blobRings: 3,
    blobSegs: 5,
  },
};

/** Oak: thick trunk, broad multi-lobed canopy. */
const OAK_SPECIES: Record<SpeciesLod, { trunk: [number, number]; blobs: Array<[number, number, number, number, number, number]>; blobRings: number; blobSegs: number }> = {
  full: {
    trunk: [8, 7],
    blobs: [
      [0, 9.4, 0, 4.6, 2.6, 4.6],
      [3.0, 8.2, 1.4, 2.4, 1.8, 2.4],
      [-2.8, 8.6, -2.0, 2.2, 1.7, 2.2],
      [0.4, 11.2, -1.0, 2.0, 1.5, 2.0],
      [-1.6, 10.6, 2.2, 1.9, 1.5, 1.9],
    ],
    blobRings: 5,
    blobSegs: 9,
  },
  mid: {
    trunk: [4, 2],
    blobs: [
      [0, 9.4, 0, 4.6, 2.7, 4.6],
      [2.2, 8.8, -1.4, 2.2, 1.7, 2.2],
    ],
    blobRings: 4,
    blobSegs: 6,
  },
  far: {
    trunk: [3, 1],
    blobs: [[0, 9.6, 0, 4.8, 2.8, 4.8]],
    blobRings: 3,
    blobSegs: 4,
  },
};

/** Snag: bare leaning trunk with broken branch stubs, no foliage at all. */
const SNAG_SPECIES: Record<SpeciesLod, { trunk: [number, number]; branches: Array<[number, number, number, number]> }> = {
  full: {
    trunk: [7, 6],
    branches: [
      [2.8, 0.6, 2.2, 5],
      [4.4, 2.1, 1.7, 5],
      [6.1, 4.2, 1.3, 4],
    ],
  },
  mid: {
    trunk: [3, 2],
    branches: [[3.4, 1.2, 1.6, 4]],
  },
  far: {
    trunk: [2, 1],
    branches: [],
  },
};

class FloraMeshBuilder implements Builder {
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
}

/**
 * Build one species LOD mesh (centered on trunk axis, base at y=0).
 * `species` selects the shape table; tri counts stay within the budget
 * asserted by tests/flora-species.test.ts.
 */
export function buildSpeciesGeometry(
  species: 'birch' | 'oak' | 'snag',
  lod: SpeciesLod,
): { geometry: THREE.BufferGeometry; triangles: number } {
  const b = new FloraMeshBuilder();

  if (species === 'snag') {
    const spec = SNAG_SPECIES[lod];
    addTaperedTrunk(b, 9, 0.34, 0.05, spec.trunk[0], spec.trunk[1], 9, 0.55);
    for (const br of spec.branches) {
      addBranch(b, 0.1, br[0], 0.05, br[1], br[2], 0.09, br[3], 9);
    }
  } else if (species === 'birch') {
    const spec = BIRCH_SPECIES[lod];
    addTaperedTrunk(b, 10.5, 0.19, 0.05, spec.trunk[0], spec.trunk[1], 12, 0.22);
    for (const bl of spec.blobs) {
      addBlob(b, bl[0], bl[1], bl[2], bl[3] * 0.85, bl[4], bl[5] * 0.85, spec.blobRings, spec.blobSegs, 12);
    }
  } else {
    const spec = OAK_SPECIES[lod];
    addTaperedTrunk(b, 6.4, 0.52, 0.24, spec.trunk[0], spec.trunk[1], 13, 0.18);
    for (const bl of spec.blobs) {
      addBlob(b, bl[0], bl[1], bl[2], bl[3], bl[4], bl[5], spec.blobRings, spec.blobSegs, 13);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  geometry.setAttribute('aFlex', new THREE.Float32BufferAttribute(b.flex, 1));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(b.part, 1));
  geometry.setIndex(b.idx);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return { geometry, triangles: b.idx.length / 3 };
}
