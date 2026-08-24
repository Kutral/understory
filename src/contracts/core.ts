import type { LightState } from './sky';

/** Quality tiers. Auto locks DPR to a 16.6ms rolling average, clamp 0.66..1.6. */
export type QualityTier = 'low' | 'medium' | 'high' | 'ultra' | 'auto';

export interface QualitySettings {
  tier: QualityTier;
  /** Device pixel ratio multiplier after auto-adjust. */
  dprScale: number;
  fovDeg: number;
  bloom: boolean;
  dof: boolean;
  grain: boolean;
  godRays: boolean;
  reducedMotion: boolean;
}

export type BackendName = 'webgpu' | 'webgl2';

/** Everything a subsystem needs from core, injected once at boot. */
export interface GameContext {
  readonly canvas: HTMLCanvasElement;
  readonly backend: BackendName;
  readonly quality: QualitySettings;
  seed: number;
}

export interface DebugStats {
  fps: number;
  frameMs: number;
  simMs: number;
  renderMs: number;
  uiMs: number;
  drawCalls: number;
  triangles: number;
  instances: number;
  heapMb: number | null;
  chunksLive: number;
  backend: BackendName;
  lightState: LightState;
}

export interface DebugOverlay {
  update(stats: DebugStats): void;
}
