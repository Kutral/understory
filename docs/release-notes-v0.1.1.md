# v0.1.1 — It Drives

**Play it: https://kutral.github.io/understory/**

## The headline

v0.1.0 shipped with a game you couldn't actually play: the car **fell through
the world at spawn**. This release fixes that, and the fix is proven by an
end-to-end playthrough (boot → drive → steer → brake → trace plate) on the
live site.

## Fixed

- **Spawn fall-through (critical).** The pre-boot warmup streams 121 chunk
  height-grids into an LRU cache capped at 64; spawn-centre grids were evicted
  before the physics ring built ground colliders from them, and since those
  chunks were already loaded they never regenerated. Zero floor at spawn: the
  car free-fell, the chase camera followed beneath the terrain, and the world
  rendered as an empty beige void. Throttle, Recover and all unit tests were
  blind to it — only integration caught it.
  - GridCache capacity now derives from `CHUNK_RINGS` (+2 spare rings).
  - Spawn moved to (40, 40), clear of the four-heightfield corner seam at (0,0).
  - 4 regression tests pin both the broken mechanism and the fixed cap.
- Drive spec's invalid `count({timeout})` Playwright call replaced with
  `waitFor({ state: 'detach' })`.
- OS-level `prefers-reduced-motion` now seeds the in-game setting on first boot
  (previously only the in-game toggle worked).

## Verified end-to-end (headed real-GPU Chromium)

boot ✓ · opening dismiss ✓ · W held 12 s: **29 km/h peak** · A/D steering sweep ✓
· brake to exactly 0 km/h ✓ · trace plate M/Esc round-trip ✓ · 0 page errors ✓

## Still honest about what's not done

- Residual 3 post-load shader compiles (root cause unknown, needs real-GPU profiling)
- No undergrowth/grass layer; placeholder wagon chassis
- SwiftShader/headless environments stall mid-drive (documented in qa.md;
  needs GPU — every real machine has one)
- Audio spatialisation upgrades, WebGPU renderer unverified

263 unit tests green · typecheck · lint · build · Pages CI deploy green.
