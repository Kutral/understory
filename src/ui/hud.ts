/**
 * Diegetic driving HUD: enamelled dial lower-left (needle = speed) plus a
 * tiny sun/moon arc for time of day. Nothing else — no minimap, no compass
 * numbers, no notifications, ever.
 *
 * All DOM writes happen inside store effects, which the shell flushes once
 * per frame; writes are guarded so unchanged values cost nothing.
 */
import type { SignalStore } from '@contracts/signals';
import { TOP_SPEED_KMH } from '@contracts/constants';
import { h, svg } from './dom';

export interface HudSignals {
  speedKmh: ReadSignal<number>;
  dayT: ReadSignal<number>; // 0..1 through the day; dawn ≈ 0.25
  hudVisible: ReadSignal<boolean>;
}
/** Structural read-only view of a signal — satisfied by store signals. */
export type ReadSignal<T> = { readonly value: T };

/** Needle sweep: -120° at rest to +120° at top speed. */
const NEEDLE_MIN_DEG = -120;
const NEEDLE_MAX_DEG = 120;

export function createHud(store: SignalStore, signals: HudSignals): {
  root: HTMLDivElement;
  dispose: () => void;
} {
  const root = h('div', { class: 'us-hud', 'data-hidden': 'false', 'aria-hidden': 'true' });

  // --- Sun/moon arc -----------------------------------------------------
  const arc = svg('svg', {
    class: 'us-arc',
    viewBox: '0 0 104 34',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  const horizon = svg('line', { x1: 6, y1: 30, x2: 98, y2: 30, stroke: 'var(--lichen)', 'stroke-width': 1 });
  const track = svg('path', {
    d: 'M 8 30 A 44 44 0 0 1 96 30',
    fill: 'none',
    stroke: 'var(--lichen)',
    'stroke-width': 1,
    'stroke-dasharray': '2 3',
  });
  const sun = svg('circle', { r: 4, fill: 'var(--lamp)' }); // warmth is literally the meaning here
  const moon = svg('circle', { r: 3, fill: 'var(--mist)' });
  arc.append(track, horizon, sun, moon);
  root.append(arc);

  // --- Enamel dial -------------------------------------------------------
  const CX = 62;
  const CY = 66;
  const R_FACE = 50;
  const dial = svg('svg', {
    class: 'us-dial',
    viewBox: '0 0 124 124',
    'aria-hidden': 'true',
    focusable: 'false',
  });

  const face = svg('circle', { class: 'us-dial__face', cx: CX, cy: CY, r: R_FACE });
  const rimInner = svg('circle', { class: 'us-dial__rim-inner', cx: CX, cy: CY, r: R_FACE - 6 });
  const rim = svg('circle', { class: 'us-dial__rim', cx: CX, cy: CY, r: R_FACE + 2 });

  // ticks: 0..80 km/h, majors every 20
  const tickGroup = svg('g', {});
  for (let kmh = 0; kmh <= 80; kmh += 10) {
    const major = kmh % 20 === 0;
    const deg = needleDeg(kmh);
    const rad = ((deg - 90) * Math.PI) / 180;
    const outer = R_FACE - 9;
    const inner = outer - (major ? 8 : 4.5);
    tickGroup.append(
      svg('line', {
        class: major ? 'us-dial__tick us-dial__tick--major' : 'us-dial__tick',
        x1: +(CX + outer * Math.cos(rad)).toFixed(2),
        y1: +(CY + outer * Math.sin(rad)).toFixed(2),
        x2: +(CX + inner * Math.cos(rad)).toFixed(2),
        y2: +(CY + inner * Math.sin(rad)).toFixed(2),
      }),
    );
    if (major && kmh > 0 && kmh < 80) {
      const lr = inner - 7;
      tickGroup.append(
        svg(
          'text',
          {
            class: 'us-dial__label',
            x: +(CX + lr * Math.cos(rad)).toFixed(2),
            y: +(CY + lr * Math.sin(rad) + 2.6).toFixed(2),
          },
          String(kmh),
        ),
      );
    }
  }

  const unitTop = svg('text', { class: 'us-dial__unit', x: CX, y: CY - 18 }, 'KM/H');
  const speedText = svg('text', { class: 'us-dial__speed', x: CX, y: CY + 16 }, '0');
  const unitBottom = svg('text', { class: 'us-dial__unit', x: CX, y: CY + 30 }, 'ENAMEL FIELD DIAL');
  const needle = svg('line', {
    class: 'us-dial__needle',
    x1: CX,
    y1: CY + 8,
    x2: CX,
    y2: CY - R_FACE + 13,
    transform: `rotate(${NEEDLE_MIN_DEG} ${CX} ${CY})`,
  });
  const hub = svg('circle', { class: 'us-dial__hub', cx: CX, cy: CY, r: 5 });

  dial.append(face, rimInner, rim, tickGroup, unitTop, unitBottom, speedText, needle, hub);
  root.append(dial);

  // --- Effects (run in the shell's per-frame flush) ----------------------
  let lastNeedleDeg = Number.NaN;
  let lastSpeedShown = Number.NaN;
  let lastDayQ = Number.NaN;

  const unbindHudVisible = store.effect(() => {
    const next = signals.hudVisible.value ? 'false' : 'true';
    if (root.dataset.hidden !== next) root.dataset.hidden = next;
  });

  const unbindSpeed = store.effect(() => {
    const kmh = clamp(signals.speedKmh.value, 0, TOP_SPEED_KMH);
    const shown = Math.round(kmh); // numerals update at 1 km/h granularity, not per float
    if (shown !== lastSpeedShown) {
      lastSpeedShown = shown;
      speedText.textContent = String(shown);
    }
    const deg = needleDeg(kmh);
    if (deg !== lastNeedleDeg) {
      lastNeedleDeg = deg;
      needle.setAttribute('transform', `rotate(${deg.toFixed(2)} ${CX} ${CY})`);
    }
  });

  const unbindDay = store.effect(() => {
    // quantise so a slowly drifting day cycle doesn't dirty the DOM every frame
    const dayQ = Math.round(clamp(signals.dayT.value, 0, 1) * 500) / 500;
    if (dayQ === lastDayQ) return;
    lastDayQ = dayQ;

    const sunAngle = Math.PI * (1 - dayQ);
    placeBody(sun, sunAngle, 4);
    const nightAngle = sunAngle + Math.PI;
    // the moon rides the same arc half a cycle out of phase
    const moonAbove = nightAngle % (2 * Math.PI) < Math.PI;
    const mAngle = moonAbove ? nightAngle : nightAngle - Math.PI;
    placeBody(moon, mAngle, 3);
  });

  function placeBody(body: SVGCircleElement, angle: number, r: number): void {
    const x = 52 + 44 * Math.cos(angle);
    const y = 30 - 44 * Math.sin(angle);
    body.setAttribute('cx', x.toFixed(2));
    body.setAttribute('cy', y.toFixed(2));
    body.setAttribute('opacity', y >= 29.4 ? '0' : '1'); // below the horizon line
    void r;
  }

  function dispose(): void {
    unbindHudVisible();
    unbindSpeed();
    unbindDay();
    root.remove();
  }

  return { root, dispose };
}

function needleDeg(kmh: number): number {
  const t = clamp(kmh / TOP_SPEED_KMH, 0, 1);
  return NEEDLE_MIN_DEG + t * (NEEDLE_MAX_DEG - NEEDLE_MIN_DEG);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
