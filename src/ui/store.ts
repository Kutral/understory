/**
 * Working signal store for the UI shell, satisfying `SignalStore` from
 * @contracts/signals.
 *
 * The reference implementation in src/contracts/signals.ts never populates a
 * signal's subscriber set, so effects never re-run; this version adds proper
 * automatic dependency tracking:
 *
 *   - while an effect runs it is `active`; every `.value` read registers the
 *     reading effect as a subscriber of that signal (and vice versa);
 *   - `set` queues subscribers into a pending Set (deduplicated) and returns
 *     immediately — nothing runs outside a flush;
 *   - `flush()` drains the queue, re-running each effect once even if several
 *     of its dependencies changed, and keeps draining effects queued by other
 *     effects (with a cycle guard).
 *
 * DOM writes belong inside effects, so with one `flush()` per animation frame
 * all DOM writes land at the frame boundary: batched, deduped, <1ms.
 */
import type { Signal, SignalStore } from '@contracts/signals';

interface Dependency {
  subs: Set<Effect>;
}

interface Effect {
  (): void;
  deps: Set<Dependency>;
}

export function createUiSignalStore(): SignalStore {
  let active: Effect | null = null;
  const pending = new Set<Effect>();

  /** Effects may cascade through each other; cap re-entrant drain rounds. */
  const MAX_FLUSH_ROUNDS = 16;

  function makeSignal<T>(initial: T): Signal<T> {
    let v = initial;
    const dep: Dependency = { subs: new Set() };

    const signal: Signal<T> = {
      get value() {
        if (active) {
          dep.subs.add(active);
          active.deps.add(dep);
        }
        return v;
      },
      set(next: T) {
        if (next === v) return;
        v = next;
        for (const sub of dep.subs) pending.add(sub);
      },
    };
    return signal;
  }

  function makeEffect(fn: () => void): Effect {
    const effect = (() => {
      // drop stale links from the previous run so dynamic deps re-track
      for (const d of effect.deps) d.subs.delete(effect);
      effect.deps.clear();

      const prev = active;
      active = effect;
      try {
        fn();
      } finally {
        active = prev;
      }
    }) as Effect;
    effect.deps = new Set();
    return effect;
  }

  return {
    signal: makeSignal,
    effect(fn) {
      const effect = makeEffect(fn);
      effect(); // initial run so bindings resolve immediately
      return () => {
        for (const d of effect.deps) d.subs.delete(effect);
        effect.deps.clear();
        pending.delete(effect);
      };
    },
    flush() {
      let rounds = 0;
      while (pending.size > 0) {
        if (++rounds > MAX_FLUSH_ROUNDS) {
          pending.clear();
          break;
        }
        const queue = [...pending];
        pending.clear();
        for (const effect of queue) effect();
      }
    },
  };
}
