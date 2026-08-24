/**
 * Signal store: ~60-line hand-rolled reactive store for UI state.
 * DOM writes happen only in a frame-boundary flush, never inside ticks.
 */

export type Signal<T> = {
  readonly value: T;
  set(next: T): void;
};

export interface SignalStore {
  signal<T>(initial: T): Signal<T>;
  /** Run `fn` whenever any read dependency of `fn` changes. Returns unsubscribe. */
  effect(fn: () => void): () => void;
  /** Batch all pending effects; called once per animation frame by core. */
  flush(): void;
}

export function createSignalStore(): SignalStore {
  let pending: Array<() => void> = [];

  function makeSignal<T>(initial: T): Signal<T> {
    let v = initial;
    const subs: Array<() => void> = [];
    return {
      get value() {
        return v;
      },
      set(next: T) {
        if (next === v) return;
        v = next;
        for (const s of subs) pending.push(s);
      },
    };
  }

  return {
    signal: makeSignal,
    effect(fn) {
      const wrapped = () => {
        pending.push(fn);
      };
      // run once immediately so initial bindings resolve
      fn();
      return () => {
        pending = pending.filter((p) => p !== wrapped);
      };
    },
    flush() {
      const q = pending;
      pending = [];
      for (const f of q) f();
    },
  };
}
