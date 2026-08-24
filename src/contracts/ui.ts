import type { QualitySettings } from './core';

/**
 * The Trace — signature ink-map feature. Persists to localStorage per seed.
 */
export interface TracePoint {
  x: number;
  z: number;
  t: number; // seconds since session start
}

export interface TraceMark {
  x: number;
  z: number;
  label: string; // typewritten caption
}

export interface TraceStore {
  beginSeed(seed: number): void;
  append(pt: TracePoint): void; // decimated by writer, not raw GPS spam
  addMark(mark: TraceMark): void;
  exportForPlate(): { points: TracePoint[]; marks: TraceMark[] };
}

/** Photo mode controls. Export renders at 2x and downloads a PNG. */
export interface PhotoMode {
  enter(): void;
  exit(): void;
  setAperture(fStops: number): void;
  captureAndExport(): Promise<void>;
}

export interface UiSystem {
  mount(root: HTMLElement, quality: QualitySettings): void;
  setHudVisible(visible: boolean): void;
  openPause(): void;
  closePause(): void;
}
