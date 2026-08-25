import { expect, test } from '@playwright/test';

/**
 * Keyboard drive E2E (qa agent L2 'e2e-drive-trace').
 *
 * Boots the real app, waits for the '[understory] booted' console marker,
 * then presses AND HOLDS W while still in the 'opening' phase: that same
 * keydown dismisses the overlay (any non-modifier key -> shell.beginDriving,
 * src/ui/opening.ts) and engages throttle (W -> action 'throttle',
 * src/ui/state.ts DEFAULT_BINDINGS), so the car accelerates as soon as
 * frames start running. We sample the HUD speed readout (.us-dial__speed,
 * an SVG <text> whose textContent is Math.round(kmh) — src/ui/hud.ts)
 * and assert max observed > 0.
 *
 * SwiftShader hazard: the first driving frames stall the renderer main
 * thread for MINUTES (physics init + shader compile; worse since the flora
 * merge added birch/oak/snag materials). Plain page.evaluate() hangs
 * forever in that state — even keyboard actions queue behind it — so ALL
 * interaction happens before the stall begins, and sampling uses
 * locator.textContent({ timeout }), which rejects on schedule instead of
 * blocking, letting us ride out the stall inside the hold window.
 */

const BOOT_TIMEOUT = 60_000;
const DRIVE_MS = 8_000;
/** Total hold/sample budget: covers multi-minute SwiftShader stalls. */
const SAMPLE_BUDGET_MS = 180_000;
const POLL_MS = 500;
const SPEED_SELECTOR = '.us-dial__speed';

test.describe('keyboard drive', () => {
  test('holding W produces speed on the HUD with zero page errors', async ({ page }) => {
    test.setTimeout(420_000);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const consoleText: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'info' || m.type() === 'log' || m.type() === 'warning') {
        consoleText.push(m.text());
      }
    });

    await page.goto('/understory/', { waitUntil: 'domcontentloaded' });

    // Poll the collected console lines until the boot marker appears.
    const bootDeadline = Date.now() + BOOT_TIMEOUT;
    while (
      Date.now() < bootDeadline &&
      !consoleText.some((t) => t.includes('[understory] booted'))
    ) {
      await page.waitForTimeout(POLL_MS);
    }
    expect(
      consoleText.some((t) => t.includes('[understory] booted')),
      'expected [understory] booted console marker',
    ).toBe(true);

    // Hold W starting IN the opening phase: the app is responsive here.
    // This single keydown both starts the drive and engages throttle; it
    // stays held (throttle=1) until keyboard.up below.
    await page.keyboard.down('w');
    const holdStart = Date.now();
    let maxSpeed = -1;
    while (Date.now() - holdStart < SAMPLE_BUDGET_MS) {
      const heldMs = Date.now() - holdStart;
      if (maxSpeed > 0 && heldMs >= DRIVE_MS) break;
      try {
        const raw = await page.locator(SPEED_SELECTOR).textContent({ timeout: 10_000 });
        const n = Number((raw ?? '').trim());
        if (Number.isFinite(n) && n > maxSpeed) maxSpeed = n;
      } catch {
        // Main thread stalled (first-drive shader/physics init): keep holding W.
      }
      await page.waitForTimeout(POLL_MS);
    }
    await page.keyboard.up('w');

    // The overlay must be dismissed by the held keydown (checked AFTER the
    // hold so the assertion never itself blocks on a stalled main thread).
    let openingGone: boolean;
    try {
      await page.locator('.us-opening').waitFor({ state: 'detached', timeout: 15_000 });
      openingGone = true;
    } catch {
      openingGone = false;
    }
    expect(openingGone, '.us-opening overlay should be dismissed by the W keydown').toBe(
      true,
    );

    expect(
      maxSpeed,
      `HUD ${SPEED_SELECTOR} should read a positive km/h while W is held (max observed: ${maxSpeed})`,
    ).toBeGreaterThan(0);
    expect(errors, 'no page errors during boot + drive').toEqual([]);
  });
});
