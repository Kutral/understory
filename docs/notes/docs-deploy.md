# docs-and-deploy (agent L2) — notes

Branch `feat/docs-deploy` off integrated `main`. Owns: `README.md`,
`.github/workflows/`, `docs/architecture.md`, release-notes draft, Pages config,
`docs/img/`. No `src/**`, no `e2e/`, no contract files touched.

## What shipped

- **README.md** — game pitch (calm endless-forest driving, no score/timers),
  real screenshots in `docs/img/` (`boot-integrated.png` hero from the current
  integrated build; `sky-golden-hour.png` fixed-seed verification render;
  `ui-opening.png`), full controls table transcribed from
  `src/vehicle/input.ts` + `bindings.ts` defaults (kbd/gamepad/touch incl.
  deadzones 0.14/0.08, Space→brake 0.6 rear bias, D-pad fallback, touch arc
  ±64 px), clone/install/run commands that mirror `package.json` scripts exactly
  (`dev/test/e2e/verify/build/preview`), dependency table with exact pinned
  versions cross-checked against `pnpm-lock.yaml`, mermaid architecture diagram
  of the fixed-timestep loop in `contracts/frame.ts` order, and a "How the
  forest is generated" section written from `src/world/{noise,terrain-source,
  trail-network,lod}.ts` headers + `docs/notes/world-terrain.md`.
- **.github/workflows/ci.yml** — pnpm/action-setup v4 + Node 22, explicit
  `actions/cache` on the pnpm store keyed by `hashFiles('pnpm-lock.yaml')`,
  `pnpm install --frozen-lockfile`, `pnpm verify` (typecheck+lint+test+build —
  matches the actual script), Playwright chromium install + `pnpm e2e -- --pass-with-no-tests`
  (flag needed because `e2e/` is empty until agent L lands specs; documented in
  the workflow), artifact uploads for playwright-report/test-results and dist.
- **GitHub Pages deploy** — separate `deploy-pages` job on pushes to `main`:
  rebuild and publish `dist/` via configure-pages → upload-pages-artifact →
  deploy-pages. Base-path note embedded in the job and README: `base:
  '/understory/'` (ADR 0003) assumes the repo is named `understory`; this working
  copy has **no `origin` remote** so that assumption is documented, not verified.
  Repo setting required once: Settings → Pages → Source: GitHub Actions.
- **docs/architecture.md** — expanded mermaid diagram (tick phases, DOM flush at
  frame boundary, interpolation render), subsystem wiring table, agent ownership
  map, wave status table (0 ✅, 1 ✅ integrated, 1.5 🚧 blocking, 2 ⏳, 3 🚧, 4 ⏳).
- **docs/release-notes-draft.md** — explicitly marked **DRAFT**: verified-works
  list with measured numbers cited to notes files, plus an honest not-finished
  list (no trees yet, Wave 1.5 gate unmeasured end-to-end, WebGPU unverified,
  e2e empty, gamepad/touch never on real hardware, audio unheard, placeholder
  chassis).
- **docs/img/** — copied from existing artifacts only (no new captures): 
  `boot-integrated.png` ← `C:/Users/eswar/understory-boot.png`,
  `sky-golden-hour.png` ← `docs/notes/sky-atmosphere-shots/goldenhour-clear.png`,
  `ui-opening.png` ← `src/ui/fixtures/screens/opening.png`.

## Measured / verified

- Every README number traces to a notes file: chunk gen p50 42–45 ms, trail
  carve 42 ms vs 330 ms naive (~7.9×), LOD steps [1,1,2,4,8] over 5 rings
  ~640 m, deadzone 0.14/0.08, top speed ~73 km/h cap 85, recover 170°→24.6° in
  3 s, heap 9.5 MB flat, node count 70 flat, axe 0 violations, UI flush <0.5 ms.
- Dependency versions read from `package.json`; identities confirmed present in
  `pnpm-lock.yaml` (three@0.185.1, rapier3d-compat@0.20.0 — note lockfile also
  carries a stale 0.12.0 entry under a different import key, harmless).
- `pnpm verify` green on this branch tip (typecheck + lint + tests + build).

## Honest gaps

- Screenshots are reused verification fixtures, not fresh captures of final art;
  captions say so.
- The repo-name/base-path assumption is unresolved until an origin exists; ADR
  0003 makes it a one-line change if different.
- CI has never run remotely (no remote configured) — config validated locally by
  inspection against actual scripts; first push to GitHub will be its real test.
- e2e step passes vacuously today via `--pass-with-no-tests`; remove flag when L's
  specs land.
