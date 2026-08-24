import { createCoreEventBus } from './event-bus';
import { createCoreSignalStore } from './signal-store';
import type { EventBus } from '@contracts/events';
import type { SignalStore } from '@contracts/signals';

export { createCoreEventBus, createCoreSignalStore };
export type { EventBus, SignalStore };

/** Shared singletons wired at boot. Agent A owns the final shape. */
export interface Services {
  bus: EventBus;
  signals: SignalStore;
}

export function createServices(): Services {
  return { bus: createCoreEventBus(), signals: createCoreSignalStore() };
}
