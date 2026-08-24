import type { KeyBinding } from '@contracts/input';

/**
 * Key-remap collision logic — pure functions (a11y agent, Wave 2).
 *
 * §6.7 error style: the message explains what happened and offers the fix
 * ("Swapped with Throttle" / "Key already used by Brake"), never a bare
 * "error".
 */

export interface RemapResult {
  readonly ok: boolean;
  /** Updated bindings when ok; unchanged list when rejected. */
  readonly bindings: KeyBinding[];
  /** Human explanation, always present when not ok. */
  readonly message?: string;
}

/** Human label for an action code. */
export function actionLabel(action: KeyBinding['action']): string {
  const labels: Record<KeyBinding['action'], string> = {
    throttle: 'Throttle',
    brake: 'Brake',
    left: 'Steer left',
    right: 'Steer right',
    handbrake: 'Handbrake',
    recover: 'Recover',
  };
  return labels[action];
}

/**
 * Apply a rebinding of `action` to `newCode`.
 *
 * Rules:
 * - binding to a key already owned by ANOTHER action swaps the two actions,
 *   so no action is ever left without a key;
 * - Escape is never bindable (reserved for pause);
 * - rebinding to the same key is a no-op success.
 */
export function applyRemap(
  bindings: ReadonlyArray<KeyBinding>,
  action: KeyBinding['action'],
  newCode: string,
): RemapResult {
  if (newCode === 'Escape') {
    return {
      ok: false,
      bindings: [...bindings],
      message: 'Escape opens the menu, so it stays reserved.',
    };
  }

  const next = bindings.map((b) => ({ ...b }));
  const target = next.find((b) => b.action === action);
  if (!target) {
    return { ok: false, bindings: [...bindings], message: 'Unknown control.' };
  }
  if (target.code === newCode) {
    return { ok: true, bindings: next };
  }

  const other = next.find((b) => b.code === newCode && b.action !== action);
  if (other) {
    // Swap: the displaced action takes this action's old key.
    const oldCode = target.code;
    other.code = oldCode;
    target.code = newCode;
    return {
      ok: true,
      bindings: next,
      message: `Swapped with ${actionLabel(other.action)}.`,
    };
  }

  target.code = newCode;
  return { ok: true, bindings: next };
}

/**
 * Focus management helpers (pure DOM-free bookkeeping so tests can run).
 * Tracks the element to restore focus to when a modal closes.
 */
export class FocusRestore {
  private prev: HTMLElement | null = null;

  capture(currentlyFocused: HTMLElement | null): void {
    this.prev = currentlyFocused;
  }

  /** Returns the element focus should return to (and clears the record). */
  release(): HTMLElement | null {
    const el = this.prev;
    this.prev = null;
    return el;
  }

  get hasPending(): boolean {
    return this.prev !== null;
  }
}
