/**
 * Typed event bus. Events carry no DOM nodes and never allocate per frame
 * (emit sites reuse payload objects).
 */

import type { ChunkKey } from './world';
import type { WeatherState } from './sky';

export interface EventBusEvents {
  'chunk/ready': { key: ChunkKey };
  'chunk/evicted': { key: ChunkKey };
  'vehicle/recovered': Record<string, never>;
  'weather/changed': { to: WeatherState };
  'light/changed': { to: string };
  'quality/tierChanged': { to: string };
  'ui/pause': { paused: boolean };
  'photo/captured': { seed: number };
}

export type EventBusEvent = keyof EventBusEvents;

export interface EventBus {
  on<K extends EventBusEvent>(ev: K, fn: (payload: EventBusEvents[K]) => void): () => void;
  emit<K extends EventBusEvent>(ev: K, payload: EventBusEvents[K]): void;
}

export function createEventBus(): EventBus {
  const subs = new Map<EventBusEvent, Set<(p: never) => void>>();
  return {
    on(ev, fn) {
      let set = subs.get(ev);
      if (!set) {
        set = new Set();
        subs.set(ev, set);
      }
      set.add(fn as (p: never) => void);
      return () => set!.delete(fn as (p: never) => void);
    },
    emit(ev, payload) {
      subs.get(ev)?.forEach((fn) => fn(payload as never));
    },
  };
}
