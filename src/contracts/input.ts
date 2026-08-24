/** Normalised input axes shared by keyboard, gamepad and touch. */
export interface InputState {
  /** -1..1, +1 = right. */
  steer: number;
  /** 0..1. */
  throttle: number;
  /** 0..1 (space). */
  brake: number;
  /** True on the frame a recover request arrives. */
  recover: boolean;
}

export type PIDict<T> = Record<string, T>;

export interface InputSource {
  readonly name: 'keyboard' | 'gamepad' | 'touch';
  sample(): InputState;
}

export interface KeyBinding {
  action: 'throttle' | 'brake' | 'left' | 'right' | 'handbrake' | 'recover';
  code: string; // KeyboardEvent.code
}

export interface InputSystem {
  addSource(src: InputSource): void;
  state: InputState;
  bindings: KeyBinding[];
  rebind(action: KeyBinding['action'], code: string): void;
  dispose(): void;
}
