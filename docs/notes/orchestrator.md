# Orchestrator notes

## Wave 1 review (2026-08-24)

All six Wave 1 branches merged to main; integrated `pnpm verify` green
(161 tests / 22 suites); headless boot verified with real screenshot
(`C:/Users/eswar/understory-boot.png`): sky gradient, streamed terrain,
placeholder wagon, opening line, zero page errors, WebGL2 fallback path
exercised.

### Integration fixes by orchestrator (not agents)
1. Perf-gate test flakiness: parallel vitest suites contended for CPU and
   inflated wall-clock gates. Fixed via `fileParallelism: false` + min-of-two
   batches inside the perf test itself. Budgets unchanged.
2. `src/main.ts` integrated boot wiring (all six subsystems into the fixed loop).
3. `?autopilot=1` hook (commit 060e25d) for agent J's measurement runs.

## Art critique pre-pass (for agent K, Wave 2)

Ran an early critique against the boot frame so K inherits specific targets:

**Working — keep:** fog-based depth falloff + restrained palette already
delivers calm and solitude.

**Three generic-default reads to fix in art pass:**
1. UI buttons are stock design-system rounded rectangles ("Recover" + an empty
   placeholder box). Must become enamel-instrument elements: cream keylines,
   USFS stencil lettering, paper-grain fill. The empty box must be killed or
   filled before any release screenshot.
2. Opening line typography reads luxury-brand italic-serif-with-drop-shadow,
   not 1970s field kit. Brief mandates Vollkorn italic — keep the face but kill
   the drop shadow, shift colour from cream to warm ink-brown, add faint
   ink-bleed roughening so it sits IN the scene.
3. Terrain facets read as procedural tech-demo; wagon spawns on a bare ridge
   spine with no visible trail at boot. Fix trail-network placement so a track
   is visible under/near the spawn point, and consider a secondary terrain
   detail pass to break up the ribbed noise striations.

**Grade note:** haze is cool grey-green; brief wants warm analogue — shift the
whole grade a few degrees toward ochre (sky agent D's palette hook supports this).

## Process notes
- ox-alpha delegation after OpenRouter free-tier 429 killed first fan-out;
  no further rate-limit failures.
- Windows quirk confirmed twice: git worktree add with MSYS-style D:/ paths
  mangles them; also zombie vite servers lock worktree dirs — kill processes
  before rm -rf.
