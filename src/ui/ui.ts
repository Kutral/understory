import type { UiSystem, TraceStore, PhotoMode } from '@contracts/ui';
import type { QualitySettings } from '@contracts/core';

/** ui-shell agent (E) + the-trace agent (I) own. Stub: empty shell. */
export class StubUi implements UiSystem {
  mount(_root: HTMLElement, _quality: QualitySettings): void {}
  setHudVisible(): void {}
  openPause(): void {}
  closePause(): void {}
}

export class StubTrace implements TraceStore {
  beginSeed(): void {}
  append(): void {}
  addMark(): void {}
  exportForPlate() {
    return { points: [], marks: [] };
  }
}

export class StubPhoto implements PhotoMode {
  enter(): void {}
  exit(): void {}
  setAperture(): void {}
  async captureAndExport(): Promise<void> {}
}
