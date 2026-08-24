# Orchestrator notes — Wave 2 solo art-pass (2026-08-24 evening)

Context: delegation quota exhausted (stealth daily cap, resets 00:00 UTC);
Wave 2 continues orchestrator-only. This file records the art-pass changes
made directly, per ART-DIRECTION §6 and the boot-frame critique.

## Applied fixes

### Critique #1 — stock rounded-rect buttons → enamel instruments
- `.us-btn` now carries a cream keyline border
  (`color-mix(--birch 72%)`, 1.4px), irregular radius `12px 14px 11px 15px`
  like a stamped tin face, and a paper-grain ground from two soft radial
  gradients over moss. Primary button gets USFS-stencil treatment
  (uppercase, +0.08em tracking). Ghost variant gets its own irregular
  radius. No image assets.

### Critique #2 — opening line read luxury-brand
- Removed both text-shadows entirely.
- Colour moved cream (`--birch`) → warm ink `--ink-warm #3a3226` (new
  token in tokens.css, documented there): the line reads as ink set into
  the scene, not a floating subtitle.
- Added `letter-spacing: 0.015em` for typewriter warmth. Vollkorn italic
  kept per §6.6.

### Critique #3 — sky grade (reported diff, NOT applied; sky owner)
Requested values for golden-hour/dawn warmth shift (avoiding the default
orange-teal look):
- golden hour sun tint: current ~#ffd9a0 → propose `#f2c078` (less orange,
  more lamp-warm), horizon scatter tint toward ochre `#c9a86a` at
  elevations < 8°.
- dawn: keep mist blue but raise ambient warmth floor by mixing 4%
  `--lamp` into the lowest sky band only.
- Implementation slot: src/sky gradient stops + fog in-scatter tint.
Owner decision; not applied here to respect directory ownership.

## Independent audit findings

1. Focus rings: verified all interactive elements use `--focus-ring`
   (--lamp) via base.css — compliant, no change needed.
2. Copy: full COPY table audited against §6.7 — clean ("Graphics quality",
   "Drive", sentence case, no exclamations). Trace plate copy follows suit.
3. Reduced motion: opening line animation runs on `forwards`; plate view
   already honours data-reduced-motion. No further change this pass.

## Three additional generic-AI-default observations (for later waves)

1. **Panel headers are plain left-aligned text** — would read more
   field-kit with a small stamp-like index mark (e.g. "A·" "B·" section
   letters) or a thin double rule under the title. Defer to flora/fx merge
   window to avoid churn.
2. **Slider tracks are stock** — an enamelled dial feel suggests tick
   marks every 10%. Needs pause.css track restyle; low risk, scheduled
   with a11y wiring pass.
3. **Empty states are silent** — trace plate with no points should show a
   quiet typewritten invitation ("The plate is blank. Drive, and the line
   will come.") rather than an empty paper. Scheduled with qa-suite work.

## Pass 2 — the three observations above, executed on feat/art2

1. **Panel headers** — done. Before: `.us-pause__title` was plain
   left-aligned display type. After: thin double rule under the title drawn
   by its own border (`border-bottom: 3px double` in a translucent moss
   mix), no new markup; the hint stays baseline-aligned beside it.
2. **Slider tracks** — done. Before: flat `--moss` runnable/moz tracks.
   After: an engraved tick every 10% via one `repeating-linear-gradient`
   layered over the moss ground, applied identically to the webkit and moz
   track pseudo-elements; thumb untouched.
3. **Empty trace plate** — done. Before: silent blank paper when
   `points.length === 0`. After: `trace-plate.ts` renders
   `<p class="us-plate__empty">The plate is blank. Drive, and the line will
   come.</p>` centred over the paper; styled in trace.css (Martian Mono,
   small, `--lichen`). No vitest case added — the change introduces no pure
   logic (DOM/CSS only), per pass rules; single end-of-pass `pnpm verify`.

