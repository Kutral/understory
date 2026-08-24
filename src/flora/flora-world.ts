import * as THREE from 'three/webgpu';
import type { ChunkKey } from '@contracts/world';
import type { World as RapierWorld } from '@dimforge/rapier3d-compat';
import {
  TrunkColliderRing,
  type RapierAPI,
  type TrunkCandidate,
} from './colliders';
import {
  buildImpostorFrame,
  buildPine,
  IMPOSTOR_HEIGHT_M,
  type PineLod,
} from './geometry';
import { createImpostorTexture } from './impostor-texture';
import {
  createImpostorMaterial,
  createPineMaterial,
  makeInstanceData,
  type WindUniforms,
} from './material';
import {
  assignBands,
  FAR_CAP,
  FULL_CAP,
  materializePlacements,
  MID_CAP,
  treesFor,
  type BandAssignments,
  type PlacedTree,
  type SurfaceSampler,
} from './placement';

/**
 * FloraWorld — Wave 1.5 vertical-slice facade for the pine species.
 *
 * Add `mesh` to the scene, call `update(carX, carZ, dt)` each frame and
 * `syncTrunkColliders(carX, carZ)` after physics attach. Everything else
 * (chunk placement caching, LOD banding under budget caps, wind uniforms,
 * pooled trunk colliders) is internal.
 *
 * Terrain coupling is injected: pass your TerrainSource-shaped object as
 * `sampler` (it only needs heightAt / gradientMag / moistureAt). Without one,
 * a flat deterministic fallback keeps construction safe for tests/tooling.
 */

/** Chebyshev chunk rings covered with trees (~512m reach inside the 640m view). */
export const FLORA_RINGS = 4;
/** Placement cache/rebuild granularity in metres. */
const REBUILD_CELL_M = 24;
const CHUNK = 128;

interface RingDraw {
  readonly mesh: THREE.InstancedMesh;
  readonly data: THREE.InstancedBufferAttribute;
  /** Max distance this band renders at (+margin for its bounding sphere). */
  readonly bandMaxM: number;
}

export interface FloraStats {
  /** Chunks with cached placements. */
  chunks: number;
  /** Cumulative placement-generation CPU time, ms. */
  genMsTotal: number;
  /** Worst single-chunk generation seen, ms. */
  genMsWorst: number;
  /** Last full rebuild of instance buffers, ms. */
  rebuildMs: number;
  counts: { full: number; mid: number; far: number; impostor: number };
  /** Impostors dropped because they exceeded buffer capacity (0 normally). */
  impostorOverflow: number;
  /** Populated instanced draws this frame (≤ 4). */
  drawCalls: number;
  colliders: { live: number; pooled: number };
}

interface CachedChunk {
  readonly key: ChunkKey;
  readonly trees: PlacedTree[];
  readonly genMs: number;
}

export interface FloraWorldOptions {
  seed?: number;
  sampler?: SurfaceSampler;
  /** Impostor instance capacity (default 6144 ≈ dense-forest worst case). */
  impostorCapacity?: number;
}

function fallbackSampler(): SurfaceSampler {
  // Deterministic flat world for node-side construction (tests, tooling).
  return {
    heightAt: () => 0,
    gradientMag: () => 0,
    moistureAt: (x, z) => {
      let h = Math.imul((x * 997) | 0, 0x27d4eb2d) ^ Math.imul((z * 991) | 0, 0x165667b1);
      h ^= h >>> 15;
      return (((h >>> 0) % 4096) / 4096) * 0.55 + 0.25;
    },
  };
}

export class FloraWorld {
  /** Add this to your scene. */
  readonly mesh: THREE.Object3D = new THREE.Group();

  private readonly sampler: SurfaceSampler;
  private readonly seed: number;
  private readonly cache = new Map<string, CachedChunk>();
  private readonly rings: Record<PineLod | 'impostor', RingDraw>;
  private readonly pineUniforms: WindUniforms;
  private readonly impostorUniforms: WindUniforms;
  private readonly pineMaterial: THREE.MeshStandardNodeMaterial;
  private readonly impostorMaterial: THREE.MeshStandardNodeMaterial;
  private readonly geometries: THREE.BufferGeometry[] = [];

  private readonly impostorCapacity: number;
  private readonly bandData: THREE.InstancedBufferAttribute;
  private nearCandidates: TrunkCandidate[] = [];
  private colliders: TrunkColliderRing | null = null;
  private rapierApi: RapierAPI | null = null;

  private lastCellX = Number.NaN;
  private lastCellZ = Number.NaN;
  private carX = 0;
  private carZ = 0;

  private stats_: FloraStats = {
    chunks: 0,
    genMsTotal: 0,
    genMsWorst: 0,
    rebuildMs: 0,
    counts: { full: 0, mid: 0, far: 0, impostor: 0 },
    impostorOverflow: 0,
    drawCalls: 0,
    colliders: { live: 0, pooled: 0 },
  };

  constructor(options: FloraWorldOptions = {}) {
    this.seed = options.seed ?? 1337;
    this.sampler = options.sampler ?? fallbackSampler();
    this.impostorCapacity = options.impostorCapacity ?? 6144;

    // --- materials & instance buffers ---
    // One shared aData buffer across the three geometry LODs feeds a single
    // pine pipeline; the impostor gets its own (larger) buffer + material.
    const bandCapacity = Math.max(FULL_CAP, MID_CAP, FAR_CAP);
    const bandData = makeInstanceData(bandCapacity);
    const pine = createPineMaterial(bandData);
    this.pineMaterial = pine.material;
    this.pineUniforms = pine.uniforms;
    this.bandData = bandData;

    const impData = makeInstanceData(this.impostorCapacity);
    const imp = createImpostorMaterial(createImpostorTexture(), impData);
    this.impostorMaterial = imp.material;
    this.impostorUniforms = imp.uniforms;

    // --- LOD meshes ---
    const group = this.mesh as THREE.Group;
    const lods: PineLod[] = ['full', 'mid', 'far'];
    const capacities: Record<PineLod | 'impostor', number> = {
      full: FULL_CAP,
      mid: MID_CAP,
      far: FAR_CAP,
      impostor: this.impostorCapacity,
    };
    const bandMax: Record<PineLod | 'impostor', number> = {
      full: 60,
      mid: 140,
      far: 260,
      impostor: 520,
    };
    const built = {} as Record<PineLod | 'impostor', RingDraw>;

    for (const lod of [...lods, 'impostor' as const]) {
      const { geometry } =
        lod === 'impostor' ? buildImpostorFrame() : buildPine(lod);
      const data = lod === 'impostor' ? impData : bandData;
      geometry.setAttribute('aData', data);
      const mesh = new THREE.InstancedMesh(geometry, lod === 'impostor' ? this.impostorMaterial : this.pineMaterial, capacities[lod]);
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = true;
      this.geometries.push(geometry);
      group.add(mesh);
      built[lod] = { mesh, data, bandMaxM: bandMax[lod] };
    }
    this.rings = built;
  }

  /**
   * Optional late binding of physics, mirroring TerrainWorld.attachPhysics.
   * Before this, syncTrunkColliders is a no-op unless a rapierWorld is passed
   * directly to it.
   */
  attachPhysics(rapier: RapierAPI, rapierWorld: RapierWorld): void {
    this.rapierApi = rapier;
    if (!this.colliders) this.colliders = new TrunkColliderRing(rapierWorld, rapier);
  }

  /**
   * Ensure pooled cylinder trunk colliders exist for every tree within
   * TRUNK_COLLIDER_RADIUS_M (40m) of the car. The rapierWorld argument is
   * honored when physics wasn't pre-attached via attachPhysics.
   */
  syncTrunkColliders(carX: number, carZ: number, rapierWorld?: RapierWorld): void {
    if (!this.colliders && this.rapierApi && rapierWorld) {
      this.colliders = new TrunkColliderRing(rapierWorld, this.rapierApi);
    }
    if (!this.colliders) return;
    this.colliders.sync(carX, carZ, this.nearCandidates);
  }

  update(carX: number, carZ: number, dtS = 1 / 60): void {
    // Wind advances every frame regardless of streaming state.
    this.pineUniforms.time.value += dtS;
    this.impostorUniforms.time.value += dtS;
    // Slow weather-scale gust-strength breathing (waves still travel).
    const breathe = 0.85 + 0.3 * Math.sin(this.pineUniforms.time.value * 0.11);
    this.pineUniforms.amp.value = 0.42 * breathe;
    this.impostorUniforms.amp.value = 0.3 * breathe;

    const cellX = Math.floor(carX / REBUILD_CELL_M);
    const cellZ = Math.floor(carZ / REBUILD_CELL_M);
    if (cellX !== this.lastCellX || cellZ !== this.lastCellZ) {
      this.lastCellX = cellX;
      this.lastCellZ = cellZ;
      this.carX = carX;
      this.carZ = carZ;
      this.rebuild();
    }

    this.stats_.drawCalls =
      (this.rings.full.mesh.count > 0 ? 1 : 0) +
      (this.rings.mid.mesh.count > 0 ? 1 : 0) +
      (this.rings.far.mesh.count > 0 ? 1 : 0) +
      (this.rings.impostor.mesh.count > 0 ? 1 : 0);
    this.stats_.colliders = {
      live: this.colliders?.size ?? 0,
      pooled: this.colliders?.pooledCount ?? 0,
    };
  }

  private chunkFor(key: ChunkKey): CachedChunk {
    const k = `${key.cx},${key.cz}`;
    const hit = this.cache.get(k);
    if (hit) return hit;

    const t0 = performance.now();
    const placements = treesFor(key, this.seed, this.sampler);
    const trees = materializePlacements(key, placements, this.sampler);
    const genMs = performance.now() - t0;
    const entry: CachedChunk = { key, trees, genMs };
    this.cache.set(k, entry);
    this.stats_.genMsTotal += genMs;
    this.stats_.genMsWorst = Math.max(this.stats_.genMsWorst, genMs);
    return entry;
  }

  private rebuild(): void {
    const t0 = performance.now();
    const ccx = Math.floor(this.carX / CHUNK);
    const ccz = Math.floor(this.carZ / CHUNK);
    const r2max = 520 * 520;
    const near2 = 40 * 40;

    const gathered: PlacedTree[] = [];
    const near: TrunkCandidate[] = [];
    for (let dx = -FLORA_RINGS; dx <= FLORA_RINGS; dx++) {
      for (let dz = -FLORA_RINGS; dz <= FLORA_RINGS; dz++) {
        const key: ChunkKey = { cx: ccx + dx, cz: ccz + dz };
        const chunk = this.chunkFor(key);
        for (let i = 0; i < chunk.trees.length; i++) {
          const tree = chunk.trees[i];
          if (!tree) continue;
          const ddx = tree.wx - this.carX;
          const ddz = tree.wz - this.carZ;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 > r2max) continue;
          gathered.push({ ...tree, distSq: d2 });
          if (d2 <= near2) {
            near.push({ id: `${key.cx},${key.cz}#${i}`, x: tree.wx, y: tree.y, z: tree.wz });
          }
        }
      }
    }
    this.nearCandidates = near;
    this.stats_.chunks = this.cache.size;

    const bands = assignBands(gathered);
    this.fillBand('full', bands);
    this.fillBand('mid', bands);
    this.fillBand('far', bands);

    // Impostors: assignBands sorts ascending by distance, so truncating at
    // capacity keeps the NEAREST ones — overflow is always the farthest trees.
    const impList = bands.impostor;
    const nImp = Math.min(impList.length, this.impostorCapacity);
    this.stats_.impostorOverflow = impList.length - nImp;
    this.fillInstances(this.rings.impostor, impList, nImp);

    this.stats_.rebuildMs = performance.now() - t0;
    this.stats_.counts = {
      full: this.rings.full.mesh.count,
      mid: this.rings.mid.mesh.count,
      far: this.rings.far.mesh.count,
      impostor: this.rings.impostor.mesh.count,
    };
  }

  private fillBand(lod: PineLod, bands: BandAssignments): void {
    const list = bands[lod];
    this.fillInstances(this.rings[lod], list, Math.min(list.length, this.rings[lod].data.count));
  }

  private fillInstances(draw: RingDraw, list: readonly PlacedTree[], n: number): void {
    for (let i = 0; i < n; i++) {
      const t = list[i];
      if (!t) continue;
      this.writeInstance(
        draw,
        i,
        t.wx,
        t.y,
        t.wz,
        t.placement.scale,
        t.placement.rotY,
        t.placement.hue,
      );
    }
    draw.mesh.count = n;
    draw.mesh.instanceMatrix.needsUpdate = true;
    draw.data.needsUpdate = true;
    // Instances live in world space (group at origin), so the frustum-cull
    // sphere is centred on the rebuild origin covering the whole band.
    const bs = draw.mesh.geometry.boundingSphere ?? new THREE.Sphere();
    bs.center.set(this.carX, IMPOSTOR_HEIGHT_M / 2, this.carZ);
    bs.radius = draw.bandMaxM + IMPOSTOR_HEIGHT_M;
    draw.mesh.geometry.boundingSphere = bs;
  }

  private writeInstance(
    draw: RingDraw,
    i: number,
    wx: number,
    y: number,
    wz: number,
    scale: number,
    rotY: number,
    hue: number,
  ): void {
    const m = draw.mesh.instanceMatrix.array as Float32Array;
    const c = Math.cos(rotY) * scale;
    const s = Math.sin(rotY) * scale;
    // Column-major R_y(θ)·S then translation.
    m[i * 16 + 0] = c;
    m[i * 16 + 1] = 0;
    m[i * 16 + 2] = -s;
    m[i * 16 + 3] = 0;
    m[i * 16 + 4] = 0;
    m[i * 16 + 5] = scale;
    m[i * 16 + 6] = 0;
    m[i * 16 + 7] = 0;
    m[i * 16 + 8] = s;
    m[i * 16 + 9] = 0;
    m[i * 16 + 10] = c;
    m[i * 16 + 11] = 0;
    m[i * 16 + 12] = wx;
    m[i * 16 + 13] = y;
    m[i * 16 + 14] = wz;
    m[i * 16 + 15] = 1;

    const d = draw.data.array as Float32Array;
    d[i * 4 + 0] = wx;
    d[i * 4 + 1] = wz;
    d[i * 4 + 2] = rotY / (Math.PI * 2); // phase decorrelates flutter
    d[i * 4 + 3] = hue;
  }

  stats(): FloraStats {
    return {
      ...this.stats_,
      counts: { ...this.stats_.counts },
      colliders: { ...this.stats_.colliders },
    };
  }

  dispose(): void {
    const group = this.mesh as THREE.Group;
    group.clear();
    for (const g of this.geometries) g.dispose();
    this.geometries.length = 0;
    this.pineMaterial.dispose();
    this.impostorMaterial.dispose();
    this.cache.clear();
    this.colliders?.dispose();
    this.colliders = null;
  }
}
