/**
 * UI state types, defaults, and every user-facing string in one place.
 * Copy rules (ART-DIRECTION): plain verbs, sentence case, active voice,
 * no exclamation marks, no achievement language. "Graphics quality",
 * "Drive".
 */
import type { QualityTier } from '@contracts/core';
import type { AudioChannel } from '@contracts/audio';
import type { KeyBinding } from '@contracts/input';

export type Phase = 'opening' | 'driving' | 'paused';

export interface UiSettings {
  tier: QualityTier;
  resolutionScale: number;
  fovDeg: number;
  volumes: Record<AudioChannel, number>;
  preset: 'default' | 'silence';
  reducedMotion: boolean;
  horizonLock: boolean;
}

export const DEFAULT_SETTINGS: UiSettings = {
  tier: 'auto',
  resolutionScale: 1,
  fovDeg: 60,
  volumes: { engine: 0.8, tyres: 0.8, ambience: 0.8, music: 0.6, wind: 0.7, master: 1 },
  preset: 'default',
  reducedMotion: false,
  horizonLock: false,
};

export const DEFAULT_BINDINGS: KeyBinding[] = [
  { action: 'throttle', code: 'KeyW' },
  { action: 'brake', code: 'KeyS' },
  { action: 'left', code: 'KeyA' },
  { action: 'right', code: 'KeyD' },
  { action: 'handbrake', code: 'Space' },
  { action: 'recover', code: 'KeyR' },
];

export const AUDIO_CHANNELS: ReadonlyArray<{ id: AudioChannel; label: string }> = [
  { id: 'engine', label: 'Engine' },
  { id: 'tyres', label: 'Tyres' },
  { id: 'ambience', label: 'Ambience' },
  { id: 'music', label: 'Music' },
  { id: 'wind', label: 'Wind' },
  { id: 'master', label: 'Master' },
];

export const QUALITY_TIERS: ReadonlyArray<{ id: QualityTier; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'ultra', label: 'Ultra' },
];

/** Remap list order mirrors KeyBinding actions. */
export const ACTION_LABELS: ReadonlyArray<{ action: KeyBinding['action']; label: string }> = [
  { action: 'throttle', label: 'Throttle' },
  { action: 'brake', label: 'Brake' },
  { action: 'left', label: 'Steer left' },
  { action: 'right', label: 'Steer right' },
  { action: 'handbrake', label: 'Handbrake' },
  { action: 'recover', label: 'Recover' },
];

/** Every user-facing string the shell renders. */
export const COPY = {
  openingLine: 'Drive as long as you like.',
  pauseTitle: 'Paused',
  pauseHint: 'Escape closes',
  drive: 'Drive',
  graphicsQuality: 'Graphics quality',
  resolutionScale: 'Resolution scale',
  fieldOfView: 'Field of view',
  sound: 'Sound',
  controls: 'Controls',
  accessibility: 'Accessibility',
  world: 'World',
  reducedMotion: 'Reduced motion',
  horizonLock: 'Horizon lock',
  silencePreset: 'Silence',
  seedLabel: 'Seed',
  applySeed: 'Apply seed',
  pressAKey: 'Press a key',
  seedInvalid: 'Enter a whole number between 0 and 999999.',
} as const;
