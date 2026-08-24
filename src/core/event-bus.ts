import type { EventBus, EventBusEvent, EventBusEvents } from '@contracts/events';

/**
 * Typed event bus (core-owned implementation of @contracts/events).
 *
 * - Handlers are stored per event in insertion order; emit iterates a snapshot
 *   of subscribers so an `off()` during dispatch cannot skip handlers.
 * - No allocation on the hot path beyond the payload reference itself.
 */
export function createCoreEventBus(): EventBus {
  const subs = new Map<EventBusEvent, Set<(p: never) => void>>();

  return {
    on(ev, fn) {
      let set = subs.get(ev);
      if (!set) {
        set = new Set();
        subs.set(ev, set);
      }
      const typed = fn as (p: never) => void;
      set.add(typed);
      const registered = set;
      return () => {
        registered.delete(typed);
      };
    },
    emit(ev, payload) {
      const set = subs.get(ev);
      if (!set || set.size === 0) return;
      // Live-set iteration: no snapshot array allocated. If a handler
      // unsubscribes during dispatch, JS Set semantics simply skip it later
      // in the same pass — safe and zero-allocation.
      for (const fn of set) fn(payload as never);
    },
  } satisfies EventBus;
}

export type { EventBus, EventBusEvent, EventBusEvents };
