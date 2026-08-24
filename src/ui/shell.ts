/**
 * Understory UI shell — implements `UiSystem` from @contracts/ui.
 *
 * Design rules:
 *  - mounted once on #ui; absolutely positioned, so zero layout shift;
 *  - fonts are self-hosted with metric-matched fallbacks, so no font flash
 *    ever reflows anything;
 *  - every DOM write lives in a signal-store effect, and effects run only in
 *    `flush()` at the frame boundary — steady-state cost when nothing changed
 *    is one pending-set size check per animation frame;
 *  - the HUD hides itself after HUD_IDLE_HIDE_S of steady driving and returns
 *    on any input;
 *  - settings sit behind Escape from frame one, including during the opening.
 *
 * Phase machine: opening → driving ⇄ paused (the opening can also go
 * opening ⇄ paused; leaving paused toward driving starts the drive).
 */
import type { UiSystem } from '@contracts/ui';
import type { QualitySettings, QualityTier } from '@contracts/core';
import type { AudioChannel } from '@contracts/audio';
import type { KeyBinding } from '@contracts/input';
import { createUiSignalStore } from './store';
import { HudIdleTimer, performanceClock } from './idle';
import { createHud, type ReadSignal } from './hud';
import { createOpening } from './opening';
import { createPause, type PauseHandle } from './pause';
import { DEFAULT_BINDINGS, DEFAULT_SETTINGS, type Phase, type UiSettings } from './state';

import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/shell.css';
import '../styles/opening.css';
import '../styles/hud.css';
import '../styles/pause.css';

/** Outbound events other subsystems subscribe to. */
export interface UiHooks {
  /** Driving begins for the first time (vehicle starts rolling). */
  onStartDriving(): void;
  onOpenPause(): void;
  onClosePause(): void;
  onQualityChange(tier: QualityTier): void;
  onGraphicsChange(s: { resolutionScale: number; fovDeg: number }): void;
  onVolumeChange(ch: AudioChannel, v: number): void;
  onPresetChange(preset: 'default' | 'silence'): void;
  onReducedMotionChange(v: boolean): void;
  onHorizonLockChange(v: boolean): void;
  onBindingsChange(bindings: KeyBinding[]): void;
  onSeedChange(seed: number): void;
}

function noopHooks(): UiHooks {
  return {
    onStartDriving() {},
    onOpenPause() {},
    onClosePause() {},
    onQualityChange() {},
    onGraphicsChange() {},
    onVolumeChange() {},
    onPresetChange() {},
    onReducedMotionChange() {},
    onHorizonLockChange() {},
    onBindingsChange() {},
    onSeedChange() {},
  };
}

export class UnderstoryUi implements UiSystem {
  private readonly hooks: UiHooks;
  private readonly store = createUiSignalStore();

  private readonly phaseSig = this.store.signal<Phase>('opening');
  private readonly speedSig = this.store.signal(0);
  private readonly daySig = this.store.signal(0.25); // dawn, per the opening
  private readonly hudVisibleSig = this.store.signal(false); // hidden until driving
  private readonly manualHudSig = this.store.signal<boolean | null>(null); // external override
  private readonly reducedMotionSig = this.store.signal(
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  private readonly idle = new HudIdleTimer(undefined, performanceClock);
  settings: UiSettings = structuredClone(DEFAULT_SETTINGS);
  private bindings: KeyBinding[] = DEFAULT_BINDINGS.map((b) => ({ ...b }));

  private rootEl: HTMLElement | null = null;
  private openingEl: HTMLElement | null = null;
  private pauseHandle: PauseHandle | null = null;
  private phaseBeforePause: Phase = 'opening';
  private started = false;
  private rafId: number | null = null;
  private disposed = false;

  /** Rolling cost of the per-frame flush, for perf-budget evidence. */
  private uiMsLast = 0;
  private uiMsSum = 0;
  private uiMsMax = 0;
  private uiFrames = 0;

  constructor(hooks?: Partial<UiHooks>) {
    this.hooks = { ...noopHooks(), ...hooks };
  }

  mount(root: HTMLElement, quality: QualitySettings): void {
    if (this.rootEl || this.disposed) return;

    this.settings = {
      ...this.settings,
      tier: quality.tier,
      fovDeg: quality.fovDeg,
      resolutionScale: quality.dprScale > 0 ? quality.dprScale : this.settings.resolutionScale,
    };

    const shell = document.createElement('div');
    shell.className = 'us-root';
    root.append(shell);
    this.rootEl = shell;

    // --- HUD ------------------------------------------------------------
    const hud = createHud(this.store, {
      speedKmh: this.speedSig,
      dayT: this.daySig,
      hudVisible: this.hudVisibleSig,
    });
    shell.append(hud.root);

    // --- Opening ----------------------------------------------------------
    const opening = createOpening({
      onStart: () => this.beginDriving(),
      onPauseRequest: () => this.openPause(),
    });
    shell.append(opening.root);
    this.openingEl = opening.root;

    // --- Pause / settings ---------------------------------------------------
    this.pauseHandle = createPause(
      this.settings,
      this.bindings,
      {
        onResume: () => {
          // the "Drive" button always means: drive
          this.pauseHandle!.close();
          this.unpause('driving');
          this.beginDriving(true);
        },
        onRequestClose: () => this.closePause(),
        onSettingsChange: (next) => this.applySettings(next),
        onBindingsChange: (b) => {
          this.bindings = b;
          this.hooks.onBindingsChange(b.map((x) => ({ ...x })));
        },
        onSeedChange: (seed) => this.hooks.onSeedChange(seed),
      },
    );
    shell.append(this.pauseHandle.root);

    // --- Effects (initial run happens now; afterwards only inside flush) ---
    const unbindReducedMotion = this.store.effect(() => {
      shell.dataset.reducedMotion = String(this.reducedMotionSig.value);
    });
    void unbindReducedMotion; // shell-lifetime binding
    this.reducedMotionSig.set(this.settings.reducedMotion);
    this.store.flush();

    window.addEventListener('keydown', this.onGlobalKey);
    // any raw input returns the HUD (ART-DIRECTION: "fades after 4s steady
    // driving" — gamepad/touch arrive via playerInput(); keyboard here)
    window.addEventListener('keydown', this.onActivity);
    window.addEventListener('pointerdown', this.onActivity);

    // One flush per frame boundary; near-zero cost when pending is empty.
    const frame = (): void => {
      if (this.disposed) return;
      if (this.phaseSig.value === 'driving') {
        this.idle.update();
        this.hudVisibleSig.set(this.manualHudSig.value ?? !this.idle.isHidden);
      }
      const t0 = performance.now();
      this.store.flush();
      const dt = performance.now() - t0;
      this.uiMsLast = dt;
      this.uiMsSum += dt;
      if (dt > this.uiMsMax) this.uiMsMax = dt;
      this.uiFrames++;
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  /** Perf-budget evidence: flush cost per frame since mount, in ms. */
  uiStats(): { lastMs: number; avgMs: number; maxMs: number; frames: number } {
    return {
      lastMs: +this.uiMsLast.toFixed(3),
      avgMs: +(this.uiMsSum / Math.max(1, this.uiFrames)).toFixed(3),
      maxMs: +this.uiMsMax.toFixed(3),
      frames: this.uiFrames,
    };
  }

  /** Live telemetry — called by vehicle/sky systems per tick or sparsely. */
  setSpeed(kmh: number): void {
    this.speedSig.set(kmh);
  }

  setTimeOfDay(dayT: number): void {
    this.daySig.set(dayT);
  }

  /** Forward any raw player activity here so the HUD idle timer resets. */
  playerInput(): void {
    this.idle.notifyInput();
    this.hudVisibleSig.set(this.manualHudSig.value ?? true);
  }

  setHudVisible(visible: boolean): void {
    this.manualHudSig.set(visible ? true : false);
    if (visible) this.idle.notifyInput();
  }

  openPause(): void {
    if (!this.pauseHandle || this.phaseSig.value === 'paused') return;
    this.phaseBeforePause = this.phaseSig.value;
    this.phaseSig.set('paused');
    this.pauseHandle.open();
    this.hooks.onOpenPause();
  }

  closePause(): void {
    if (!this.pauseHandle || this.phaseSig.value !== 'paused') return;
    this.pauseHandle.close();
    this.unpause(this.phaseBeforePause);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    window.removeEventListener('keydown', this.onGlobalKey);
    window.removeEventListener('keydown', this.onActivity);
    window.removeEventListener('pointerdown', this.onActivity);
    this.pauseHandle?.dispose();
    this.rootEl?.remove();
    this.rootEl = null;
    this.openingEl = null;
  }

  // --- internals -------------------------------------------------------------

  private unpause(to: Phase): void {
    this.phaseSig.set(to === 'paused' ? 'driving' : to);
    this.idle.notifyInput();
    this.hooks.onClosePause();
  }

  /** Leave the opening overlay (fast fade, then remove). */
  private beginDriving(force = false): void {
    if (this.phaseSig.value === 'paused') return;
    if (this.phaseSig.value !== 'opening' && !force) return;
    this.phaseSig.set('driving');
    this.dismissOpening();
    this.idle.notifyInput();
    if (!this.started) {
      this.started = true;
      this.hooks.onStartDriving();
    }
  }

  private dismissOpening(): void {
    const el = this.openingEl;
    if (!el) return;
    this.openingEl = null;
    const line = el.querySelector('.us-opening__line');
    if (line instanceof HTMLElement) {
      el.dataset.exiting = 'true';
      line.addEventListener('animationend', () => el.remove(), { once: true });
      // belt and braces: never leave the layer attached longer than 2s
      window.setTimeout(() => el.remove(), 2000);
    } else {
      el.remove();
    }
  }

  private readonly onActivity = (): void => {
    if (this.phaseSig.value === 'driving') this.playerInput();
  };

  private readonly onGlobalKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      // The panel captures its own Escape (including remap capture); act here
      // only when it is closed.
      if (this.pauseHandle?.isOpen) return;
      e.preventDefault();
      this.openPause();
    }
  };

  private applySettings(next: UiSettings): void {
    const prev = this.settings;
    this.settings = next;
    this.pauseHandle?.applySettings(next);
    if (next.tier !== prev.tier) this.hooks.onQualityChange(next.tier);
    if (next.resolutionScale !== prev.resolutionScale || next.fovDeg !== prev.fovDeg) {
      this.hooks.onGraphicsChange({ resolutionScale: next.resolutionScale, fovDeg: next.fovDeg });
    }
    if (next.preset !== prev.preset) this.hooks.onPresetChange(next.preset);
    for (const ch of Object.keys(next.volumes) as AudioChannel[]) {
      if (next.volumes[ch] !== prev.volumes[ch]) this.hooks.onVolumeChange(ch, next.volumes[ch]!);
    }
    if (next.reducedMotion !== prev.reducedMotion) {
      this.reducedMotionSig.set(next.reducedMotion);
      this.hooks.onReducedMotionChange(next.reducedMotion);
    }
    if (next.horizonLock !== prev.horizonLock) this.hooks.onHorizonLockChange(next.horizonLock);
  }
}

/** Read-only signal view used by view modules. */
export type { ReadSignal };

/** Convenience factory for main.ts. */
export function createUi(hooks?: Partial<UiHooks>): UnderstoryUi {
  return new UnderstoryUi(hooks);
}
