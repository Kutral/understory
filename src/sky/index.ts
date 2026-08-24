/**
 * Public entry for the sky/atmosphere subsystem.
 *
 * createSkySystem() returns a SkySystem (contract in @contracts/sky). With a
 * scene it also attaches the TSL visuals and pushes uniforms every tick; the
 * caller must call apply() once per RENDERED frame with the active camera
 * (returned as `applyVisuals`) — or simply use fixedUpdate-only mode for
 * headless/testing use.
 */

import type { Scene } from 'three/webgpu';
import type { Camera } from 'three/webgpu';
import type { EventBus } from '@contracts/events';
import type { SkySystem } from '@contracts/sky';
import { sunAzimuthRad } from './palette';
import { SkySystemImpl } from './SkySystemImpl';
import { createSkyVisuals, type SkyVisuals } from './visuals';

export interface SkySystemOptions {
  bus?: EventBus;
  scene?: Scene;
  seed?: number;
}

export interface AttachedSkySystem extends SkySystem {
  /** Call once per rendered frame (after ticks) to push uniforms/lights. */
  applyVisuals(camera: Camera): void;
  getSnapshot(): import('@contracts/sky').SkySnapshot;
  /** Debug/test-only: settle weather instantly (no fade). */
  debugSettleWeather(w: 'clear' | 'mist' | 'drizzle' | 'rain' | 'afterRain'): void;
}

export function createSkySystem(opts: SkySystemOptions = {}): AttachedSkySystem {
  const sky = new SkySystemImpl(opts.bus ?? null, opts.seed ?? 0x5eed);

  if (!opts.scene) {
    return {
      lightState: sky.lightState,
      weather: sky.weather,
      setTimeOfDay: (h) => sky.setTimeOfDay(h),
      setDriftMode: (on) => sky.setDriftMode(on),
      setWeather: (w) => sky.setWeather(w),
      fixedUpdate: (dt) => sky.fixedUpdate(dt),
      dispose: () => sky.dispose(),
      applyVisuals: () => {},
      getSnapshot: () => sky.getSnapshot(),
      debugSettleWeather: (w) => sky.debugSettleWeather(w),
    };
  }

  const scene = opts.scene;
  const visuals: SkyVisuals = createSkyVisuals(scene, opts.seed ?? 0x5eed, sunAzimuthRad);

  return {
    get lightState() {
      return sky.lightState;
    },
    get weather() {
      return sky.weather;
    },
    setTimeOfDay: (h) => sky.setTimeOfDay(h),
    setDriftMode: (on) => sky.setDriftMode(on),
    setWeather: (w) => sky.setWeather(w),
    fixedUpdate: (dt) => sky.fixedUpdate(dt),
    dispose: () => {
      visuals.dispose(scene);
      sky.dispose();
    },
    applyVisuals: (camera) => visuals.apply(sky.fullState, camera),
    getSnapshot: () => sky.getSnapshot(),
    debugSettleWeather: (w) => sky.debugSettleWeather(w),
  };
}
