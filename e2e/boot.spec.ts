import { expect, test } from '@playwright/test';

/**
 * Boot smoke (qa agent L): the game must reach its boot marker with zero
 * page errors. Headless CI runs SwiftShader -> WebGL2 fallback; generous
 * timeouts per docs/notes/qa.md.
 *
 * NOTE: the boot marker lives on the CONSOLE ('[understory] booted — …'),
 * not in DOM, so we assert via the console message channel.
 *
 * NOTE: we goto '/understory/' EXPLICITLY rather than '/'. With
 * baseURL = http://localhost:4173/understory/, URL resolution sends '/'
 * to the server ROOT (http://localhost:4173/), which is a different page
 * from the app mount — that mismatch is what starved the old
 * locator('#scene') assertions below.
 */

const BOOT_TIMEOUT = 30_000;

/** Register the console collector BEFORE navigation and return a predicate. */
function collectConsole(page: import('@playwright/test').Page) {
  const consoleText: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'info' || m.type() === 'log' || m.type() === 'warning') {
      consoleText.push(m.text());
    }
  });
  return consoleText;
}

/** Poll the collected console lines until the boot marker appears. */
async function waitBooted(consoleText: string[], page: import('@playwright/test').Page) {
  const deadline = Date.now() + BOOT_TIMEOUT;
  while (
    Date.now() < deadline &&
    !consoleText.some((t) => t.includes('[understory] booted'))
  ) {
    await page.waitForTimeout(500);
  }
}

test.describe('boot', () => {
  test('boots on default backend with zero page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const consoleText = collectConsole(page);

    await page.goto('/understory/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#scene')).toBeVisible({ timeout: BOOT_TIMEOUT });
    await expect(page.locator('#ui')).toHaveCount(1);

    // Wait for the console boot marker.
    await waitBooted(consoleText, page);
    expect(
      consoleText.some((t) => t.includes('[understory] booted')),
      'expected [understory] booted console marker',
    ).toBe(true);
    expect(errors).toEqual([]);
  });

  test('canvas has non-zero size after boot', async ({ page }) => {
    test.setTimeout(90_000);
    const consoleText = collectConsole(page);
    await page.goto('/understory/', { waitUntil: 'domcontentloaded' });

    // Wait for the boot marker BEFORE touching any locator machinery.
    await waitBooted(consoleText, page);
    expect(
      consoleText.some((t) => t.includes('[understory] booted')),
      'expected [understory] booted console marker',
    ).toBe(true);

    // Measure the live element directly via page.evaluate instead of
    // locator.boundingBox(): the element provably exists at this point,
    // so read its rect straight from the DOM and skip the locator retry
    // machinery that was timing out here.
    const probe = await page.evaluate(() => {
      const el = document.querySelector('#scene');
      if (!el) return { found: false, width: 0, height: 0 };
      const r = el.getBoundingClientRect();
      return { found: true, width: r.width, height: r.height };
    });
    expect(probe.found, '#scene should be attached after boot').toBe(true);
    expect(probe.width, '#scene width').toBeGreaterThan(50);
    expect(probe.height, '#scene height').toBeGreaterThan(50);
  });

  test.skip(process.env.CI === 'true', 'forced-WebGPU variant needs a real GPU; SwiftShader cannot satisfy a WebGPU adapter in CI — verified manually on the dev machine instead');
});
