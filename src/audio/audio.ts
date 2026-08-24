/**
 * Public surface of the audio subsystem (agent F owns this folder).
 * The real implementation lives in bus.ts; this module is the stable import
 * point for boot wiring.
 */

import type { AudioBus } from '@contracts/audio';
import { UnderstoryAudio } from './bus';

export { UnderstoryAudio } from './bus';

/**
 * Create the game's AudioBus. `setSky(light, weather)` and `peakEstimate()`
 * are extras beyond the contract (see docs/notes/audio.md) — the orchestrator
 * should wire sky events to setSky.
 */
export function createAudioBus(): AudioBus & {
  setSky(light: string, weather: string): void;
  peakEstimate(): number;
} {
  return new UnderstoryAudio();
}
