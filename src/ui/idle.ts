/**
 * HUD idle timer — pure logic, no DOM, fully clock-injectable so it is
 * unit-testable in a node environment.
 *
 * Rule (ART-DIRECTION "Driving HUD" + constants.HUD_IDLE_HIDE_S): the HUD
 * fades after 4 seconds of steady driving and returns immediately on any
 * input.
 */
import { HUD_IDLE_HIDE_S } from '@contracts/constants';

export type Seconds = number;

export interface IdleClock {
  now(): Seconds;
}

export const performanceClock: IdleClock = {
  now: () => performance.now() / 1000,
};

export class HudIdleTimer {
  private lastInputAt: Seconds;
  private hidden = false;

  constructor(
    private readonly hideAfterS: number = HUD_IDLE_HIDE_S,
    private readonly clock: IdleClock = performanceClock,
  ) {
    this.lastInputAt = this.clock.now();
  }

  /** Any player input (key, gamepad deflection, pointer move). */
  notifyInput(at?: Seconds): void {
    this.lastInputAt = at ?? this.clock.now();
    if (this.hidden) {
      this.hidden = false;
      this.onShow?.();
    }
  }

  /**
   * Advance time while driving. Returns `true` while the HUD should be
   * visible. Called once per tick/frame by the shell.
   */
  update(now?: Seconds): boolean {
    const t = now ?? this.clock.now();
    this.hidden = t - this.lastInputAt >= this.hideAfterS;
    return !this.hidden;
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  /** Optional hooks for wiring to signals without polling. */
  onShow?: () => void;

  /** Re-show without counting as input (e.g. pause opened). */
  forceVisible(): void {
    this.lastInputAt = this.clock.now();
    if (this.hidden) {
      this.hidden = false;
      this.onShow?.();
    }
  }
}
