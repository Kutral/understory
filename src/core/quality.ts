import { MAX_DPR_SCALE, MIN_DPR_SCALE, resolveTierSettings } from './quality-tiers';
import type { BackendName, QualitySettings, QualityTier } from '@contracts/core';
import type { EventBus } from '@contracts/events';

/**
 * QualityManager — owns the quality tier and (in auto mode) the adaptive DPR.
 *
 * Auto mode:
 * - Feeds every rendered frame's ms into a rolling window (~last 40 frames).
 * - Every ADJUST_INTERVAL_MS the window average is evaluated against the
 *   16.6ms budget: above → shrink DPR one step; below 13.3ms (≥20% headroom,
 *   hysteresis so it does not oscillate at the edge) → grow one step.
 * - dprScale clamped to [0.66, 1.6]. Final pixel ratio = min(devicePixelRatio,2)
 *   × dprScale, itself clamped ≤ 2 so a retina display cannot request 3.2×.
 * - Warmup: no adjustment before WARMUP_FRAMES samples exist.
 * - Feature flags never change in auto — only DPR moves — so GPU pipelines
 *   are not rebuilt mid-drive (zero post-load shader compiles).
 */
export const AUTO_WINDOW_MS = 16.6;
const WINDOW_SIZE = 40;
const ADJUST_INTERVAL_MS = 500;
const HEADROOM_AVG_MS = 13.3; // ~20% headroom under 16.6
const DPR_STEP = 0.06;
const BASE_DPR_CEILING = 2;
/** Warmup = one full ring-buffer pass before the first adjustment. */
const WARMUP_FRAMES = WINDOW_SIZE;

export class QualityManager {
  tier: QualityTier = 'medium';
  settings: QualitySettings;

  private readonly bus: EventBus | undefined;
  /** Rolling frame-time window in ms; ring buffer, zero-allocation. */
  private readonly window = new Float32Array(WINDOW_SIZE);
  private windowCount = 0;
  private windowCursor = 0;
  private lastAdjustAt = -Infinity;
  private baseDpr = 1;

  constructor(bus?: EventBus) {
    this.bus = bus;
    this.settings = resolveTierSettings('medium');
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.settings = resolveTierSettings(tier);
    if (tier !== 'auto') {
      // Manual tier: adaptive state resets entirely.
      this.window.fill(0);
      this.windowCount = 0;
      this.lastAdjustAt = -Infinity;
    }
    this.bus?.emit('quality/tierChanged', { to: tier });
    void MAX_DPR_SCALE; // re-exported for consumers; see quality-tiers.ts
  }

  /** Record backend/base DPR once known so pixelRatio() can compute. */
  configure(backend: BackendName, devicePixelRatio: number): void {
    void backend;
    this.baseDpr = Math.min(devicePixelRatio, BASE_DPR_CEILING);
  }

  observeFrame(frameMs: number): void {
    if (this.tier !== 'auto') return;
    this.window[this.windowCursor] = frameMs;
    this.windowCursor = (this.windowCursor + 1) % WINDOW_SIZE;
    if (this.windowCount < WINDOW_SIZE) this.windowCount++;
  }

  /** Called once per animation frame after observeFrame; may re-apply DPR. */
  update(now: number, apply: (pixelRatio: number) => void): void {
    if (this.tier !== 'auto' || this.windowCount < WARMUP_FRAMES) return;
    if (now - this.lastAdjustAt < ADJUST_INTERVAL_MS) return;

    const avg = this.windowAverage();
    let scale = this.settings.dprScale;
    if (avg > AUTO_WINDOW_MS) {
      scale = Math.max(MIN_DPR_SCALE, scale - DPR_STEP);
    } else if (avg < HEADROOM_AVG_MS) {
      scale = Math.min(MAX_DPR_SCALE, scale + DPR_STEP);
    } else {
      return; // inside the comfort band: leave it alone
    }

    if (scale !== this.settings.dprScale) {
      this.lastAdjustAt = now;
      this.settings = { ...this.settings, dprScale: scale };
      apply(this.pixelRatio());
    }
  }

  /** Current effective pixel ratio for renderer.setPixelRatio(). */
  pixelRatio(): number {
    return Math.min(this.baseDpr * this.settings.dprScale, BASE_DPR_CEILING);
  }

  /** Apply the current pixel ratio via a callback (kept DI-clean for tests). */
  apply(setPixelRatio: (pixelRatio: number) => void): void {
    setPixelRatio(this.pixelRatio());
  }

  windowAverage(): number {
    if (this.windowCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < this.windowCount; i++) sum += this.window[i] as number;
    return sum / this.windowCount;
  }

  /** One-line summary for the debug overlay. */
  describe(): string {
    return `${this.tier} ×${this.settings.dprScale.toFixed(2)} avg ${this.windowCount > 0 ? this.windowAverage().toFixed(1) : '—'}ms`;
  }
}
