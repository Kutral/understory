/**
 * Wave 1.5 performance gate collector (docs/PERF-BUDGET.md).
 *
 * Two sequential runs — unthrottled and CPU-throttled 4x (CDP
 * Emulation.setCPUThrottlingRate) — each a continuous 3-minute drive over the
 * built bundle served by `pnpm preview` (playwright.config webServer).
 *
 * Outputs e2e/results/<mode>.json consumed by scripts/perf-report.mjs, which
 * renders docs/PERF.md. Raw in-page telemetry (all ~11k rAF deltas per run)
 * is kept next to the summaries as <mode>-raw.json for auditability.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { collectRun, preparePage, RUN_DURATION_MS, type RunResult } from './perf-collector';

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results');

for (const mode of ['unthrottled', 'throttled'] as const) {
  test(`perf collection: 3-minute continuous drive (${mode})`, async ({ page }) => {
    // 3 min drive + boot + reduction; default 120 s is far too short. The
    // +1500 s slack covers software-rasteriser stalls observed in this env.
    test.setTimeout(RUN_DURATION_MS + 1_500_000);

    await preparePage(page, mode);
    const result: RunResult = await collectRun(page, mode);

    mkdirSync(resultsDir, { recursive: true });
    writeFileSync(
      join(resultsDir, `${mode}.json`),
      JSON.stringify(result, null, 2),
    );
    const raw = await page.evaluate(() => window.__understoryPerf);
    writeFileSync(
      join(resultsDir, `${mode}-raw.json`),
      JSON.stringify(raw),
    );

    console.info(
      `[perf] ${mode}: p50=${result.frames.p50Ms.toFixed(2)}ms p99=${result.frames.p99Ms.toFixed(
        2,
      )}ms worst=${result.frames.worstMs.toFixed(1)}ms postLoadCompiles=${
        result.shaderCompiles.postLoadCompiles
      } verdict=${result.gate.verdict}`,
    );
  });
}
