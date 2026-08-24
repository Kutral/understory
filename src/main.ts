import './styles/fonts.css';
import './styles/base.css';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/hud.css';
import './styles/opening.css';
import './styles/pause.css';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { GameLoop } from './core/loop';
import { RenderCore } from './core/renderer';
import { DebugHud, debugEnabled } from './core/debug';
import { createServices } from './core/services';
import { QualityManager } from './core/quality';
import { TerrainWorld } from './world/terrain-world';
import { SoftVehicle } from './vehicle/vehicle';
import { InputSystemImpl } from './vehicle/input';
import { createSkySystem, type AttachedSkySystem } from './sky/index';
import { UnderstoryUi } from './ui/shell';
import { createAudioBus } from './audio/audio';

/**
 * Boot order follows the frame contract (src/contracts/frame.ts):
 * renderer -> world -> physics -> vehicle -> sky -> ui -> audio -> loop.
 * Every phase below happens once; the per-frame work is only fixedUpdate +
 * one interpolated render.
 */
async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  const uiRoot = document.querySelector<HTMLElement>('#ui');
  if (!canvas || !uiRoot) throw new Error('#scene canvas or #ui root missing');

  const services = createServices();
  const { bus } = services;

  // --- render -------------------------------------------------------------
  const render = new RenderCore(canvas);
  const backend = await render.init();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);

  // --- quality ------------------------------------------------------------
  const quality = new QualityManager(bus);
  quality.configure(backend, devicePixelRatio);
  quality.apply((pr) => {
    render.renderer.setPixelRatio(pr);
    render.renderer.setSize(innerWidth, innerHeight);
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    render.renderer.setSize(innerWidth, innerHeight);
  });

  // --- world ----------------------------------------------------------------
  const world = new TerrainWorld(2026);
  scene.add(world.mesh);

  // --- sky (attaches TSL visuals + lights to the scene) ----------------------
  const sky: AttachedSkySystem = createSkySystem({ bus, scene, seed: 0x5eed });
  sky.setDriftMode(true); // "let it drift": a full day every 40 real minutes

  // --- physics + vehicle ----------------------------------------------------
  await RAPIER.init();
  const rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.attachPhysics(
    RAPIER as unknown as Parameters<TerrainWorld['attachPhysics']>[0],
    rapierWorld,
  );

  const input = new InputSystemImpl();
  input.enableTouch();

  const vehicle = new SoftVehicle({
    surfaceAt: (x, z) => world.surfaceAt(x, z),
    heightAt: (x, z) => world.heightAt(x, z),
    scene: {
      add: (o: object) => {
        scene.add(o as THREE.Object3D);
      },
    },
  });
  await vehicle.init(rapierWorld);
  vehicle.place(0, 0);

  // --- audio (created after a user gesture unlocks it; see first keypress) ---
  let audio: ReturnType<typeof createAudioBus> | null = null;
  async function ensureAudio(): Promise<void> {
    if (audio) return;
    audio = createAudioBus();
    await audio.init(new AudioContext());
    bus.on('light/changed', ({ to }) => void to);
    // sky state flows into ambience beds:
    bus.on('weather/changed', () => {
      audio?.setSky(sky.lightState, sky.weather);
    });
    audio.setSky(sky.lightState, sky.weather);
  }
  void ensureAudio(); // browsers may suspend until gesture; resume attempted on start

  // --- ui ---------------------------------------------------------------------
  const ui = new UnderstoryUi({
    onStartDriving: () => {
      input.state.throttle = 0; // driving starts on the player's own foot
      void ensureAudio().then(() => audio?.resume());
      console.info('[understory] drive');
    },
    onQualityChange: (tier) => quality.setTier(tier),
    onGraphicsChange: ({ resolutionScale, fovDeg }) => {
      quality.settings = { ...quality.settings, dprScale: resolutionScale, fovDeg };
      camera.fov = fovDeg;
      camera.updateProjectionMatrix();
      render.renderer.setPixelRatio(quality.pixelRatio());
    },
    onVolumeChange: (ch, v) => audio?.setVolume(ch, v),
    onPresetChange: (p) => audio?.applyPreset(p),
    onBindingsChange: (bindings) => {
      for (const b of bindings) input.store.rebind(b.action, b.code);
    },
    onSeedChange: (seed) => {
      world.setSeed(seed);
      vehicle.place(0, 0);
    },
    onReducedMotionChange: () => {}, // fx agent (H) consumes this in Wave 2
    onHorizonLockChange: () => {}, // camera rig consumes this in Wave 1.5 slice
  });
  ui.mount(uiRoot, quality.settings);

  // --- debug overlay ---------------------------------------------------------
  const dbg = debugEnabled() ? new DebugHud() : null;

  // --- the loop ---------------------------------------------------------------
  const chaseTarget = new THREE.Object3D();
  scene.add(chaseTarget);
  camera.position.set(0, 4, -9);

  const loop = new GameLoop(
    () => {
      // 1. input
      const s = input.poll();
      // 2. vehicle (owns rapier world.step per frame contract)
      vehicle.fixedUpdate(1 / 60, s);
      // 3. world streaming around the car
      const t = vehicle.transform;
      world.update(t.px, t.pz);
      world.syncColliders(t.px, t.pz);
      // 5. sky
      sky.fixedUpdate(1 / 60);
      // 7. audio params (no allocation)
      audio?.update(
        Math.min(Math.abs(vehicle.state.speedMs) / 24, 1),
        vehicle.state.rpm01,
        vehicle.state.surface,
        Math.min(Math.abs(vehicle.state.speedMs) / 24, 1),
      );
      // UI telemetry (signal store batches DOM writes to frame boundary)
      ui.setSpeed(Math.abs(vehicle.state.speedMs) * 3.6);
      ui.setTimeOfDay(sky.getSnapshot().timeOfDay);
    },
    (_alpha) => {
      // interpolate the chassis transform between last two ticks
      const t = vehicle.transform;
      chaseTarget.position.set(t.px, t.py, t.pz);
      chaseTarget.quaternion.set(t.qx, t.qy, t.qz, t.qw);
      // simple calm chase cam (rig agent upgrades in Wave 1.5 slice)
      const behind = chaseTarget.position.clone();
      const back = new THREE.Vector3(0, 2.6, -7.5).applyQuaternion(chaseTarget.quaternion);
      camera.position.lerp(behind.add(back), 0.08);
      camera.lookAt(chaseTarget.position.x, chaseTarget.position.y + 1.2, chaseTarget.position.z);
      sky.applyVisuals(camera);

      quality.observeFrame(loop.frameMs);
      quality.update(performance.now(), (pr) => render.renderer.setPixelRatio(pr));

      render.renderer.render(scene, camera);

      dbg?.update({
        fps: loop.avgFrameMs > 0 ? Math.round(1000 / loop.avgFrameMs) : 0,
        frameMs: loop.frameMs,
        simMs: loop.simMs,
        renderMs: loop.renderMs,
        uiMs: 0,
        drawCalls: render.renderer.info.render.calls,
        triangles: render.renderer.info.render.triangles,
        instances: render.renderer.info.render.frameCalls,
        heapMb: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
          ? (performance as unknown as { memory: { usedJSHeapSize: number } }).memory
              .usedJSHeapSize /
            (1024 * 1024)
          : null,
        chunksLive: world.stats().live,
        backend,
        lightState: sky.lightState,
      });
    },
    bus,
  );
  render.renderer.setAnimationLoop((t) => loop.frame(t));
  loop.start();

  console.info(`[understory] booted — seed 2026, drift mode on`);
}

void boot();
