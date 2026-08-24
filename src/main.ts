import './styles/fonts.css';
import './styles/base.css';
import './styles/tokens.css';
import './styles/shell.css';
import './styles/hud.css';
import './styles/opening.css';
import './styles/pause.css';
import './styles/trace.css';
import './styles/photo.css';
import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three/webgpu';
import { CHUNK_RINGS } from '@contracts/constants';
import { GameLoop } from './core/loop';
import { RenderCore } from './core/renderer';
import { DebugHud, debugEnabled } from './core/debug';
import { createServices } from './core/services';
import { QualityManager } from './core/quality';
import { TerrainWorld } from './world/terrain-world';
import { SoftVehicle } from './vehicle/vehicle';
import { InputSystemImpl } from './vehicle/input';
import { createSkySystem, type AttachedSkySystem } from './sky/index';
import { ChaseCameraRig } from './camera/rig';
import { UnderstoryUi } from './ui/shell';
import { createAudioBus } from './audio/audio';
import { TraceRecorder, formatClock } from './ui/trace-store';
import { createTracePlate } from './ui/trace-plate';
import { createPhotoMode } from './ui/photo-mode';

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

  // --- autopilot (perf harness only: ?autopilot=1) -----------------------------
  const params = new URLSearchParams(location.search);
  const autopilot = params.has('autopilot');
  if (autopilot) {
    // Constant gentle drive for deterministic measurement runs.
    input.state.throttle = 0.7;
    let sweep = 0;
    setInterval(() => {
      sweep += 0.05;
      input.state.steer = Math.sin(sweep) * 0.3;
      void ensureAudio().catch(() => {}); // audio may stay suspended headless
    }, 50);
    console.info('[understory] autopilot engaged');
  }

  // --- debug overlay ---------------------------------------------------------
  const dbg = debugEnabled() ? new DebugHud() : null;

  // --- the loop ---------------------------------------------------------------
  const rig = new ChaseCameraRig(camera);

  // --- The Trace (signature) + photo mode -------------------------------------
  const SEED = 2026;
  const trace = new TraceRecorder(window.localStorage, (x, z) => world.heightAt(x, z));
  trace.beginSeed(SEED);
  let sessionT = 0;
  let plateEl: HTMLElement | null = null;

  function openPlate(): void {
    if (plateEl) return;
    const snap = sky.getSnapshot();
    const handle = createTracePlate(
      {
        seed: SEED,
        distanceM: trace.distanceM(),
        timeOfDay: formatClock(snap.timeOfDay * 24 * 60 / 60),
        weather: snap.weather,
        points: trace.exportForPlate().points,
        heights: trace.exportForPlate().heights,
        marks: trace.exportForPlate().marks,
      },
      { onClose: () => { plateEl = null; }, reducedMotion: ui.settings.reducedMotion },
    );
    plateEl = handle.root;
    document.body.append(handle.root);
    const btn = handle.root.querySelector<HTMLButtonElement>('.us-plate__close');
    btn?.focus();
  }

  const photo = createPhotoMode(rig, () => ({
    seed: SEED,
    distanceM: trace.distanceM(),
    timeOfDay: formatClock(sky.getSnapshot().timeOfDay * 24),
    weather: sky.getSnapshot().weather,
  }), async () => {
    // PNG export at 2x: render once at doubled pixel ratio, capture, restore.
    const pr = render.renderer.getPixelRatio();
    const size = new THREE.Vector2();
    render.renderer.getSize(size);
    try {
      render.renderer.setPixelRatio(pr * 2);
      render.renderer.render(scene, camera);
      const src = render.renderer.domElement;
      const out = document.createElement('canvas');
      out.width = src.width;
      out.height = src.height;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(src, 0, 0);
      const a = document.createElement('a');
      a.download = `understory-plate-${SEED}-${Date.now()}.png`;
      a.href = out.toDataURL('image/png');
      a.click();
    } finally {
      render.renderer.setPixelRatio(pr);
      render.renderer.setSize(size.x, size.y);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey) return;
    if (plateEl) return; // the plate handles its own close keys
    if (e.code === 'KeyM') {
      e.preventDefault();
      openPlate();
    } else if (e.code === 'KeyP') {
      e.preventDefault();
      photo.toggle();
    }
  });

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
      // 3.5 camera rig target update
      rig.fixedUpdate(1 / 60, t.px, t.py, t.pz);
      rig.setTargetOrientation(t.qx, t.qy, t.qz, t.qw);
      const lv = vehicle.chassisBody?.linvel();
      if (lv) rig.setTargetVelocity(lv.x, lv.y, lv.z);
      // 3.6 The Trace recorder (decimated internally; saves are throttled)
      sessionT += 1 / 60;
      trace.record(t.px, t.pz, sessionT, Math.abs(vehicle.state.speedMs));
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
      rig.render(_alpha);
      photo.update(1 / 60);
      sky.applyVisuals(camera);

      quality.observeFrame(loop.frameMs);
      quality.update(performance.now(), (pr) => render.renderer.setPixelRatio(pr));

      render.renderer.render(scene, camera);

      // Debug stats: only touch anything when the overlay exists (?debug=1).
      // The object literal below allocates, so it must stay behind this guard.
      if (dbg) {
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } })
          .memory;
        dbg.update({
          fps: loop.avgFrameMs > 0 ? Math.round(1000 / loop.avgFrameMs) : 0,
          frameMs: loop.frameMs,
          simMs: loop.simMs,
          renderMs: loop.renderMs,
          uiMs: 0,
          drawCalls: render.renderer.info.render.calls,
          triangles: render.renderer.info.render.triangles,
          instances: render.renderer.info.render.frameCalls,
          heapMb: mem ? mem.usedJSHeapSize / (1024 * 1024) : null,
          chunksLive: world.stats().live,
          backend,
          lightState: sky.lightState,
        });
      }
    },
    bus,
  );
  // --- pipeline warmup (perf gate: zero post-load shader compiles) -------------
  // Streaming only advances inside the fixed tick, so without this block the
  // first chunks attach AFTER the boot marker and their pipelines link lazily
  // mid-drive. Pump the streamer until the FULL desired chunk set is live —
  // every LOD step's pool entries are then created and compiled before boot is
  // declared; later driving only recycles existing entries (verified: with a
  // 25-chunk threshold the outer-ring step 4/8 pipelines still linked at ~2-4 s
  // into the drive). Best-effort: capped so a pathological environment cannot
  // hang boot.
  {
    const wantLive = (CHUNK_RINGS * 2 - 1) ** 2; // full 5-ring desired set = 121
    const warmupDeadline = performance.now() + 90_000;
    let warmedTo = 0;
    while (performance.now() < warmupDeadline) {
      const t = vehicle.transform;
      world.update(t.px, t.pz);
      warmedTo = world.stats().live;
      if (warmedTo >= wantLive) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    try {
      await render.renderer.compileAsync(scene, camera);
    } catch (err) {
      console.warn('[understory] pipeline warmup compileAsync failed', err);
    }
    console.info(`[understory] warmup: ${warmedTo}/${wantLive} chunks compiled pre-boot`);
  }

  render.renderer.setAnimationLoop((t) => loop.frame(t));
  loop.start();

  console.info(`[understory] booted — seed 2026, drift mode on`);
}

void boot();
