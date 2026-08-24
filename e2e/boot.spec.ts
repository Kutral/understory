import { expect, test } from '@playwright/test';

/**
 * Boot smoke (qa agent L): the game must reach its boot marker with zero
 * page errors. Headless CI runs SwiftShader -> WebGL2 fallback; generous
 * timeouts per docs/notes/qa.md.
 *
 * NOTE: the boot marker lives on the CONSOLE ('[understory] booted — …'),
 * not in the DOM, so we assert via the console message channel.
 */

const BOOT_TIMEOUT = 30_000;

test.describe('boot', () => {
  test('boots on default backend with zero page errors', async ({ page }) => {
    const errors: string[] = [];
    const consoleText: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'info' || m.type() === 'log' || m.type() === 'warning') {
        consoleText.push(m.text());
      }
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#scene')).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('#ui')).toHaveCount(1);

    // Wait for the console boot marker.
    const deadline = Date.now() + BOOT_TIMEOUT;
    let booted = false;
    while (Date.now() < deadline) {
      if (consoleText.some((t) => t.includes('[understory] booted'))) {
        booted = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    expect(booted).toBe(true);
    expect(errors).toEqual([]);
  });

  test('canvas has non-zero size after boot', async ({ page }) => {
    test.setTimeout(90_000);
    const consoleText: string[] = [];
    page.on('console', (m) => consoleText.push(m.text()));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const deadline = Date.now() + BOOT_TIMEOUT;
    while (
      Date.now() < deadline &&
      !consoleText.some((t) => t.includes('[understory] booted'))
    ) {
      await page.waitForTimeout(500);
    }
    expect(consoleText.some((t) => t.includes('[understory] booted'))).toBe(true);
    const canvas = page.locator('#scene');
    await expect(canvas).toHaveCount(1);
    await expect(canvas).toBeAttached();
    const box = await canvas.boundingBox({ timeout: 10_000 });
    expect(box?.width ?? 0).toBeGreaterThan(50);
    expect(box?.height ?? 0).toBeGreaterThan(50);
  });

  test.skip(process.env.CI === 'true', 'forced-WebGPU variant needs a real GPU; SwiftShader cannot satisfy a WebGPU adapter in CI — verified manually on the dev machine instead');
});
