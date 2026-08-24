# Understory — Build Plan

A calm endless-forest driving game. WebGPU-first with WebGL2 fallback, TSL-only custom
shading, Rapier raycast vehicle, worker-pooled procedural world.

## Waves

### Wave 0 — orchestrator (done)
Scaffold, contracts in `src/contracts/`, compiling no-op stubs per subsystem,
`pnpm verify` green on an empty project, docs.

### Wave 1 — six agents in parallel
| Agent | Branch | Owns | Acceptance |
|---|---|---|---|
| A render-core | `feat/render-core` | `src/core/` | empty scene 60fps @1080p; 60s heap trace flat |
| B world-terrain | `feat/world-terrain` | `src/world/` | 3km straight drive, zero spikes >24ms; byte-identical heightmaps for same seed (unit test) |
| C vehicle-input | `feat/vehicle-input` | `src/vehicle/` | 5-min drive never flips; recover key; timestep independence test 30 vs 144fps |
| D sky-atmosphere | `feat/sky-atmosphere` | `src/sky/` | screenshot suite of six lighting states at fixed seed; no cascade pop |
| E ui-shell | `feat/ui-shell` | `src/ui/` | keyboard-only operable; <1ms/frame; axe pass no serious violations |
| F audio | `feat/audio` | `src/audio/` | 10-min session no node growth; nothing clips; music mute leaves world alive |

### Wave 1.5 — performance gate (BLOCKING)
Vertical slice from Wave 1 branches: terrain streaming + ONE tree species (3 LODs +
impostor) + car + sky + fog. No particles, wildlife, post beyond tone mapping, or UI
beyond debug overlay. Measured on CPU-throttled 4x profile, GPU-limited settings:

- p50 / p99 frame time over a 3-minute continuous drive (**p99 is the gate**)
- worst single frame + named causing function
- draw calls / triangles / instance count at dense viewpoint
- heap t=0s vs t=180s
- load → first interactive frame
- shader compiles after loading finishes (must be **zero**)

**Gate: p99 ≤ 20ms AND zero post-load compiles.** If either fails, perf-and-quality (J)
is dispatched early and everything re-measured. No Wave 2 agent starts until this passes.

Flora target correction for Wave 2: "trees in view" = ≤80 full-detail, ≤400 mid-LOD,
remainder billboard impostors. Never thousands of full 3D trees.

### Wave 2 — five agents in parallel
| Agent | Branch | Owns |
|---|---|---|
| G flora | `feat/flora` | `src/flora/` |
| H life-and-particles | `feat/life-particles` | `src/fx/` |
| I the-trace | `feat/the-trace` | `src/ui/trace*`, photo mode |
| J perf-and-quality | `feat/perf-quality` | quality tiers, `docs/PERF.md` |
| K art-direction-pass | `feat/art-pass` | typography/motion/copy critique + fixes |

### Wave 3 — three agents in parallel
L qa-verification (`e2e/`), L2 docs-and-deploy (README, CI, Pages config),
M a11y-and-comfort (`src/ui/settings*`).

### Wave 4 — orchestrator alone
Integrate, drive it, Chanel test, fix seams, release notes, tag `v0.1.0`.

## Ownership map

See directory layout in README. Hard rule: agents write only inside owned dirs plus
their own note file (`docs/notes/<agent>.md`) and own tests. Cross-dir changes are
reported as requested diffs to the orchestrator.

## Verification protocol

Every visual claim ships with a deterministic artifact (fixed seed/position/time/resolution
before-after pair). Every done claim ships with a measured number. A subagent that cannot
screenshot says so explicitly.
