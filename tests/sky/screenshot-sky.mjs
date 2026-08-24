/* eslint-disable no-undef -- standalone node script; repo's TS-only global block doesn't cover .mjs */
/**
 * Deterministic sky screenshot suite.
 *
 * Usage:  node tests/sky/screenshot-sky.mjs
 * Output: docs/notes/sky-atmosphere-shots/<name>.png
 *
 * Boots the vite dev server in-process, opens tests/sky/harness.html in
 * headless Chromium with SwiftShader (forced WebGL), scrubs to fixed times /
 * weather states, and captures. Fixed seed + fixed camera → byte-comparable
 * framing across runs (GPU raster still varies slightly; treat as visual
 * regression evidence, not pixel hashes).
 */

import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = path.join(root, 'docs/notes/sky-atmosphere-shots');
mkdirSync(outDir, { recursive: true });

const SCENES = [
  { name: 'dawn-clear', time: 6.05, weather: 'clear' },
  { name: 'morning-clear', time: 9, weather: 'clear' },
  { name: 'goldenhour-clear', time: 17.3, weather: 'clear' },
  { name: 'dusk-clear', time: 18.05, weather: 'clear' },
  { name: 'bluehour-clear', time: 18.25, weather: 'clear' },
  { name: 'night-clear-moon-stars', time: 0.5, weather: 'clear' },
  { name: 'morning-mist', time: 7.5, weather: 'mist' },
  { name: 'morning-drizzle', time: 9, weather: 'drizzle' },
  { name: 'morning-rain', time: 9, weather: 'rain' },
  { name: 'afterrain-golden', time: 17.3, weather: 'afterRain' },
];

const server = await createServer({
  root,
  server: { port: 0, strictPort: false }, // random free port
  logLevel: 'error',
});
await server.listen();
const baseUrl = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5199/';

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-lcd-text',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageexception]', e.message));

await page.goto(new URL('tests/sky/harness.html', baseUrl).href);
await page.waitForFunction(() => document.querySelector('canvas') !== null);

let failures = 0;
for (const scene of SCENES) {
  try {
    await page.evaluate(([t, w]) => {
      window.__setTime(t);
      window.__setWeather(w);
    }, [scene.time, scene.weather]);
    // Let ~20 frames render after the state change (uniforms are per-frame).
    await page.waitForTimeout(600);
    const file = path.join(outDir, `${scene.name}.png`);
    await page.screenshot({ path: file });
    console.log('PASS', scene.name, '->', path.relative(root, file));
  } catch (e) {
    failures++;
    console.log('FAIL', scene.name, String(e));
  }
}

await browser.close();
await server.close();
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
