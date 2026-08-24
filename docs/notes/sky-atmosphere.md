# Sky & Atmosphere — agent D notes

Append-only. What was tried, what failed, measured numbers, screenshot paths.

## Model decisions

- **Sky model**: Preetham-class analytic fit reduced to its visually load-bearing
  terms (Rayleigh-shaped horizon brightening `pow(1−h, 3.2)`, Mie forward lobe
  `pow(cosθ, 8)` weighted toward horizon, 0.53° sun disc with bloom skirt).
  Full Preetham/Hosek was rejected: under a forest canopy the extra terms buy
  nothing visible but cost shader complexity; all "physics" that matters here is
  driven from `computeAtmosphere()` on the CPU (continuous functions of sun
  elevation + blended weather). No per-band color tables exist anywhere — bands
  only label the state for HUD/audio, so a discontinuity at band edges is
  structurally impossible.
- **Solar model**: single sinusoid `62°·sin((t−6)/12·π)` — sunrise/sunset 06/18,
  moon = same arc shifted 12h (peak 48°). Band thresholds are degrees of
  elevation, not clock: night < −8°, blueHour < −2°, dawn/dusk < 4°,
  goldenHour < 14°, else morning.
- **One shadow rig** for sun+moon (dominant luminary wins; crossover happens
  where both intensities are equal → no intensity step). Fixed ortho frustum
  ±70 m (140 m box over the ~120 m near field), 2048² map, near 20 / far 460,
  bias −3.5e-4, normalBias 0.6. Frustum never changes at runtime; focus point
  is texel-snapped (texel = 140/2048 ≈ 0.068 m) in light space against sub-texel
  camera crawl.
- **Fog**: exponential height fog via `scene.fogNode` (TSL `fog(colorNode,
  factorNode)`), midpoint-height approximation of the exponential integral.
  BASE_FOG_DENSITY 0.0042/m clear, FOG_FALLOFF 0.0042/m (~165 m half-life).
  Weather multiplies density (mist ×3.2, rain ×2.5, drizzle ×2.0, afterRain ×1.7)
  plus a low-sun term `(1 + 0.6·(1−dayF))`. In-scatter tints fog toward --lamp
  (`pow(cosθ,14)` Mie term), strength damped 60% in heavy rain.
- **Clouds**: 3 world-anchored sheets at y=120/165/210 m, 1600 m square. Domain
  warp = numerical curl of an animated potential (∂ψ/∂z, −∂ψ/∂x, central
  differences ε=24 m), then 5-octave mx FBM. Cover threshold lerps 0.5→−0.5
  across cover 0→1; opacity dims with key intensity so night sheets don't glow.
- **Weather machine**: linear-in-time crossfade of the full param vector over
  WEATHER_FADE_MIN_S..MAX_S (30–60 s, seeded mulberry32 draw). Retarget mid-fade
  freezes current blend as new origin → continuous under scrubbing.
  `weather/changed` emits when the fade **starts** (fx/audio pre-cue rain);
  documented choice, orchestrator can ask to move it to completion.
- **Drift**: 24 h / DAY_CYCLE_REAL_SECONDS = **0.01 game-h per real second**
  (40 min day). Scrub API wraps into [0,24); drift continues from scrub point.

## Tried / failed / fixed

- TSL typings: `uniform<T>` generic isn't parameterizable like I assumed
  (`keyof UniformValue` constraint) — interfaces must be structural
  `{ value: Color }`; explicit `Fn(() => ...): ReturnType<typeof vec4>` return
  annotations break inference → annotate nothing inside `Fn`.
- `attribute('aPhase', 'float')` returns `AttributeNode<string>` to TS although
  runtime honors `'float'` — pinned with a scoped cast, commented.
- `.neg()` does not exist on float nodes → `mul(-1)` / `float(0).sub(x)`.
- Stars initially uniform-on-hemisphere → dense clump at zenith in screen space
  (projection pile-up). Fixed with pdf(y) ∝ y sampling (`y = sqrt(...)`).
- Night horizon originally `mix(SPRUCE, MIST, 0.22)` read too bright/blue at
  midnight; dropped to `mix 0.14 × 0.85`.
- First full-suite screenshot run: `dawn-clear` capture timed out once
  (SwiftShader stall on the very first capture); solo re-run passed. Suite now
  passes 10/10 end-to-end.
- Port collision running vite programmatically (5199 busy on this machine) →
  port 0 (random free port).

## Measured numbers

- Unit sweep (tests): max single-step sun-elevation change over a full day at
  30 s resolution ≈ 4.9° (matches analytic bound 16.2°/h × 0.3 h); intensity
  step at every band edge < 1e-4; weather per-tick Δ ≤ 0.01 rain / 0.05 fogMul;
  retarget jump < 0.02 fogMul; drift rate exactly 24/2400 = 0.01 h/s
  (144_000 ticks → 23.9999 h advanced).
- Shadow: 0.068 m/texel; ~1024 texels across the 70 m half-extent.
- Fog extinction at 120 m clear, y=0: 1−exp(−0.0042·120) ≈ 40% before height
  falloff; mist ≈ 3.2× that (far treeline fully veiled — intended look).

## Screenshot attempts

Harness: `tests/sky/harness.html` + `tests/sky/dev-harness.ts`
(WebGPURenderer with forceWebGL → SwiftShader headless), driven by
`node tests/sky/screenshot-sky.mjs` (vite dev server in-process, Playwright
Chromium, fixed seed/camera/time/weather). Output:
`docs/notes/sky-atmosphere-shots/*.png`

10/10 PASS: dawn/morning/goldenhour/dusk/bluehour/night (clear),
morning-mist/drizzle/rain, afterrain-golden.

Verified by inspection: golden hour shows warm lamp-tinted horizon + long soft
shadows; night shows stars + moonlit shadow with readable ground; rain shows
dark sheet banding, dimmed palette, veiled distance; fog melts ground into the
horizon color in all states.

## Open questions for orchestrator

1. Emit `weather/changed` at fade start (current) or completion?
2. Dawn window is narrow (~05:45–06:15 clock) because the sinusoid moves fast
   near sunrise; widen `BAND_BOUNDS_DEG.goldenLow` to ~8° if the opening shot
   should linger longer in `dawn`.
3. Rain particles themselves belong to fx (phase 6); sky supplies
   `atmosphere.rain` (blended 0..1) as the driver signal.

## Files owned

- src/sky/: time.ts, palette.ts, weather.ts, SkySystemImpl.ts, index.ts,
  skyDome.ts, stars.ts, clouds.ts, heightFog.ts, luminaries.ts, visuals.ts
- tests/: sky-light-state.test.ts, sky-weather.test.ts, sky-drift.test.ts,
  sky/harness.html, sky/dev-harness.ts, sky/screenshot-sky.mjs
- docs/notes/sky-atmosphere.md (+ screenshots dir)

No cross-directory edits. main.ts still boots StubWorld — wiring
createSkySystem() into boot belongs to agent A (one-liner documented in
src/sky/index.ts).
