# ADR 0001 — Rapier via compat build

Date: 2026-08-24 · Status: accepted

## Context
The brief references `@file:"dimforge/rapier3d-compat"` (malformed) — resolved to the npm
package `@dimforge/rapier3d-compat`. Two integration routes exist:
compat build (WASM inlined as base64, plain ESM import) vs the standard
`@dimforge/rapier3d` package (raw .wasm asset requiring `vite-plugin-wasm` +
`vite-plugin-top-level-await`).

## Decision
Use `@dimforge/rapier3d-compat@0.20.0`, pinned exactly.

## Rationale
+ Zero extra Vite plugins; no top-level-await transform; simpler worker story.
+ The vehicle controller API is identical between builds.
− Slightly larger JS payload (~1.5MB uncompressed before gzip; measured in build output).
− Base64-inlined WASM is not cached separately by the browser. Acceptable at our size budget;
  revisit only if first-interactive exceeds 3s on cable and profiling blames physics init.

## Consequences
No WASM plugin config in Wave 0; `await RAPIER.init()` at boot inside the loading window.
