/**
 * The Trace — full-screen paper plate view (ART-DIRECTION §6.4).
 *
 * DOM/SVG, not canvas: cream paper ground, soft fold shadows, typewritten
 * header in Martian Mono, the driven path as a hand-inked stroke whose
 * wobble is deterministic per (index, seed), ink pooling dots at idle
 * stops with small pressed-specimen glyphs, faint contour hatching from
 * recorded heights behind the line.
 *
 * Reduced motion: the draw-in animation is skipped entirely.
 */
import { buildWobblePathD, fitBounds, hash2 } from './trace-store';
import type { TraceMark, TracePoint } from '@contracts/ui';

export interface PlateData {
  seed: number;
  distanceM: number;
  timeOfDay: string; // e.g. '07:40'
  weather: string;
  points: ReadonlyArray<TracePoint>;
  heights: ReadonlyArray<number>;
  marks: ReadonlyArray<TraceMark>;
}

export interface TracePlateOptions {
  onClose: () => void;
  reducedMotion: boolean;
}

const PLATE = 640;
const PAD = 56;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Tiny botanical specimen glyph (pressed fern), deterministic per mark. */
function specimenGlyph(x: number, y: number, i: number): string {
  const r = (hash2(i * 2246822519, 7) % 24) - 12;
  return (
    `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${r})" class="us-plate__specimen">` +
    `<line x1="0" y1="-7" x2="0" y2="9"/>` +
    `<line x1="-5" y1="-3" x2="0" y2="-1"/><line x1="5" y1="-3" x2="0" y2="-1"/>` +
    `<line x1="-4.4" y1="1.6" x2="0" y2="3.2"/><line x1="4.4" y1="1.6" x2="0" y2="3.2"/>` +
    `</g>`
  );
}

export function createTracePlate(data: PlateData, opts: TracePlateOptions): { root: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'us-plate';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Journey trace');
  if (opts.reducedMotion) root.dataset.reducedMotion = 'true';

  // --- header ---------------------------------------------------------------
  const km = (data.distanceM / 1000).toFixed(1);
  const header = document.createElement('header');
  header.className = 'us-plate__header';
  header.innerHTML =
    `<span class="us-plate__title">Field plate</span>` +
    `<span>seed ${data.seed}</span>` +
    `<span>${km} km</span>` +
    `<span>${esc(data.timeOfDay)}</span>` +
    `<span class="us-plate__weather">${esc(data.weather)}</span>`;
  root.append(header);

  // --- paper ------------------------------------------------------------------
  const paper = document.createElement('div');
  paper.className = 'us-plate__paper';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${PLATE} ${PLATE}`);
  svg.classList.add('us-plate__svg');

  let pathD = '';
  const contour: string[] = [];
  if (data.points.length > 0) {
    const bounds = fitBounds(data.points, PLATE, PAD);
    pathD = buildWobblePathD(data.points, bounds, PAD, data.seed);

    // Faint contour hatching: short ticks perpendicular-ish to travel,
    // derived from recorded height samples (deterministic).
    const step = Math.max(1, Math.floor(data.points.length / 240));
    for (let i = 2; i < data.points.length; i += step) {
      const p = data.points[i];
      if (!p) continue;
      const px = PAD + (p.x - bounds.minX) * bounds.scale;
      const py = PAD + (p.z - bounds.minZ) * bounds.scale;
      const h = data.heights[i] ?? 0;
      const len = 3 + ((hash2(i, Math.round(h * 8)) % 5));
      const ang = ((hash2(i * 31, 11) % 180) * Math.PI) / 180;
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      contour.push(
        `<line x1="${(px - dx).toFixed(1)}" y1="${(py - dy).toFixed(1)}"` +
          ` x2="${(px + dx).toFixed(1)}" y2="${(py + dy).toFixed(1)}"/>`,
      );
    }
  }

  svg.innerHTML =
    `<g class="us-plate__hatch">${contour.join('')}</g>` +
    `<path class="us-plate__ink" d="${pathD}"/>` +
    data.marks
      .map((m, i) => {
        if (data.points.length === 0) return '';
        const bounds = fitBounds(data.points, PLATE, PAD);
        const mx = PAD + (m.x - bounds.minX) * bounds.scale;
        const my = PAD + (m.z - bounds.minZ) * bounds.scale;
        return (
          `<circle class="us-plate__pool" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="2.6"/>` +
          specimenGlyph(mx + 8, my - 8, i)
        );
      })
      .join('');

  paper.append(svg);
  root.append(paper);

  // --- footer -----------------------------------------------------------------
  const footer = document.createElement('footer');
  footer.className = 'us-plate__footer';
  footer.innerHTML =
    `<span>Press <kbd>M</kbd> to close</span><span aria-hidden="true">·</span>` +
    `<button type="button" class="us-plate__close">Close</button>`;
  root.append(footer);

  const close = (): void => {
    root.remove();
    opts.onClose();
  };
  (footer.querySelector('.us-plate__close') as HTMLButtonElement | null)?.addEventListener(
    'click',
    close,
  );
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
      e.stopPropagation();
      close();
    }
  });

  return { root };
}
