/** Rig shapes shared by builders and the bus. */

export interface AudioRig {
  /** Worst-case output amplitude at unity channel gain (headroom ledger). */
  readonly peak: number;
  dispose(): void;
}

export interface EngineRig extends AudioRig {
  update(t: number, rpm01: number): void;
}

export interface TyreRig extends AudioRig {
  update(t: number, surface: number, speed01: number): void;
}

export interface WindRig extends AudioRig {
  update(t: number, windLevel: number, speed01: number): void;
}

export interface AmbienceRig extends AudioRig {
  update(t: number): void;
  setSky(light: string, weather: string): void;
}

export interface MusicRig extends AudioRig {
  update(t: number): void;
}
