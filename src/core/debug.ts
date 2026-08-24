import type { DebugOverlay, DebugStats } from '@contracts/core';

/** ?debug=1 overlay stub — agent A owns. */
export class DebugHud implements DebugOverlay {
  update(_stats: DebugStats): void {
    // rendered only when ?debug=1
  }
}

export function debugEnabled(): boolean {
  return new URLSearchParams(location.search).has('debug');
}
