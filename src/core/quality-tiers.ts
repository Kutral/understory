import type { QualitySettings, QualityTier } from '@contracts/core';

/** Adaptive DPR clamp from the core contract. */
export const MIN_DPR_SCALE = 0.66;
export const MAX_DPR_SCALE = 1.6;

type FixedTier = Exclude<QualityTier, 'auto'>;

/**
 * Per-tier post/LOP settings. DPR scale multiplies min(devicePixelRatio, 2).
 * Auto seeds at high defaults and adapts DPR only (feature flags stay fixed
 * so pipelines are never rebuilt mid-drive — zero post-load shader compiles).
 */
export const TIER_SETTINGS: Record<FixedTier, QualitySettings> = {
  low: {
    tier: 'low',
    dprScale: MIN_DPR_SCALE,
    fovDeg: 60,
    bloom: false,
    dof: false,
    grain: false,
    godRays: false,
    reducedMotion: false,
  },
  medium: {
    tier: 'medium',
    dprScale: 0.85,
    fovDeg: 60,
    bloom: true,
    dof: false,
    grain: false,
    godRays: false,
    reducedMotion: false,
  },
  high: {
    tier: 'high',
    dprScale: 1.0,
    fovDeg: 60,
    bloom: true,
    dof: false,
    grain: true,
    godRays: true,
    reducedMotion: false,
  },
  ultra: {
    tier: 'ultra',
    dprScale: 1.25,
    fovDeg: 58,
    bloom: true,
    dof: true,
    grain: true,
    godRays: true,
    reducedMotion: false,
  },
};

const AUTO_SEED: QualitySettings = { ...TIER_SETTINGS.high, tier: 'auto', dprScale: 1.0 };

export function resolveTierSettings(tier: QualityTier): QualitySettings {
  return tier === 'auto' ? { ...AUTO_SEED } : { ...TIER_SETTINGS[tier] };
}
