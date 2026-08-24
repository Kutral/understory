# UI shell — agent E notes

Branch `feat/ui-shell`. Everything below is measured, not assumed; evidence
files live in `src/ui/fixtures/screens/` and the runner is
`src/ui/fixtures/verify.mjs`.

## What shipped

- **Signal store** (`src/ui/store.ts`) — working implementation of the
  `SignalStore` contract with automatic dependency tracking. The reference
  implementation in `src/contracts/signals.ts` never populates a signal's
  subscriber set (effects would never re-run); see *cross-dir diffs*.
  Writes only queue; `flush()` drains deduplicated, cascades safely, cycle-guarded.
- **Shell** (`src/ui/shell.ts`) — `UnderstoryUi implements UiSystem`, mounted on
  `#ui`. Phase machine: opening → driving ⇄ paused; settings behind Escape from
  frame one, including during the opening.
- **Opening** (`src/ui/opening.ts`, `styles/opening.css`) — no title chrome. One
  Vollkorn 600 italic line "Drive as long as you like." fades in over the scene,
  holds ~4.7s, fades out (9s total). Any key except Escape/modifiers starts
  driving; Escape opens settings. First key fast-fades the line (0.9s).
- **HUD** (`src/ui/hud.ts`, `styles/hud.css`) — diegetic enamel dial lower-left
  (needle sweeps ±120° over 0–85 km/h per `TOP_SPEED_KMH`, Martian Mono tabular
  readout at 1 km/h granularity) plus a tiny sun/moon arc (sun = `--lamp`,
  moon = `--mist`, bodies drop below the horizon line). Hidden until driving;
  hides after exactly `HUD_IDLE_HIDE_S = 4s` of steady driving (`HudIdleTimer`,
  clock-injected, unit-tested); returns on any key/pointer input or via
  `playerInput()` (gamepad/touch entry point). No minimap, compass numbers or
  notifications anywhere.
- **Pause/settings** (`src/ui/pause.ts`, `styles/pause.css`) — birch paper card,
  moss controls, dashed lichen dividers, soft fold shadows. Sections: Graphics
  ("Graphics quality" tier select, resolution scale, field of view), Sound (six
  faders engine/tyres/ambience/music/wind/master + Silence preset that zeroes
  all but master and sets `preset: 'silence'`), Controls (remap for all six
  `KeyBinding` actions, one-key-per-action-and-key collisions resolved, Escape
  cancels a capture), Accessibility (Reduced motion — honours
  `prefers-reduced-motion` too, Horizon lock), World (seed entry with validation
  message that explains the fix). Primary button: "Drive". Zero exclamation
  marks; copy lives in one `COPY` map covered by tests.
- **Fonts** (`public/fonts/`, `styles/fonts.css`) — five subset woff2 vendored
  from Fontsource (Vollkorn 600 + italic, Instrument Sans 400/500, Martian Mono
  400). `font-display: swap` with metric-matched fallback faces
  (`ascent/descent/line-gap/size-adjust` overrides measured with fontTools from
  the actual files against Georgia / Segoe UI / Consolas). No font flash:
  verified Vollkorn loads and the line renders without reflow.
- **Accessibility** — native controls only, visible `--lamp` focus ring,
  focus trap while paused, `role="dialog" aria-modal` panel, labelled sliders,
  reduced-motion kill-switch (OS preference OR in-game setting →
  `[data-reduced-motion]` disables transitions/animations).
- **Tests** (`tests/ui-store.test.ts`, `tests/ui-idle.test.ts`,
  `tests/ui-copy.test.ts`) — 23 tests, all green: flush batching/dedupe/
  cascade/unsubscribe/cycle guard; idle timer boundary math; copy-rule bans.

## Measurements

| Check | Result |
|---|---|
| UI flush cost under 60Hz telemetry (speed + time-of-day every 16ms) | **avg 0.05–0.15 ms/frame**, worst steady-state < 0.5 ms (budget ≤1ms) |
| rAF cadence with HUD live | p50 16.6 ms, p99 18.2 ms (vsync-bound; UI not the constraint) |
| axe-core (opening fixture) | 0 violations of any impact |
| axe-core (pause fixture, panel open) | 0 violations of any impact |
| Fonts | `document.fonts.check('italic 600 32px Vollkorn')` true in headless Chromium |
| Idle hide | HUD `data-hidden=true` after ≥4s without input; back to `false` after one keypress (verified live) |
| Remap | click key-cap → "Press a key" → ArrowUp → shows ArrowUp, old binding released |
| Silence preset | first five faders zeroed, master kept |
| Unit tests | 23/23 pass (`pnpm test`) |
| `pnpm verify` (typecheck+lint+test+build) | green |

## Verification method

`node src/ui/fixtures/verify.mjs` (dev server required, default
`http://localhost:5199/understory`) drives headless Chromium through three
fixtures in `src/ui/fixtures/`: opening, hud, pause. It injects axe-core
4.10.3, walks the full Tab order (17 controls, screenshot of the focus ring),
exercises remap/silence/reduced-motion/Escape paths, benchmarks flush cost, and
screenshots each state into `screens/` (`opening.png`, `hud-visible.png`,
`hud-faded.png`, `pause.png`, `pause-focus.png`). All screenshots reviewed.

Bugs found and fixed during verification:
- `.us-veil[hidden]` was overridden by `display:grid` → panel shadowed every
  screen from frame one. Fixed with an explicit `[hidden]` rule.
- Panel's capturing Escape handler closed the panel, then the event reached the
  shell's global handler which re-opened it. Fixed with `stopPropagation()`.
- Rebinding produced duplicate entries for an action (old binding survived),
  so the new key never displayed. Fixed by dropping both collisions.
- Sliders had no accessible names (axe critical `label`). Fixed.

## Integration (cross-dir diff for orchestrator — not applied)

1. `src/main.ts` needs two lines to mount the shell:

```ts
import { createUi } from './ui';
// after services/render exist:
const ui = createUi({
  onStartDriving: () => vehicle.releaseBrake(),
  onQualityChange: (tier) => render.setTier(tier),
  onGraphicsChange: ({ resolutionScale, fovDeg }) => render.setResolutionScaleAndFov(resolutionScale, fovDeg),
  onVolumeChange: (ch, v) => bus.setVolume(ch, v),
  onPresetChange: (p) => bus.applyPreset(p),
  onReducedMotionChange: (v) => render.setReducedMotion(v),
  onBindingsChange: (b) => input.replaceAll(b),
  onSeedChange: (s) => world.reseed(s),
});
ui.mount(document.querySelector('#ui')!, quality);
```

   and call per tick: `ui.setSpeed(vehicle.kmh); ui.setTimeOfDay(sky.dayT);`
   plus `ui.playerInput()` on gamepad/touch activity, `ui.setHudVisible(v)` if
   core ever needs to force it (photo mode).

2. `src/main.ts` must also import the ui module for its CSS side effects —
   importing `createUi` covers this.

3. `src/contracts/signals.ts`: the reference `createSignalStore` never wires
   signal subscribers into `subs`, so effects never re-run after their initial
   execution. Either replace its body with `src/ui/store.ts`'s implementation
   (recommended — it satisfies the same interface) or have core import the store
   from `@/ui/store`.

4. `vite.config.ts` sets `base: '/understory/'`; `fonts.css` uses relative
   public-dir URLs so both dev and build resolve. If the build warns once main.ts
   imports the styles, switch to `/fonts/...` absolute URLs (rewritten at build).

## Honest gaps

- The Trace (paper plate) and photo mode are other agents' surface; the shell
  exposes hooks but mounts nothing for them yet.
- Gamepad/touch input reaching `playerInput()` depends on the input agent's
  wiring (diff above).
- `maxMs` in the flush benchmark includes the first frame after mount (~1.9ms
  worst observed, initial effect run + font settle); steady-state max is
  <0.5ms. A production perf gate should sample post-warmup frames.
- axe ran on the fixtures with the placeholder gradient scene, not the real
  Three.js canvas; contrast rules over real terrain should be re-checked when
  world rendering lands.
