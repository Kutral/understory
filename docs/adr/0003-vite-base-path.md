# ADR 0003 — Vite base path /understory/

Date: 2026-08-24 · Status: accepted

## Context
Static deploy target is GitHub Pages under a project subpath (`/<repo>/`). A root-relative
build breaks asset URLs there.

## Decision
`base: '/understory/'` in vite.config.ts now; docs-and-deploy (L2) keeps it in sync with
the actual repo name, or switches to a relative base if Pages serves from a user domain.

## Consequences
Dev server unaffected; e2e baseURL unchanged; deploy config has one less surprise.
