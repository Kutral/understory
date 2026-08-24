import type { KeyBinding } from '@contracts/input';

/**
 * Pure key-binding store: rebind, reset, persistence via an injectable
 * storage adapter (localStorage in the browser, a Map fake in tests).
 * No DOM access here so the logic is unit-testable under vitest/node.
 */

export const BINDINGS_STORAGE_KEY = 'understory.input.bindings.v1';

/** Minimal Storage shape actually used (lets tests inject a Map-backed fake). */
export interface KvStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/** Default bindings: WASD + arrows both live, Space = handbrake, R = recover. */
export function defaultBindings(): KeyBinding[] {
  return [
    { action: 'throttle', code: 'KeyW' },
    { action: 'throttle', code: 'ArrowUp' },
    { action: 'brake', code: 'KeyS' },
    { action: 'brake', code: 'ArrowDown' },
    { action: 'left', code: 'KeyA' },
    { action: 'left', code: 'ArrowLeft' },
    { action: 'right', code: 'KeyD' },
    { action: 'right', code: 'ArrowRight' },
    { action: 'handbrake', code: 'Space' },
    { action: 'recover', code: 'KeyR' },
  ];
}

function isKeyBindingAction(a: string): a is KeyBinding['action'] {
  return ['throttle', 'brake', 'left', 'right', 'handbrake', 'recover'].includes(a);
}

export class BindingsStore {
  private readonly list: KeyBinding[];

  constructor(
    private readonly storage: KvStorage | null,
    private readonly storageKey = BINDINGS_STORAGE_KEY,
  ) {
    this.list = BindingsStore.load(storage, storageKey) ?? defaultBindings();
  }

  private static load(store: KvStorage | null, key: string): KeyBinding[] | null {
    if (!store) return null;
    try {
      const raw = store.getItem(key);
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      const out: KeyBinding[] = [];
      for (const entry of parsed) {
        if (
          entry !== null &&
          typeof entry === 'object' &&
          'action' in entry &&
          'code' in entry &&
          isKeyBindingAction(String(entry.action)) &&
          typeof entry.code === 'string'
        ) {
          out.push({ action: String(entry.action) as KeyBinding['action'], code: entry.code });
        }
      }
      return out.length > 0 ? out : null;
    } catch {
      return null; // corrupted or unavailable storage -> defaults
    }
  }

  get bindings(): KeyBinding[] {
    return this.list.slice();
  }

  /** All key codes currently mapped to an action. */
  codesFor(action: KeyBinding['action']): string[] {
    return this.list.filter((b) => b.action === action).map((b) => b.code);
  }

  /**
   * Rebind `action` to exactly `code` (replaces any previous codes for that
   * action) and persist. Returns false (no-op) for invalid inputs.
   */
  rebind(action: KeyBinding['action'], code: string): boolean {
    if (!/^[A-Za-z0-9]+$/.test(code)) return false;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      if (b && b.action === action) this.list.splice(i, 1);
    }
    this.list.push({ action, code });
    this.persist();
    return true;
  }

  reset(): void {
    this.list.length = 0;
    this.list.push(...defaultBindings());
    try {
      this.storage?.removeItem?.(this.storageKey);
    } catch {
      /* storage unavailable — defaults still applied in memory */
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(this.storageKey, JSON.stringify(this.list));
    } catch {
      /* quota/private mode — rebinding still works for this session */
    }
  }
}

/** localStorage guarded for non-browser contexts (tests, SSR, workers). */
export function safeLocalStorage(): KvStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}
