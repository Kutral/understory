import * as THREE from 'three/webgpu';
import type { BackendName } from '@contracts/core';

/**
 * render-core owns this. Stub: creates the renderer, logs backend, renders a flat scene.
 */
export class RenderCore {
  readonly renderer: THREE.WebGPURenderer;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      forceWebGL: false,
    });
  }

  async init(): Promise<BackendName> {
    await this.renderer.init();
    const probe = this.renderer.backend as { isWebGPUBackend?: boolean };
    const backend: BackendName = probe.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
    console.info(`[understory] backend: ${backend}`);
    return backend;
  }
}
