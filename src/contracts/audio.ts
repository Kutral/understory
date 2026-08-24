/** Mixer channel ids, one fader each in settings. */
export type AudioChannel =
  | 'engine'
  | 'tyres'
  | 'ambience'
  | 'music'
  | 'wind'
  | 'master';

export interface AudioMixerState {
  volumes: Record<AudioChannel, number>; // 0..1
  mutedMusicOnly: boolean;
  preset: 'default' | 'silence';
}

/**
 * Raw WebAudio graph behind a real mixer.
 * Rule: every node is created at init or on preset change — never per frame.
 */
export interface AudioBus {
  init(ctx: AudioContext): Promise<void>;
  setVolume(ch: AudioChannel, v: number): void;
  applyPreset(p: AudioMixerState['preset']): void;
  /** Per-tick parameter updates (setTargetAtTime only; no node creation). */
  update(vehicleSpeed01: number, rpm01: number, surface: number, windLevel: number): void;
  suspend(): void;
  resume(): void;
  stats(): { nodeCount: number };
  dispose(): void;
}
