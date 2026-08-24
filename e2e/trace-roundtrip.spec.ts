import { expect, test } from '@playwright/test';

/**
 * The Trace round-trip (qa agent L). Driving headless is too slow, so the
 * spec injects a synthetic trace into localStorage (documented approach),
 * then verifies the plate view renders it and that data survives reload.
 */

const SEED = 2026;
const KEY = `understory-trace-${SEED}`;

function syntheticTrace(): string {
  // Same shape TraceRecorder persists ({v, seed, points[], heights[], marks[]}).
  const points = Array.from({ length: 200 }, (_, i) => ({
    x: Math.sin(i / 12) * 90,
    z: i * 1.4,
    t: i * 0.25,
  }));
  const heights = points.map((p) => Math.sin(p.x / 40) * 3);
  return JSON.stringify({
    v: 1,
    seed: SEED,
    points,
    heights,
    marks: [{ x: 0, z: 50, label: 'Stopped · 0:22' }],
  });
}

test.describe('the trace', () => {
  test('M opens the plate and renders the injected path', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [KEY, syntheticTrace()],
    );
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/booted — seed/)).toBeAttached({ timeout: 20_000 });

    await page.keyboard.press('KeyM');
    const ink = page.locator('.us-plate__ink');
    await expect(ink).toBeVisible({ timeout: 5_000 });
    // The wobble path must carry the synthetic geometry.
    const d = await ink.getAttribute('d');
    expect((d ?? '').length).toBeGreaterThan(100);
    expect(d).toMatch(/^M/);
    // Header shows the typewritten fields.
    await expect(page.locator('.us-plate__header')).toContainText(`seed ${SEED}`);
    // Specimen mark from the injected idle stop.
    await expect(page.locator('.us-plate__pool').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.us-plate__ink')).toBeHidden();
  });

  test('trace data survives reload for the same seed', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [KEY, syntheticTrace()],
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    const stored = await page.evaluate(([key]) => localStorage.getItem(key as string), [KEY]);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as { points?: unknown[] };
    expect(parsed.points?.length).toBeGreaterThan(100);
  });

  test('corrupted trace data is discarded, not fatal', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(([key]) => localStorage.setItem(key as string, '{broken json'), [KEY]);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/booted — seed/)).toBeAttached({ timeout: 20_000 });
    const stored = await page.evaluate(([key]) => localStorage.getItem(key as string), [KEY]);
    expect(stored).toBeNull(); // cleaned up by the loader's fallback
  });
});
