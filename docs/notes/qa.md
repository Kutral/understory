# QA notes

## 2026-08-25 — e2e-drive-trace (agent L2): drive + trace E2E specs

Branch `feat/e2e-more` (from main e1dff61). Added `e2e/drive.spec.ts`,
`e2e/trace.spec.ts`; made the preview port overridable
(`E2E_PREVIEW_PORT`, default 4173 unchanged).

**Status: authored + source-verified, but NOT green on this headless box.**
4/4 Playwright invocations used; every executed attempt hit the same wall:
since the flora merge (birch/oak/snag render rings), the SwiftShader
software rasterizer stalls the renderer main thread for minutes on the
first fully-lit frames, long enough that even `page.keyboard.press()`
queues past generous timeouts.

### drive.spec.ts
- Waits for the `[understory] booted` console marker (array + poll),
  holds W via `keyboard.down('w')` ≥ 8 s while sampling `.us-dial__speed`
  (SVG `<text>`, textContent = Math.round(kmh), src/ui/hud.ts) every
  ≤ 500 ms using `textContent({ timeout })` (rejects on schedule instead
  of hanging), asserts maxSpeed > 0, zero page errors.
- Key design point: `down()` is issued while still in the opening phase —
  the app is responsive there, and that single keydown dismisses
  `.us-opening` AND engages throttle (`shell.beginDriving` +
  DEFAULT_BINDINGS). Attempted variant that dismissed the overlay first,
  THEN held W, died because post-dismissal first-drive init (rapier +
  shader compile) stalled the main thread so hard even `keyboard.down`
  timed out.
- Observed: boot marker OK; hold begins; speed samples never land before
  the 3-minute sample budget expires (stall longer than budget under
  parallel-run CPU contention).

### trace.spec.ts
- `addInitScript` injects a synthetic `{v:1, seed, points[{x,z,t}],
  heights[], marks[]}` payload into `understory-trace-2026` BEFORE app
  load (schema matches src/ui/trace-store.ts SerializedTrace; seed 2026
  hardcoded in src/main.ts), waits for the boot marker, presses `m`
  (window keydown handler, src/main.ts — works in any phase), asserts
  `.us-plate` appears with `[role="dialog"][aria-label="Journey trace"]`,
  header shows injected seed + distance (`seed 2026`, `0.1 km`),
  non-empty `.us-plate__ink` path, no empty state, zero page errors.
- Observed: injection + boot marker OK; `press('m')` timed out after
  120 s — ran concurrently with drive's stall; unproven whether it goes
  green solo (pre-flora equivalent trace-roundtrip.spec.ts was green).

### Rerun recipe (real GPU or faster box)
```
cd <worktree>
pnpm build && pnpm preview --port 4174 &
E2E_PREVIEW_PORT=4174 pnpm exec playwright test e2e/drive.spec.ts e2e/trace.spec.ts
```
Run serially (`--workers=1`) until the SwiftShader stall is characterized;
drive's SAMPLE_BUDGET_MS may need raising on software GL.
