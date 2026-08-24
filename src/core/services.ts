import { createEventBus, type EventBus } from '@contracts/events';
import { createSignalStore, type SignalStore } from '@contracts/signals';

export type { EventBus, SignalStore };

/** Shared singletons wired at boot. Agent A owns the final shape. */
export interface Services {
  bus: EventBus;
  signals: SignalStore;
}

export function createServices(): Services {
  return { bus: createEventBus(), signals: createSignalStore() };
}
