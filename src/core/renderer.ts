import * as THREE from 'three/webgpu';
import type { BackendName } from '@contracts/core';

/**
 * RenderCore — owns the WebGPURenderer instance and its global render state.
 *
 * - Runtime capability detection: tries the WebGPU backend first; if `init()`
 *   throws (device request/context creation failure), retries once with
 *   `forceWebGL: true` on a fresh renderer. Note that three's own silent
 *   fallback (when `navigator.gpu` is merely absent) lands on WebGL2 too —
 *   both paths are detected by probing `renderer.backend.isWebGPUBackend`.
 * - Tone mapping: AgX (see docs/notes/render-core.md for justification vs Neutral).
 * - Color space: canvas output is sRGB; scene-lit colors stay linear-sRGB in
 *   the shader graph (three default working color space). Color textures must
 *   be uploaded with `SRGBColorSpace`; data textures keep `NoColorSpace`.
 */
export class RenderCore {
  /** Reassigned during init() if the WebGPU attempt fails. */
  renderer: THREE.WebGPURenderer;
  backend: BackendName | null = null;

  private readonly canvas: HTMLCanvasElement;
  private readonly antialias: boolean;

  constructor(canvas: HTMLCanvasElement, antialias = true) {
    this.canvas = canvas;
    this.antialias = antialias;
    this.renderer = RenderCore.create(canvas, antialias, false);
  }

  private static create(
    canvas: HTMLCanvasElement,
    antialias: boolean,
    forceWebGL: boolean,
  ): THREE.WebGPURenderer {
    return new THREE.WebGPURenderer({
      canvas,
      antialias,
      alpha: false, // opaque default framebuffer: cheaper composite, no bleed-through
      forceWebGL,
    });
  }

  async init(): Promise<BackendName> {
    let renderer = this.renderer;
    try {
      await renderer.init();
    } catch (err) {
      console.warn('[understory] WebGPU init failed; retrying with WebGL2 backend.', err);
      try {
        renderer.dispose();
      } catch {
        // a half-initialized backend may fail dispose; nothing to salvage
      }
      renderer = RenderCore.create(this.canvas, this.antialias, true);
      this.renderer = renderer;
      await renderer.init(); // if this also throws, boot fails loudly — correct behavior
    }

    const probe = renderer.backend as { isWebGPUBackend?: boolean };
    this.backend = probe.isWebGPUBackend === true ? 'webgpu' : 'webgl2';

    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    console.info(`[understory] backend: ${this.backend}; tone mapping: AgX`);
    return this.backend;
  }
}
