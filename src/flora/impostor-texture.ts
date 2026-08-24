import * as THREE from 'three/webgpu';

/**
 * Impostor atlas painter — renders the pine silhouette into a canvas at init
 * (no asset files). The FloraWorld constructor calls this once; browsers get
 * a real CanvasTexture, non-DOM environments get null and the impostor
 * material falls back to an opaque green card (unit tests still pass).
 */

const SIZE = 256;

interface PaintCtx {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

function tryCreateCanvas(): PaintCtx | null {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    return ctx ? { canvas, ctx } : null;
  }
  // Node / worker environments: OffscreenCanvas when available.
  const g = globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenCanvas };
  if (g.OffscreenCanvas) {
    try {
      const canvas = new g.OffscreenCanvas(SIZE, SIZE);
      const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
      return ctx ? { canvas, ctx } : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Draw a stylised pine matching buildPine's proportions: bare bole to ~17%
 * height, then six stacked tiers narrowing to the crown tip.
 */
export function paintPineImpostor(): HTMLCanvasElement | OffscreenCanvas | null {
  const made = tryCreateCanvas();
  if (!made) return null;
  const { ctx } = made;
  const S = SIZE;

  ctx.clearRect(0, 0, S, S);

  const groundY = S;
  const H = S * 0.98;
  const cx = S / 2;

  // Trunk: from ground to ~y=2.6/15 of the tree height, slightly tapered.
  const trunkTop = groundY - H * (2.6 / 15);
  const grad = made.ctx.createLinearGradient(cx - 6, 0, cx + 6, 0);
  grad.addColorStop(0, '#2a2018');
  grad.addColorStop(0.5, '#4a382a');
  grad.addColorStop(1, '#241b13');
  ctx.fillStyle = grad;
  ctx.fillRect(cx - 5, trunkTop, 10, groundY - trunkTop);

  // Foliage tiers (top-first so lower tiers overlap like real branches).
  const tiers: Array<{ yBase: number; yTip: number; halfW: number }> = [
    { yBase: 2.6, yTip: 6.4, halfW: 3.2 },
    { yBase: 4.6, yTip: 8.4, halfW: 2.85 },
    { yBase: 6.6, yTip: 10.2, halfW: 2.45 },
    { yBase: 8.6, yTip: 11.9, halfW: 2.0 },
    { yBase: 10.6, yTip: 13.5, halfW: 1.55 },
    { yBase: 12.6, yTip: 15.0, halfW: 1.0 },
  ];
  for (let i = tiers.length - 1; i >= 0; i--) {
    const t = tiers[i];
    if (!t) continue;
    const yBasePx = groundY - (t.yBase / 15) * H;
    const yTipPx = groundY - (t.yTip / 15) * H;
    const halfWpx = (t.halfW / 3.2) * (S * 0.46);
    const shade = i % 2 === 0 ? '#17290f' : '#1c3313';
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(cx - halfWpx, yBasePx);
    ctx.quadraticCurveTo(cx - halfWpx * 0.55, (yBasePx + yTipPx) / 2, cx, yTipPx);
    ctx.quadraticCurveTo(cx + halfWpx * 0.55, (yBasePx + yTipPx) / 2, cx + halfWpx, yBasePx);
    ctx.closePath();
    ctx.fill();
  }

  return made.canvas;
}

/** Paint + upload. Returns null when no canvas implementation exists. */
export function createImpostorTexture(): THREE.CanvasTexture | null {
  const canvas = paintPineImpostor();
  if (!canvas) return null;
  const tex = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
