import './styles/base.css';
import * as THREE from 'three/webgpu';
import { GameLoop } from './core/loop';
import { RenderCore } from './core/renderer';
import { debugEnabled, DebugHud } from './core/debug';
import { createServices } from './core/services';
import { StubWorld } from './world/world';

async function boot(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#scene');
  if (!canvas) throw new Error('#scene canvas missing');

  const services = createServices();
  const render = new RenderCore(canvas);
  const backend = await render.init();

  const world = new StubWorld();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7c9aa6);
  scene.add(world.mesh);

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(0, 3, -8);
  camera.lookAt(0, 1, 0);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    render.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    render.renderer.setSize(innerWidth, innerHeight);
  });

  const loop = new GameLoop(
    () => {}, // tick stub; vehicle/world systems plug in here
    () => {
      render.renderer.render(scene, camera);
    },
    services.bus,
  );
  render.renderer.setAnimationLoop((t) => loop.frame(t));
  loop.start();

  if (debugEnabled()) {
    const hud = new DebugHud();
    hud.update({
      fps: 0,
      frameMs: 0,
      simMs: 0,
      renderMs: 0,
      uiMs: 0,
      drawCalls: 0,
      triangles: 0,
      instances: 0,
      heapMb: null,
      chunksLive: 0,
      backend,
      lightState: 'morning',
    });
  }

  console.info('[understory] booted');
}

void boot();
