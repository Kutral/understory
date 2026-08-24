import * as THREE from 'three/webgpu';

/**
 * world-terrain agent (B) owns this module tree.
 * Stub: flat green ground plane so the boot scene is not empty.
 */
export class StubWorld {
  readonly mesh: THREE.Mesh;

  constructor() {
    const geo = new THREE.PlaneGeometry(512, 512);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x2f4234 });
    this.mesh = new THREE.Mesh(geo, mat);
  }

  setSeed(_seed: number): void {}
  heightAt(): number {
    return 0;
  }
}

export class StubChunkProvider {}
