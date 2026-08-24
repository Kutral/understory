import type { Signal, SignalStore } from '@contracts/signals';

/**
 * Reactive signal store (core-owned implementation of @contracts/signals).
 *
 * Semantics:
 * - `signal.value` reads are tracked: an effect currently executing captures
 *   every signal it reads as a dependency (dynamic — conditional reads only
 *   subscribe while that branch runs).
 * - `set()` is identity-checked (`Object.is`); no-op sets never queue effects.
 * - Changed signals queue their subscriber effects into a pending set
 *   (deduplicated). `flush()` drains the queue once; effects re-run with
 *   tracking active so they re-resolve dependencies each run. A `set()` made
 *   inside an effect during flush queues the observer for the NEXT flush —
 *   no synchronous cascades inside a tick.
 * - The stub this replaces had no dependency tracking at all; UI bindings now
 *   rerun only when something they actually read changed.
 */
interface TrackedEffect {
  fn: () => void;
  /** The raw subscription sets this effect joined on its last run. */
  deps: Set<Set<() => void>>;
}

export function createCoreSignalStore(): SignalStore {
  const pending = new Set<() => void>();
  let active: TrackedEffect | null = null;

  function makeSignal<T>(initial: T): Signal<T> {
    let value = initial;
    const subs = new Set<() => void>();

    const signal: Signal<T> = {
      get value() {
        if (active !== null) {
          active.deps.add(subs);
          subs.add(active.fn);
        }
        return value;
      },
      set(next: T) {
        if (Object.is(next, value)) return;
        value = next;
        for (const fn of subs) pending.add(fn);
      },
    };
    return signal;
  }

  function runTracked(effect: TrackedEffect, fn: () => void): void {
    const prev = active;
    active = effect;
    try {
      fn();
    } finally {
      active = prev;
    }
  }

  return {
    signal: makeSignal,

    effect(fn) {
      // effect.fn is the wrapper itself: it is what signals subscribe to and
      // what pending/flush invoke, so dep cleanup and unsubscribe stay exact.
      const effect: TrackedEffect = { fn: () => {}, deps: new Set() };
      const wrapped = (): void => {
        // Re-resolve deps from scratch: last run's subscriptions are dropped,
        // then tracking re-subscribes to whatever this run actually reads.
        for (const dep of effect.deps) dep.delete(wrapped);
        effect.deps.clear();
        runTracked(effect, fn);
      };
      effect.fn = wrapped;
      wrapped(); // immediate first run so initial bindings resolve
      return () => {
        for (const dep of effect.deps) dep.delete(wrapped);
        effect.deps.clear();
        pending.delete(wrapped);
      };
    },

    flush() {
      if (pending.size === 0) return;
      // Drain the current queue; effects queued *during* this drain wait for
      // the next flush (frame boundary), preventing unbounded cascades.
      const batch = Array.from(pending);
      pending.clear();
      for (const fn of batch) fn();
    },
  } satisfies SignalStore;
}
