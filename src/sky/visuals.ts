/**
 * Visual assembly: binds the pure SkySystem state to the TSL scene objects.
 * Owns nothing about the state machine — see SkySystemImpl / index.ts.
 */

import * as THREE from 'three/webgpu';
import type { Color, Scene } from 'three/webgpu';
import type { SkyFullState } from './SkySystemImpl';
import { createSkyDome, type SkyDomeUniforms } from './skyDome';
import { createStars } from './stars';
import { createCloudSheets, type CloudUniforms } from './clouds';
import { createHeightFog, type FogUniforms } from './heightFog';
import { createLuminaries, type Luminaries } from './luminaries';

export interface SkyVisuals {
  apply(state: Readonly<SkyFullState>, camera: THREE.Camera): void;
  dispose(scene: Scene): void;
}

const _sunDir = new THREE.Vector3();
const _moonDir = new THREE.Vector3();

/** Convert an elevation/azimuth pair to a y-up unit direction. */
function dirFromElevAz(elevDeg: number, azRad: number, out: THREE.Vector3): THREE.Vector3 {
  const e = (elevDeg * Math.PI) / 180;
  out.set(Math.cos(e) * Math.sin(azRad), Math.sin(e), Math.cos(e) * -Math.cos(azRad));
  return out;
}

function setColor(u: { value: Color }, rgb: readonly [number, number, number]): void {
  u.value.setRGB(rgb[0], rgb[1], rgb[2]);
}

export function createSkyVisuals(
  scene: Scene,
  seed: number,
  sunAzimuthAt: (t: number) => number,
): SkyVisuals {
  const dome = createSkyDome();
  const stars = createStars(seed);
  const clouds = createCloudSheets();
  const fogKit = createHeightFog();
  const lums = createLuminaries();

  scene.add(
    dome.mesh,
    stars.points,
    clouds.group,
    lums.key,
    lums.key.target,
    lums.ambient,
    lums.moonMesh,
  );
  fogKit.apply(scene);

  function apply(state: Readonly<SkyFullState>, camera: THREE.Camera): void {
    const a = state.atmosphere;
    const az = sunAzimuthAt(state.timeOfDay);

    dirFromElevAz(state.sunElevationDeg, az, _sunDir);
    dirFromElevAz(state.moonElevationDeg, az + Math.PI, _moonDir);

    // Dome
    setColor(dome.uniforms.zenith, a.zenith);
    setColor(dome.uniforms.horizon, a.horizon);
    setColor(dome.uniforms.glowColor, a.horizonGlow);
    dome.uniforms.glowStrength.value = a.glowStrength;
    dome.uniforms.sunDir.value.copy(_sunDir);
    dome.uniforms.sunDisc.value = Math.max(0, Math.min(1, (state.sunElevationDeg + 1) / 4));
    setColor(dome.uniforms.belowColor, a.fogColor);

    stars.setOpacity(a.starOpacity);

    // Clouds — dim with the key light so night sheets never glow.
    clouds.uniforms.cover.value = a.cloudCover;
    clouds.uniforms.dark.value = a.cloudDark;
    clouds.uniforms.wind.value = a.windSpeed;
    setColor(clouds.uniforms.cloudColor, a.cloudColor);
    clouds.uniforms.opacity.value = 0.25 + 0.75 * Math.min(1, a.keyIntensity / 2.5);

    // Fog + in-scatter
    setColor(fogKit.uniforms.fogColor, a.fogColor);
    fogKit.uniforms.density.value = a.fogDensity;
    setColor(fogKit.uniforms.sunTint, a.keyColor);
    fogKit.uniforms.inScatter.value =
      Math.min(0.85, a.glowStrength * 0.5 + 0.15) * (a.rain > 0.8 ? 0.4 : 1);
    fogKit.uniforms.sunDir.value.copy(_sunDir);

    lums.update(
      _sunDir,
      _moonDir,
      a.keyColor,
      a.keyIntensity,
      a.ambientColor,
      a.ambientIntensity,
      a.moonDiscOpacity,
      camera.position,
    );
  }

  return {
    apply,
    dispose(sc: Scene) {
      sc.remove(
        dome.mesh,
        stars.points,
        clouds.group,
        lums.key,
        lums.key.target,
        lums.ambient,
        lums.moonMesh,
      );
      dome.dispose();
      stars.dispose();
      clouds.dispose();
      lums.dispose();
      fogKit.dispose(sc);
    },
  };
}

// Re-export for typing convenience elsewhere.
export type { SkyDomeUniforms, CloudUniforms, FogUniforms, Luminaries };
