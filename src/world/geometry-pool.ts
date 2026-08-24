import * as THREE from 'three/webgpu';
import type { ChunkData } from '@contracts/world';
import { buildIndices, skirtDepth, totalVerts } from './lod';

/**
 * Geometry pooling for streamed chunks. BufferGeometries are allocated ONCE per
 * LOD level capacity and recycled forever — streaming only ever copies typed
 * arrays into existing GPU buffers (`needsUpdate` re-upload), never constructs
 * new geometry per chunk.
 */

/**
 * Fill pooled buffers from worker output: interior grid + downward skirt ring.
 * Normals come from central differences of the carved heights (borders clamp).
 */
export function fillGeometryBuffers(
  step: number,
  heights: Float32Array,
  moisture: Float32Array,
  positions: Float32Array,
  normals: Float32Array,
  moistAttr: Float32Array,
  surfAttr: Float32Array,
  surface?: Uint8Array,
  outRange?: { minY: number; maxY: number },
): void {
  const n = Math.floor(Math.sqrt(heights.length));
  const cell = step; // metres between interior vertices
  const drop = -skirtDepth(step);
  let minY = Infinity;
  let maxY = -Infinity;

  // Interior grid: vertex (ix, iz) at local (ix*step, h, iz*step).
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix;
      const h = heights[i] as number;
      const o = i * 3;
      positions[o] = ix * cell;
      positions[o + 1] = h;
      positions[o + 2] = iz * cell;

      const hl = heights[iz * n + Math.max(ix - 1, 0)] as number;
      const hr = heights[iz * n + Math.min(ix + 1, n - 1)] as number;
      const hd = heights[Math.max(iz - 1, 0) * n + ix] as number;
      const hu = heights[Math.min(iz + 1, n - 1) * n + ix] as number;
      const nx = -(hr - hl) / (2 * cell);
      const nz = -(hu - hd) / (2 * cell);
      const len = Math.hypot(nx, 1, nz);
      normals[o] = nx / len;
      normals[o + 1] = 1 / len;
      normals[o + 2] = nz / len;

      moistAttr[i] = moisture[i] as number;
      surfAttr[i] = surface ? (surface[i] as number) : 0;

      if (h < minY) minY = h;
      if (h > maxY) maxY = h;
    }
  }

  // Skirt duplicates: same x/z, y dropped. Normal/attrs copied from source.
  let sk = n * n;
  const copySkirt = (srcIdx: number): void => {
    const so = sk * 3;
    const po = srcIdx * 3;
    positions[so] = positions[po] as number;
    positions[so + 1] = (positions[po + 1] as number) + drop;
    positions[so + 2] = positions[po + 2] as number;
    normals[so] = normals[po] as number;
    normals[so + 1] = normals[po + 1] as number;
    normals[so + 2] = normals[po + 2] as number;
    moistAttr[sk] = moistAttr[srcIdx] as number;
    surfAttr[sk] = surfAttr[srcIdx] as number;
    sk++;
  };

  // Perimeter walk order matches buildIndices in lod.ts exactly:
  // four strips of n skirt vertices — top edge (iz=0), bottom (iz=n-1),
  // left (ix=0), right (ix=n-1); corners duplicated across strips.
  for (let ix = 0; ix < n; ix++) copySkirt(ix); // top edge
  for (let ix = 0; ix < n; ix++) copySkirt((n - 1) * n + ix); // bottom edge
  for (let iz = 0; iz < n; iz++) copySkirt(iz * n); // left edge
  for (let iz = 0; iz < n; iz++) copySkirt(iz * n + (n - 1)); // right edge

  if (outRange && minY !== Infinity) {
    outRange.minY = minY;
    outRange.maxY = maxY;
  }
}

export interface PooledChunkMesh {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  /** Decimation step this pool entry was sized/built for. */
  step: number;
}

const POOL_CAP_PER_LEVEL = 96;

export class GeometryPool {
  private readonly material: THREE.Material;
  private readonly freeByStep = new Map<number, PooledChunkMesh[]>();
  private readonly indexCache = new Map<number, THREE.BufferAttribute>();

  constructor(material: THREE.Material) {
    this.material = material;
  }

  /** Shared index buffer per level (built once, referenced by every geometry). */
  indexFor(step: number): THREE.BufferAttribute {
    let attr = this.indexCache.get(step);
    if (!attr) {
      attr = new THREE.BufferAttribute(buildIndices(step), 1);
      this.indexCache.set(step, attr);
    }
    return attr;
  }

  acquire(
    step: number,
    data: ChunkData,
    originX: number,
    originZ: number,
    chunkHalf: number,
  ): PooledChunkMesh {
    const free = this.freeByStep.get(step);
    const entry = free?.pop() ?? this.create(step);

    const posAttr = entry.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nrmAttr = entry.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const moistA = entry.geometry.getAttribute('aMoisture') as THREE.BufferAttribute;
    const surfA = entry.geometry.getAttribute('aSurf') as THREE.BufferAttribute;

    fillGeometryBuffers(
      step,
      data.heights,
      data.moisture,
      posAttr.array as Float32Array,
      nrmAttr.array as Float32Array,
      moistA.array as Float32Array,
      surfA.array as Float32Array,
      data.surface,
      tmpRange,
    );

    posAttr.needsUpdate = true;
    nrmAttr.needsUpdate = true;
    moistA.needsUpdate = true;
    surfA.needsUpdate = true;

    // Analytic bounding sphere — no vertex scan on the main thread.
    const midY = (tmpRange.minY + tmpRange.maxY) / 2;
    const radY =
      Math.max(Math.abs(tmpRange.minY - midY), Math.abs(tmpRange.maxY - midY)) +
      skirtDepth(step);
    entry.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(chunkHalf, midY, chunkHalf),
      Math.hypot(chunkHalf, radY, chunkHalf),
    );

    entry.mesh.position.set(originX, 0, originZ);
    entry.mesh.matrixAutoUpdate = false;
    entry.mesh.updateMatrix();
    entry.mesh.visible = true;
    return entry;
  }

  release(entry: PooledChunkMesh): void {
    entry.mesh.visible = false;
    let free = this.freeByStep.get(entry.step);
    if (!free) {
      free = [];
      this.freeByStep.set(entry.step, free);
    }
    if (free.length < POOL_CAP_PER_LEVEL) free.push(entry);
  }

  pooledCount(): number {
    let n = 0;
    for (const list of this.freeByStep.values()) n += list.length;
    return n;
  }

  dispose(): void {
    for (const list of this.freeByStep.values()) {
      for (const e of list) e.geometry.dispose();
    }
    this.freeByStep.clear();
  }

  private create(step: number): PooledChunkMesh {
    const cap = totalVerts(step);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
    geometry.setAttribute('aMoisture', new THREE.BufferAttribute(new Float32Array(cap), 1));
    geometry.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array(cap), 1));
    geometry.setIndex(this.indexFor(step));
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.frustumCulled = true;
    return { geometry, mesh, step };
  }
}

const tmpRange = { minY: 0, maxY: 0 };
