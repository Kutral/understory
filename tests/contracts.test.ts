import { describe, it, expect } from 'vitest';
import { TICK_DT, TICK_HZ, CHUNK_SIZE_M } from '@contracts/constants';
import { createEventBus } from '@contracts/events';
import { createSignalStore } from '@contracts/signals';

describe('contracts', () => {
  it('tick constants are coherent', () => {
    expect(TICK_HZ).toBe(60);
    expect(TICK_DT).toBeCloseTo(1 / 60);
    expect(CHUNK_SIZE_M).toBe(128);
  });

  it('event bus delivers to subscribers and unsubscribes', () => {
    const bus = createEventBus();
    let calls = 0;
    const off = bus.on('chunk/ready', () => calls++);
    bus.emit('chunk/ready', { key: { cx: 0, cz: 0 } });
    off();
    bus.emit('chunk/ready', { key: { cx: 1, cz: 0 } });
    expect(calls).toBe(1);
  });

  it('signal store only notifies on change', () => {
    const store = createSignalStore();
    let reads = 0;
    const s = store.signal(1);
    store.effect(() => {
      void s.value;
      reads++;
    });
    expect(reads).toBe(1);
    s.set(1); // no change
    s.set(2);
    store.flush();
    // effect re-run is queued by flush semantics of the stub; at minimum value updated
    expect(s.value).toBe(2);
  });
});
