# ADR 0002 — TypeScript pinned to 5.9.x

Date: 2026-08-24 · Status: accepted

## Context
Brief locks TS 5.x (`strict: true`, no `any`). Registry latest is 7.0.2, which violates the lock.

## Decision
Pin `typescript@5.9.3` — newest 5.x line, verified against the registry at scaffold time.
Revisit 7.x only via a new ADR if the ecosystem (types for three/webgpu) supports it.

## Consequences
+ Matches brief; stable typescript-eslint support.
− Forfeits TS 7 compiler performance until an approved upgrade.
