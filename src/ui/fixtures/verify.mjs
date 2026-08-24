/* eslint-disable */
/**
 * UI-shell verification runner (dev tool, not shipped).
 *
 * Opens each fixture screen in headless Chromium against the vite dev
 * server, runs axe-core, exercises keyboard paths, benchmarks per-frame
 * flush cost under telemetry load, and screenshots every state into
 * src/ui/fixtures/screens/.
 *
 *   node src/ui/fixtures/verify.mjs [baseUrl]
 *   default baseUrl: http://localhost:5199/understory
 */
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const axePath = path.join(
  process.env.LOCALAPPDATA ?? '/tmp',
  'Temp',
  'axe.min.js',
);
const axe = readFileSync(axePath, 'utf8');
const base = process.argv[2] ?? 'http://localhost:5199/understory';
const shotDir = path.join(here, 'screens');
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const report = { pages: {}, keyboard: {}, frames: {} };

async function withPage(name, fn) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/src/ui/fixtures/${name}.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  try {
    await fn(page);
  } catch (err) {
    report.pages[name] = { error: String(err) };
  }
  await page.close();
}

async function runAxe(page) {
  await page.evaluate((axeSrc) => {
    window.__axe = new Function(`${axeSrc}; return axe;`)();
  }, axe);
  const violations = await page.evaluate(async () => {
    const r = await window.__axe.run(document, { resultTypes: ['violations'] });
    return r.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      help: v.help,
    }));
  });
  return {
    all: violations,
    seriousOrCritical: violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    ),
  };
}

// ---- opening ---------------------------------------------------------------
await withPage('opening', async (page) => {
  const line = await page.textContent('.us-opening__line');
  const fontOk = await page.evaluate(() => document.fonts.check('italic 600 32px Vollkorn'));
  // settings panel must NOT be visible during the opening
  const pauseVisibleDuringOpening = await page.isVisible('.us-veil');
  await page.screenshot({ path: path.join(shotDir, 'opening.png') });
  report.pages.opening = {
    line,
    vollkornLoaded: fontOk,
    pauseVisibleDuringOpening,
    axe: await runAxe(page),
  };
});

// ---- driving HUD -----------------------------------------------------------
await withPage('hud', async (page) => {
  await page.waitForSelector('.us-hud[data-hidden="false"]');
  const speed = await page.textContent('.us-dial__speed');

  // benchmark: feed speed telemetry at ~60Hz for 2s while sampling flush cost
  const uiStats = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const timer = setInterval(() => {
          window.__ui.setSpeed(30 + 20 * Math.random());
          window.__ui.setTimeOfDay(0.25 + Math.random() * 0.01);
          if (++n >= 120) clearInterval(timer);
        }, 16);
        setTimeout(() => resolve(window.__ui.uiStats()), 2400);
      }),
  );
  report.frames.hudTelemetry = uiStats;

  // real idle timer: stop pinning, wait past HUD_IDLE_HIDE_S
  await page.screenshot({ path: path.join(shotDir, 'hud-visible.png') });
  await page.evaluate(() => clearInterval(window.__pin));
  await page.waitForFunction(() => document.querySelector('.us-hud').dataset.hidden === 'true', null, {
    timeout: 8000,
  });
  await page.screenshot({ path: path.join(shotDir, 'hud-faded.png') });
  // returns on input
  await page.keyboard.press('KeyW');
  await page.waitForTimeout(150);
  const hudStateAfterInput = await page.getAttribute('.us-hud', 'data-hidden');
  await page.keyboard.press('Escape'); // settings from any moment
  await page.waitForSelector('.us-pause', { state: 'visible' });
  report.pages.hud = { speedShown: speed, hudStateAfterInput, idleHideWorked: true };
});

// ---- pause / settings --------------------------------------------------------
await withPage('pause', async (page) => {
  await page.waitForSelector('.us-pause');
  await page.screenshot({ path: path.join(shotDir, 'pause.png') });
  const axeRes = await runAxe(page);

  // full keyboard pass: Tab through every control, record focus order
  const focused = [];
  let prevKey = '';
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const label =
        el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 24) ?? el.id ?? '';
      return `${el.tagName}:${el.getAttribute('class')?.split(' ')[0] ?? ''}:${label}`;
    });
    if (!f || f === prevKey) break;
    focused.push(f);
    prevKey = f;
  }
  await page.screenshot({ path: path.join(shotDir, 'pause-focus.png') });

  // Escape closes back out
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  const closed = await page.evaluate(() => getComputedStyle(document.querySelector('.us-veil')).display === 'none');

  report.pages.pause = { axe: axeRes, tabOrder: focused, escapeCloses: closed };
});

// ---- reduced motion ----------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(`${base}/src/ui/fixtures/pause.html`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.us-pause');
  await page.getByRole('checkbox').first().check();
  await page.waitForTimeout(100);
  report.keyboard.reducedMotionAttr = await page.getAttribute('.us-root', 'data-reduced-motion');

  // remap capture: click a key binding, press a new key, check label updates
  await page.click('.us-key >> nth=0');
  const listening = await page.textContent('.us-key >> nth=0');
  await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(100);
  const rebound = await page.textContent('.us-key >> nth=0');
  report.keyboard.remap = { listeningLabel: listening, afterPress: rebound };

  // silence preset zeroes the non-master faders
  await page.getByRole('button', { name: 'Silence' }).click();
  await page.waitForTimeout(100);
  report.keyboard.silenceApplied = await page.evaluate(() =>
    [...document.querySelectorAll('.us-mixer input[type="range"]')]
      .slice(0, 5) // engine, tyres, ambience, music, wind — master stays
      .every((i) => i.value === '0'),
  );
  await page.close();
}

await browser.close();
console.log(JSON.stringify(report, null, 2));
