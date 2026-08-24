import type { AudioBus, AudioChannel } from '@contracts/audio';

/** audio agent (F) owns. Stub: silent. */
export class StubAudio implements AudioBus {
  async init(): Promise<void> {}
  setVolume(_ch: AudioChannel, _v: number): void {}
  applyPreset(): void {}
  update(): void {}
  suspend(): void {}
  resume(): void {}
  stats(): { nodeCount: number } {
    return { nodeCount: 0 };
  }
  dispose(): void {}
}
