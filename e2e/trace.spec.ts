import { expect, test } from '@playwright/test';

/**
 * The Trace — persisted-trace rendering E2E (qa agent L2 'e2e-input-trace').
 *
 * Injects a synthetic recorded trace into localStorage BEFORE any app script
 * runs (addInitScript), reloads, presses M, and asserts the plate opens
 * showing data derived from the INJECTED points:
 *
 *  - storage key:   `understory-trace-${seed}` (src/ui/trace-store.ts),
 *    seed is hardcoded SEED=2026 in src/main.ts
 *  - payload shape: { v: 1, seed, points: {x,z,t}[], heights: number[],
 *    marks: {x,z,label?}[] } — validated by TraceRecorder.load()
 *  - plate root:    div.us-plate (src/ui/trace-plate.ts), header shows the
 *    driven distance computed from points ("X.X km") and "seed 2026"
 *
 * Note: the plate never prints a raw point COUNT anywhere in its DOM; the
 * point-derived assertions are the distance header + non-empty ink path +
 * absence of the empty state.
 */

const SEED = 2026;
const STORAGE_KEY = `understory-trace-${SEED}`;

/** Synthetic trace: 11 points along a line; same distance math as TraceRecorder.distanceM(). */
function syntheticTrace() {
  const points = Array.from({ length: 11 }, (_, i) => ({
    x: i * 10,
    z: i * 2,
    t: i * 0.25,
  }));
  const heights = points.map((_, i) => Math.sin(i) * 2);
  const marks = [{ x: 50, z: 10, label: 'Stopped · 0:12' }];
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    distanceM += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return {
    payload: JSON.stringify({ v: 1, seed: SEED, points, heights, marks }),
    expectedKm: (distanceM / 1000).toFixed(1), // matches header `${km} km`
  };
}

test.describe('trace plate from injected localStorage trace', () => {
  test('pressing M opens the plate showing the injected trace', async ({ page }) => {
    test.setTimeout(120_000);

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const consoleText: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'info' || m.type() === 'log' || m.type() === 'warning') {
        consoleText.push(m.text());
      }
    });

    // Runs before ANY app script on every navigation/document.
    const { payload, expectedKm } = syntheticTrace();
    await page.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key!, value!);
        } catch {
          /* private mode etc.: the app tolerates missing storage too */
        }
      },
      [STORAGE_KEY, payload],
    );

    await page.goto('/understory/', { waitUntil: 'domcontentloaded' });

    // The M-key listener attaches mid-boot (src/main.ts); wait for the boot
    // marker so the keypress can't be lost.
    const bootDeadline = Date.now() + 60_000;
    while (
      Date.now() < bootDeadline &&
      !consoleText.some((t) => t.includes('[understory] booted'))
    ) {
      await page.waitForTimeout(500);
    }
    expect(
      consoleText.some((t) => t.includes('[understory] booted')),
      'expected [understory] booted console marker',
    ).toBe(true);

    await page.keyboard.press('m');

    const plate = page.locator('.us-plate');
    await expect(plate).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[role="dialog"][aria-label="Journey trace"]')).toHaveCount(1);

    // Header content must derive from the INJECTED points (seed + distance).
    const header = page.locator('.us-plate__header');
    await expect(header).toContainText(`seed ${SEED}`);
    await expect(header).toContainText(`${expectedKm} km`);

    // Points rendered as the ink stroke; empty-state must NOT be present.
    await expect(page.locator('.us-plate__empty')).toHaveCount(0);
    const inkD = await page.locator('.us-plate__ink').getAttribute('d');
    expect(inkD, 'ink path d should be a non-empty path').toBeTruthy();
    expect(inkD!.length).toBeGreaterThan(10);
    expect(inkD!).toContain('M');

    expect(errors, 'no page errors during boot + plate open').toEqual([]);
  });
});
