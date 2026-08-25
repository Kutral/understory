import { expect, test } from '@playwright/test';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Screenshot gate (qa agent L): capture the game right after boot at a
 * fixed 1280x720 viewport into test-artifacts/boot.png and assert the
 * artifact exists and is a real render (>10KB — a blank/black frame
 * compresses far smaller).
 *
 * Same console-marker protocol as boot.spec.ts: collect ALL console lines
 * via page.on('console') into an array, then poll the array for
 * '[understory] booted' before touching anything else.
 */

const BOOT_TIMEOUT = 30_000;

test.use({ viewport: { width: 1280, height: 720 } });

test.describe('screenshots', () => {
  test('captures post-boot frame at 1280x720', async ({ page }) => {
    test.setTimeout(90_000);
    const consoleText: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'info' || m.type() === 'log' || m.type() === 'warning') {
        consoleText.push(m.text());
      }
    });

    // Explicit mount path — see the baseURL note in boot.spec.ts ('/'
    // resolves against the baseURL root, not the /understory/ app mount).
    await page.goto('/understory/', { waitUntil: 'domcontentloaded' });

    // Poll loop over the collected console array until the boot marker.
    const deadline = Date.now() + BOOT_TIMEOUT;
    while (
      Date.now() < deadline &&
      !consoleText.some((t) => t.includes('[understory] booted'))
    ) {
      await page.waitForTimeout(500);
    }
    expect(
      consoleText.some((t) => t.includes('[understory] booted')),
      'expected [understory] booted console marker',
    ).toBe(true);

    // Give the renderer a beat to present a real frame, then capture.
    await page.waitForTimeout(1_000);

    const outPath = path.resolve(process.cwd(), 'test-artifacts', 'boot.png');
    mkdirSync(path.dirname(outPath), { recursive: true });
    // page.screenshot stalls on rAF-driven pages waiting for network/paint
    // stability; the CDP compositor capture has no such wait. Use it first.
    const cdp = await page.context().newCDPSession(page);
    try {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(outPath, Buffer.from(data, 'base64'));
    } finally {
      await cdp.detach().catch(() => {});
    }

    const stat = statSync(outPath);
    expect(stat.isFile(), `${outPath} should exist`).toBe(true);
    expect(
      stat.size,
      `${outPath} should be a real render (>10KB)`,
    ).toBeGreaterThan(10 * 1024);
  });
});
