# Audio notes (agent F)

Append-only log of the Understory soundscape build. All numbers measured on
this worktree unless stated otherwise.

## Architecture

Raw WebAudio, zero audio libraries, **zero shipped audio assets** — every
sample is synthesised into an AudioBuffer at init (pink/white/brown noise via
Paul Kellet filter / leaky integration, seeded by mulberry32).

```
engine rig ──┐
tyre rig  ───┤
ambience  ───┼─> ch gain ─> master gain ─> master lowpass ─> limiter ─> destination
music rig ───┤     (mixer per AudioChannel)   (opens w/ speed)    (-6dB brickwall)
wind rig  ───┘
```

- `curves.ts` — all pure math (layer weights, detune mapping, surface one-hot,
  master cutoff, wind level). Fully unit-tested without WebAudio.
- `mixer.ts` — one fader per `AudioChannel`, perceptual `v^2` gain mapping,
  `default` + `silence` presets. Silence zeroes source channels only; master
  stays warm so un-muting is instant.
- One-shot rule: every node is created in `init()` (or preset change = param
  sweep only). One-shots (bird/crow/drip/thunder) are **persistent voices
  fired purely with `setValueCurveAtTime` automation** — no BufferSource is
  ever spawned at trigger time, so graph topology is immutable forever.

## Measured

| Metric | Value | How |
| --- | --- | --- |
| Persistent node count after init | **70** (`stats().nodeCount`) | registry |
| Node count after simulated 10-min session (36,000 update calls @60 Hz) | **70 — flat**, and fake-context "nodes created during run" = 70 → literally zero constructions mid-session despite ~50 one-shot fires | `tests/audio-graph.test.ts` |
| Automation curves fired in a 100-min simulated run | 1055 curves (~527 one-shots ≈ 88 shots/min incl. drips) | measure script |
| JS cost of `update()` (all five rigs + master filter) | **1.65 µs/call** avg over 360k calls → ~0.01% of a 16.6 ms frame | hrtime loop |
| In-memory noise buffers | pink 2 s + white 2 s + brown 3 s @48 kHz mono ≈ **1.31 MB** RAM, **0 bytes shipped payload** | arithmetic |
| Headroom, default preset (worst-case analytic sum Σ rigPeak·vol²·master²) | **≈ 0.165** (−15.6 dBFS) | `Mixer.peakEstimate`, asserted < 0.3 |
| Headroom, every fader at unity | **0.95** (< 1.0 by design: rig peaks .23+.17+.19+.23+.13) | test asserts < 1.0 |
| Rig peak table sum | 0.95 ≤ 0.96 budget | `RIG_PEAKS` |

Rig peaks are enforced where the audio is made: engine layers 0.085 each
(overlapping weights sum to 1), tyre chains 0.16 one-hot, beds 0.4/0.19,
one-shot envelopes pre-scaled to ≤0.12, thunder 0.16, music voices 0.055 × 4.
The −6 dB compressor on the master bus is a labelled safety net; with these
peaks it should never engage.

## Tried / failed

- **HRTF `PannerNode` ambience beds** — dropped before implementation:
  30 Light×Weather combos would need either 30 panners or runtime reparenting
  (violates the no-per-frame-changes rule); CPU cost per HRTF panner is
  documented as heavy on low-end devices. Chose StereoPanner + slow LFO pan
  drift (0.03–0.05 Hz) for width instead.
- **BufferSource-per-one-shot** — first design created a short-lived
  BufferSource per bird/drip/etc. Rejected: it changes node count transiently,
  making "flat node count" unfalsifiable. Replaced with persistent voices +
  `setValueCurveAtTime`. Consequence: scheduler must guarantee
  `minGap ≥ duration × 1.2` so curves never overlap on one AudioParam — this
  invariant is asserted at build time and tested.
- **Detune as plain Gaussian bump** — first version left ±5 cents at rpm=1.0
  ("screaming" feel at redline). Fixed with a quartic end-taper
  `(1−|2x−1|⁴)` so detune → 0 exactly at rest and full rpm; tests pin both.
- **OfflineAudioContext rendering of one-shot buffers** — considered, dropped:
  async init dependency and larger code path for the same result; hand-built
  chirp/envelope Float32 curves are deterministic and testable directly.
- **`setValueCurveAtTime` + concurrent curve** throws if curves overlap —
  handled by the min-gap invariant above; never hit in 36k-tick simulation.

## Contract gap (cross-dir report, NOT applied)

`AudioBus.update()` carries vehicle inputs only. Sky state has no path into
audio, but ambience beds are specified per LightState × WeatherState. I added
an extra method **outside** the contract:

```ts
// src/audio/bus.ts (UnderstoryAudio)
setSky(light: LightState, weather: WeatherState): void;
```

Orchestrator should wire `events.on('light/changed'|'weather/changed')` →
`audio.setSky(...)`, or (preferred long-term) add `setSky()` to
`src/contracts/audio.ts`. No contract file was touched.

## Could NOT be verified without human ears

Everything acoustic below needs a listening pass (dev server, click the page
so the AudioContext resumes):

1. Is the engine actually a *warm hum*? Graph says yes (sine/triangle only,
   all fundamentals 46–200 Hz, shared low-pass 300–560 Hz, detune ≤ ±6.5
   cents), but timbre needs ears. Listen: idle vs ~60% throttle vs top speed.
2. Tyre surface characters (trail/grass/mud/rock band choices at
   420/260/170/950 Hz) — plausible, unverified tonally. Drive across a
   surface boundary and A/B.
3. One-shot realism (birdsong chirp shape, crow rasp through the 620 Hz
   bandpass, drip "plip", distant-thunder rumble at 110 Hz LP) — synthesized,
   not sampled; may read as synthetic. URL: `pnpm dev`, then interact and wait
   30–60 s (bird gaps 7–26 s, crow 24–90 s).
4. Music pad chord cycle rate (18–34 s per chord) and overall balance against
   ambience at default faders.
5. Master low-pass opening with speed — verify it feels like an opening
   window, not a wah pedal (τ=0.25 s).

## Open questions for orchestrator

- Approve adding `setSky()` to the AudioBus contract (or wire events in main).
- Default fader positions (engine .55 / tyres .40 / ambience .60 / music .45 /
  wind .35 / master .85) — taste call, trivially changeable in
  `DEFAULT_VOLUMES`.
