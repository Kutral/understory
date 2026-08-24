/**
 * Node registry — the accounting backbone of the "never create per frame"
 * hard rule. Every persistent node is registered exactly once at build time;
 * `stats().nodeCount` reports this registry, and tests assert it never moves
 * after init/preset change.
 *
 * One-shot sounds do NOT spawn nodes: each one-shot owns a persistent voice
 * created at init and is fired purely with parameter automation
 * (setValueCurveAtTime), so the graph topology is immutable forever.
 */
import type { AudioChannel } from '@contracts/audio';

/** Worst-case output amplitude of each rig at unity channel gain. */
export const RIG_PEAKS: Record<AudioChannel, number> = {
  engine: 0.23,
  tyres: 0.17,
  ambience: 0.19,
  music: 0.23,
  wind: 0.13,
  master: 0, // master carries no source of its own
};

export class NodeRegistry {
  private nodes: AudioNode[] = [];

  add<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  get size(): number {
    return this.nodes.length;
  }

  disconnectAll(): void {
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already detached */
      }
    }
    this.nodes = [];
  }
}
