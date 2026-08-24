# Art Direction

## Calibration — banned default looks

These three are now default AI output. Producing any of them is automatic rejection:

- (a) warm cream background + high-contrast serif + terracotta accent
- (b) near-black + one acid-green or vermilion accent
- (c) broadsheet layout, hairline rules, zero radius, dense newspaper columns

## Frame of reference

A 1970s **forest service field kit**: enamelled dial faces, a typewritten trail permit,
an ink-and-wash botanical plate, a folded paper map with soft creases. Warm, analogue,
hand-made — the opposite of an esports HUD.

## Palette (6 named tokens, multi-hue)

| Token | Hex | Use |
|---|---|---|
| `--spruce` | `#101A16` | deep shade, panel grounds |
| `--moss` | `#2F4234` | secondary surfaces |
| `--lichen` | `#93A88C` | dividers, inactive states |
| `--birch` | `#E6DCC6` | primary text on dark, paper grounds |
| `--lamp` | `#F0B24B` | the one warm highlight: headlights, active state, sun. Sparingly; only where warmth is literally the meaning |
| `--mist` | `#7C9AA6` | cool counterweight: rain, dusk, water, secondary data |

No single-accent look. No neon.

## Typography (three roles)

- **Display:** Vollkorn 600 + true italic — old-style, cartographic, warm. Large sizes only, rarely.
- **UI text:** Instrument Sans — quiet, humane at small sizes.
- **Data/numerals:** Martian Mono, tabular figures — speed, coordinates, time.

Self-hosted woff2, subset, `font-display: swap` with matched fallback metrics.
Type scale committed as CSS custom properties.

## Signature element — The Trace

The one thing the game is remembered by. As you drive, an ink line draws itself on a
paper plate: exact path, hand-inked cartography — slightly wobbling stroke, ink pooling
at stops, faint contour hatching of passed terrain, pressed-specimen marks where you sat
still >20s. Press M for full-screen paper plate with typewritten header (seed, distance,
time of day, weather) and soft fold shadows. Saved per seed; returning to a seed returns
to your own map. **Spend the project's boldness here. Everything around it stays quiet.**

## Driving HUD

Diegetic and almost absent: small enamel dial lower-left (needle = speed), tiny sun/moon
arc (time of day), nothing else. Fades after 4s steady driving. No minimap, no compass
numbers, no notifications, ever.

## The opening risk (mandatory)

No title screen chrome. Camera already in forest at dawn, car already idling, one line of
Vollkorn italic fades in and out over the scene: "Drive as long as you like." No logo,
no menu, no "Press Start". Settings behind Escape, always, from frame one.

## Copy rules

Plain verbs, sentence case, active voice. No exclamation marks, no filler, no achievement
language. Empty state is an invitation. Errors explain and offer the fix.
"Graphics quality", not "Fidelity Preset". "Drive", not "Start Game".
