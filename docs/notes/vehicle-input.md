# Vehicle & Input (agent C) — notes

Status: **implemented, unit-tested, verify green.** Branch `feat/vehicle-input`.
Design pillar 1 (**CALM overrides everything**) drove every tuning decision.

## Files (all under owned paths)

| File | Purpose |
|---|---|
| `src/vehicle/vehicle.ts` | `SoftVehicle` — Rapier `DynamicRayCastVehicleController`, soft-tuned. Owns `world.step()` per the frame contract (vehicle phase). |
| `src/vehicle/tuning.ts` | `SOFT_TUNING` (matches contract `VehicleTuning`), engine envelope, steering constants. |
| `src/vehicle/surfaces.ts` | Per-surface response keyed to `SURFACE_TRAIL/GRASS/MUD/ROCK`. |
| `src/vehicle/vehicle-math.ts` | Pure math: deadzone, rate-limited steering — the functions the timestep test exercises. |
| `src/vehicle/bindings.ts` | Pure key-binding store; rebind + persistence via injectable storage. |
| `src/vehicle/input.ts` | Keyboard / gamepad / touch sources + `InputSystemImpl` (`poll()` once per tick). |
| `src/vehicle/chassis-placeholder.ts` | ⚠️ **PLACEHOLDER chassis mesh — procedural stand-in** so physics integration is visible. NOT the art wagon; visual pass replaces it entirely (see header note in file). |
| `tests/helpers/vehicle-sim.ts` | Deterministic fixed-tick accumulator + Rapier world builders for tests. |
| `tests/vehicle-input.test.ts` | Deadzone math + remappable-bindings persistence. |
| `tests/vehicle-timestep.test.ts` | Timestep independence (pure steering + full Rapier sim). |
| `tests/vehicle-flip.test.ts` | Flip-resistance heuristic over bumpy heightfield + recover + measured tuning numbers. |

## Tuning rationale (soft, by design)

- **Suspension**: rest length 0.55 m, max travel **0.45 m** (mandated 0.35–0.55),
  stiffness 24 (three.js example uses ~30), compression damping 5.2 /
  relaxation 6.8 (relaxation > compression ⇒ extension never overshoots ⇒ no
  pogo). Max suspension force capped at 14 kN so landings stay soft.
- **Grip**: frictionSlip front **6.0**, rear **7.5** — rear ≥ front always, so
  the car can never spin into an oversteer trap; it ploughs gently wide.
- **Top speed**: constant says 85 km/h; the envelope `(1 − v/vMax)^1.5` times a
  low-speed tamer means the car spends most of its punch below ~40 km/h and
  plateaus around **~73 km/h** flat-out. Measured: 0→40 km/h in **8.4 s**
  (unhurried launch).
- **Engine braking**: `engineBrakeTorque = 16` handed to `setWheelBrake` while
  coasting (scaled by speed, floor 0.3 near standstill). Measured: lifting off
  at 53 km/h glides to a full stop in **9.7 s over 56 m** — no brake pedal
  needed, ever.
- **Tree collisions**: any chassis contact whose world normal is mostly
  horizontal has its into-obstacle velocity damped to ~35 % plus a gentle
  sideways slide-away (1.2 m/s). Ground contacts untouched. A soft-thud hook
  (`onThud(severity)`) exists for audio/fx wiring later.
- **Recover**: key/touch/pad-Y starts a 1.4 s window of righting torque
  (axis = up × worldUp) with gravity eased to 0.3× and spin damped — a gentle
  roll back onto the wheels, no launch. Also auto-triggers after 1.5 s tipped.
  Measured: forced onto its roof (170° tilt) → upright to **24.6° in 3 s**,
  settled <15° afterwards.

## Per-surface response (from terrain mask via injected `surfaceAt(x,z)`)

| Surface | grip | side hold | engine | rolling brake |
|---|---|---|---|---|
| TRAIL | 1.00 | 1.00 | 1.00 | 0.00 |
| GRASS | 0.90 | 0.95 | 0.92 | 0.50 |
| MUD | 0.55 | 0.60 | 0.60 | 1.60 |
| ROCK | 0.80 | 1.05 | 0.95 | 0.35 |

Unknown mask codes fall back to GRASS behaviour.

## Input system (contracts/input.ts)

- **Keyboard**: WASD + arrows both live; Space folds into the brake channel at
  0.6 strength with a rear-wheel bias (handbrake feel that cannot spin the car);
  R = recover. Remappable via `rebind(action, code)`, persisted as JSON in
  `localStorage['understory.input.bindings.v1']`; corrupted data → defaults.
- **Gamepad**: standard mapping — left stick X (true analog, smoothstep
  deadzone 0.14), RT/A throttle analog, LT/B brake, X handbrake→brake,
  Y recover (edge-latched), D-pad fallback.
- **Touch**: left-half steering arc (drag from touch-start, ±64 px → −1..1),
  right vertical pad (up = throttle, down = brake, analog by drag distance),
  Recover button. Overlay built lazily on `enableTouch()`.
- Sources combine: steer sums+clamps, throttle/brake take max, recover is
  edge-latched so one press = exactly one tick's worth of request.
- `poll()` is called once per fixed tick, phase order input → vehicle
  (contracts/frame.ts).

## Frame-contract integration

`SoftVehicle.fixedUpdate(dt, input)` = pre-step input application →
`controller.updateVehicle(dt)` → `world.step()` → post-step tree softening,
recovery, state snapshot. `state` mirrors contracts/vehicle.ts exactly;
`transform` (pos+quat snapshot) and `chassisBody` are exposed for camera/fx.

## Verification (measured, deterministic)

All numbers below are printed by `pnpm test` runs on this machine:

```
[flip-heuristic] maxTilt=9.3deg worstInvertedRun=0.000s endTilt=6.0deg   # 40 s scripted driving on bumpy heightfield
[recover]        tiltAfter3s=24.6deg                                     # from forced 170° tip
[top-speed]      top=73.7km/h (cap 85.0) t-to-40=8.4s final=73.7km/h     # full throttle 45 s
[engine-brake]   from 53.2km/h stopped in 9.7s over 56m                  # lift-off coast
```

- **Timestep independence**: pure steering model produces *bit-identical*
  300-tick traces at 30 fps vs 144 fps render rates around the fixed 60 Hz
  tick; the full Rapier vehicle lands within 1e-6 m of the same spot
  (same tick sequence executed both ways).
- **Deadzone**: zero inside threshold, C1-continuous at the edge, exact ±1 at
  full deflection, monotonic and sign-preserving.

## Honest gaps

- Nothing was verified visually or with real devices: no browser run (no
  screenshot), no physical gamepad/hand-touch testing — gamepad/touch paths are
  exercised only through their pure math (deadzone, binding store) and code
  review against the standard-mapping spec.
- The placeholder chassis mesh (clearly marked) stands in for the eventual
  warm estate-wagon model; wheel visuals are simple cylinders.
- Per-surface multipliers are tuned by reasoning + flat/bumpy synthetic tests,
  not per-surface measured laps (needs the real terrain mask streaming).
- Tree-nudge behaviour is unit-tested only implicitly (no trunk colliders exist
  yet — flora subsystem owns those); the contact-normal heuristic is exercised
  by code path but not by a dedicated collision test.
