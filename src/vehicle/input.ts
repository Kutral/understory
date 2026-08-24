import type { InputSource, InputState, KeyBinding } from '@contracts/input';
import { applyDeadzone } from './vehicle-math';
import { BindingsStore, safeLocalStorage, type KvStorage } from './bindings';

/**
 * Understory input system (agent C).
 *
 * Combines up to three sources into one normalised InputState per fixed tick:
 *  - keyboard: WASD + arrows + Space (remappable, persisted to localStorage)
 *  - gamepad:  standard mapping, TRUE analog axes with deadzone
 *  - touch:    left thumb steering arc + right throttle/brake pad
 *
 * Combination rules: steer sums and clamps; throttle/brake take the max;
 * recover latches until the next poll() so a press is never lost between
 * ticks and is never delivered twice.
 */

export const GAMEPAD_DEADZONE = 0.14;
export const TOUCH_DEADZONE = 0.08;

/** Edge-detecting wrapper for boolean buttons (keyboard + gamepad + touch). */
class ButtonLatch {
  private held = false;
  private latched = false;

  set(heldNow: boolean): void {
    if (heldNow && !this.held) this.latched = true;
    this.held = heldNow;
  }

  get pressed(): boolean {
    return this.latched;
  }

  clear(): void {
    this.latched = false;
  }
}

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

export class KeyboardSource implements InputSource {
  readonly name = 'keyboard' as const;
  private readonly down = new Set<string>();
  private readonly recoverLatch = new ButtonLatch();
  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    this.down.add(e.code);
    if (e.code === 'Space') e.preventDefault(); // stop page scroll under braking
  };
  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
  private readonly onBlur = (): void => {
    this.down.clear(); // no stuck keys when the tab loses focus
  };

  constructor(private readonly bindings: () => KeyBinding[]) {}

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  sample(): InputState {
    const codes = new Set(this.down);
    const anyAction = (action: KeyBinding['action']): boolean =>
      this.bindings().some((b) => b.action === action && codes.has(b.code));
    this.recoverLatch.set(anyAction('recover'));
    const left = anyAction('left') ? 1 : 0;
    const right = anyAction('right') ? 1 : 0;
    // Space ('handbrake') folds into the brake channel — InputState has one
    // brake axis; the vehicle biases it to the rear axle for gentle slides.
    const brake = Math.max(anyAction('brake') ? 1 : 0, anyAction('handbrake') ? 0.6 : 0);
    return {
      steer: right - left,
      throttle: anyAction('throttle') ? 1 : 0,
      brake,
      recover: this.recoverLatch.pressed,
    };
  }

  consumeLatch(): void {
    this.recoverLatch.clear();
    // keyup events still clear `down` naturally
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }
}

// ---------------------------------------------------------------------------
// Gamepad (standard mapping)
// ---------------------------------------------------------------------------

interface NavigatorGamepads {
  getGamepads(): (Gamepad | null)[];
}

/**
 * Standard-mapping gamepad:
 *   axes[0]        left stick X  -> steer (true analog, deadzoned)
 *   buttons[7] RT / buttons[0] A  -> throttle analog trigger value
 *   buttons[6] LT / buttons[1] B  -> brake
 *   buttons[2] X                  -> handbrake
 *   buttons[3] Y                  -> recover
 *   buttons[12..15] D-pad         -> digital steer/throttle fallback
 */
export class GamepadSource implements InputSource {
  readonly name = 'gamepad' as const;
  private readonly recoverLatch = new ButtonLatch();
  private prevHandbrake = false;

  constructor(private readonly nav: NavigatorGamepads) {}

  private pad(): Gamepad | null {
    const pads = this.nav.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** Exposed for UI ("press A to join"-style hints). */
  isConnected(): boolean {
    return this.pad() !== null;
  }

  sample(): InputState {
    const p = this.pad();
    if (!p) return { steer: 0, throttle: 0, brake: 0, recover: false };

    const rawSteer = p.axes.length > 0 ? (p.axes[0] ?? 0) : 0;
    let steer = applyDeadzone(rawSteer, GAMEPAD_DEADZONE);

    const btn = (i: number): number => p.buttons[i]?.value ?? 0;
    const btnHeld = (i: number): boolean => (p.buttons[i]?.pressed ?? false) || btn(i) > 0.5;

    // D-pad fallback layers on top of the stick.
    if (btnHeld(14)) steer = Math.min(steer, -0.7);
    if (btnHeld(15)) steer = Math.max(steer, 0.7);

    const throttle = Math.max(btn(7), btn(0), btnHeld(12) ? 1 : 0);
    // D-pad + X button all fold into the single brake channel.
    const brake = Math.max(btn(6), btn(1), btnHeld(13) || btnHeld(2) ? 1 : 0);

    this.recoverLatch.set(btnHeld(3));
    return { steer, throttle, brake, recover: this.recoverLatch.pressed };
  }

  consumeLatch(): void {
    this.recoverLatch.clear();
  }

  dispose(): void {
    /* no listeners — polled each tick */
  }
}

// ---------------------------------------------------------------------------
// Touch controls
// ---------------------------------------------------------------------------

const TOUCH_STEER_MAX_PX = 64;
const TOUCH_PAD_HEIGHT_PX = 96;

/**
 * Usable-simple touch overlay:
 *  - LEFT: steering arc. Drag anywhere in the left half; horizontal offset
 *    from touch-start maps to steer -1..1 (deadzoned). Releases recenter.
 *  - RIGHT: vertical pad. Drag up = throttle (analog by height), drag down =
 *    brake. Tap-and-hold top edge = full throttle.
 * A small RECOVER button sits above the right pad.
 */
export class TouchControls implements InputSource {
  readonly name = 'touch' as const;
  private root: HTMLDivElement | null = null;
  private steerStartX = 0;
  private steerActive = false;
  private padY = 0;
  private padActive = false;

  constructor(
    private readonly onRecover: () => void,
    private readonly doc: Document,
  ) {}

  /** Builds the DOM overlay once; safe to call repeatedly. */
  enable(): void {
    if (this.root) return;
    const root = this.doc.createElement('div');
    root.id = 'understory-touch';
    root.innerHTML = `
      <div data-touch="steer" style="position:fixed;left:0;bottom:0;width:50vw;height:60vh;z-index:40;"></div>
      <div data-touch="pad" style="position:fixed;right:12px;bottom:12px;width:120px;height:${TOUCH_PAD_HEIGHT_PX}px;border-radius:16px;background:rgba(47,66,52,.45);border:1px solid rgba(230,220,198,.35);z-index:41;"></div>
      <div data-touch="recover" style="position:fixed;right:24px;bottom:${TOUCH_PAD_HEIGHT_PX + 28}px;width:96px;height:44px;border-radius:12px;background:rgba(47,66,52,.55);color:#E6DCC6;font:600 14px sans-serif;display:flex;align-items:center;justify-content:center;z-index:41;">Recover</div>`;
    const steerZone = root.querySelector<HTMLElement>('[data-touch="steer"]');
    const padZone = root.querySelector<HTMLElement>('[data-touch="pad"]');
    const recBtn = root.querySelector<HTMLElement>('[data-touch="recover"]');
    if (!steerZone || !padZone || !recBtn) return;

    steerZone.addEventListener(
      'pointerdown',
      (e) => {
        this.steerActive = true;
        this.steerStartX = e.clientX;
      },
      { passive: true },
    );
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerup', this.onPointerUp, { passive: true });

    padZone.addEventListener(
      'pointerdown',
      (e) => {
        this.padActive = true;
        this.padY = e.clientY;
      },
      { passive: true },
    );
    recBtn.addEventListener('pointerdown', () => this.onRecover(), { passive: true });
    this.root = root;
    this.doc.body.appendChild(root);
  }

  private onPointerMove = (e: PointerEvent): void => {
    if (this.steerActive || this.padActive) this.track(e);
  };

  private onPointerUp = (): void => {
    this.steerActive = false;
    this.padActive = false;
    this.padY = 0;
  };

  private track(e: PointerEvent): void {
    if (this.steerActive) this.steerX = e.clientX;
    if (this.padActive) this.padCurrentY = e.clientY;
  }

  private steerX = 0;
  private padCurrentY = 0;

  sample(): InputState {
    let steer = 0;
    if (this.steerActive) {
      const dx = this.steerX - this.steerStartX;
      steer = applyDeadzone(Math.max(-1, Math.min(1, dx / TOUCH_STEER_MAX_PX)), TOUCH_DEADZONE);
    }
    let throttle = 0;
    let brake = 0;
    if (this.padActive) {
      const dy = this.padCurrentY - this.padY; // up = negative
      if (dy < 0) throttle = Math.min(1, -dy / (TOUCH_PAD_HEIGHT_PX / 2));
      else brake = Math.min(1, dy / (TOUCH_PAD_HEIGHT_PX / 2));
    }
    return { steer, throttle, brake, recover: false };
  }

  disable(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.root?.remove();
    this.root = null;
  }
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export class InputSystemImpl {
  readonly state: InputState = { steer: 0, throttle: 0, brake: 0, recover: false };
  private readonly sources: InputSource[] = [];
  private readonly keyboard: KeyboardSource | null;
  private readonly gamepad: GamepadSource | null;
  private touch: TouchControls | null = null;
  private readonly recoverLatch = new ButtonLatch();

  readonly store: BindingsStore;

  get bindings(): KeyBinding[] {
    return this.store.bindings;
  }

  constructor(storage: KvStorage | null = safeLocalStorage()) {
    this.store = new BindingsStore(storage);
    if (typeof window !== 'undefined') {
      this.keyboard = new KeyboardSource(() => this.store.bindings);
      this.keyboard.attach();
    } else {
      this.keyboard = null;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      this.gamepad = new GamepadSource(navigator);
    } else {
      this.gamepad = null;
    }
    if (this.gamepad) this.sources.push(this.gamepad);
    if (this.keyboard) this.sources.push(this.keyboard);
  }

  addSource(src: InputSource): void {
    this.sources.push(src);
  }

  /** Enable the thumb overlay once a touch is seen (or forced for testing). */
  enableTouch(): void {
    if (!this.touch && typeof document !== 'undefined') {
      this.touch = new TouchControls(() => this.recoverLatch.set(true), document);
      this.touch.enable();
      this.sources.unshift(this.touch); // sampled last wins priority checks below
    }
  }

  rebind(action: KeyBinding['action'], code: string): void {
    this.store.rebind(action, code);
  }

  /**
   * Poll all sources and refresh `state`. Call exactly once per fixed tick
   * (phase order: input -> vehicle). Recover is edge-latched: true for the
   * single poll after the press, never twice.
   */
  poll(): InputState {
    let steer = 0;
    let throttle = 0;
    let brake = 0;
    let recoverPressed = false;
    for (const src of this.sources) {
      const s = src.sample();
      steer += s.steer;
      throttle = Math.max(throttle, s.throttle);
      brake = Math.max(brake, s.brake);
      if (s.recover) recoverPressed = true;
      if (src === this.keyboard) this.keyboard.consumeLatch();
      if (src === this.gamepad) this.gamepad.consumeLatch();
    }
    this.recoverLatch.set(recoverPressed);
    this.state.steer = Math.max(-1, Math.min(1, steer));
    this.state.throttle = Math.max(0, Math.min(1, throttle));
    this.state.brake = Math.max(0, Math.min(1, brake));
    this.state.recover = this.recoverLatch.pressed;
    this.recoverLatch.clear();
    return this.state;
  }

  dispose(): void {
    this.keyboard?.detach();
    this.touch?.disable();
    this.sources.length = 0;
  }
}
