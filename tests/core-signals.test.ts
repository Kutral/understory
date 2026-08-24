import { describe, expect, it } from 'vitest';
import { createCoreSignalStore } from '@/core/signal-store';
import { createCoreEventBus } from '@/core/event-bus';

describe('core signal store semantics', () => {
  it('runs an effect immediately so initial bindings resolve', () => {
    const store = createCoreSignalStore();
    let runs = 0;
    store.effect(() => {
      runs++;
    });
    expect(runs).toBe(1);
  });

  it('does not notify when the value does not change (Object.is)', () => {
    const store = createCoreSignalStore();
    const s = store.signal(1);
    let runs = 0;
    store.effect(() => {
      void s.value;
      runs++;
    });
    s.set(1);
    s.set(1);
    store.flush();
    expect(runs).toBe(1);
  });

  it('queues changed signals and flushes once per frame boundary', () => {
    const store = createCoreSignalStore();
    const s = store.signal('a');
    let runs = 0;
    store.effect(() => {
      void s.value;
      runs++;
    });
    s.set('b');
    s.set('c'); // two changes before flush → still one rerun (deduped)
    store.flush();
    expect(runs).toBe(2);
    store.flush(); // queue empty → no extra run
    expect(runs).toBe(2);
  });

  it('tracks dependencies: only signals actually read trigger reruns', () => {
    const store = createCoreSignalStore();
    const a = store.signal(1);
    const b = store.signal(1);
    let runs = 0;
    store.effect(() => {
      void a.value;
      runs++;
    });
    b.set(2);
    store.flush();
    expect(runs).toBe(1); // untouched by b
    a.set(3);
    store.flush();
    expect(runs).toBe(2);
  });

  it('re-resolves dynamic dependencies on every run', () => {
    const store = createCoreSignalStore();
    const flag = store.signal(true);
    const x = store.signal(0);
    const y = store.signal(0);
    let runs = 0;
    store.effect(() => {
      void (flag.value ? x.value : y.value);
      runs++;
    });
    y.set(1); // not currently a dependency
    store.flush();
    expect(runs).toBe(1);
    flag.set(false); // switches the read to y
    store.flush();
    expect(runs).toBe(2);
    x.set(9); // subscription to x was dropped by the re-run
    store.flush();
    expect(runs).toBe(2);
    y.set(2);
    store.flush();
    expect(runs).toBe(3);
  });

  it('unsubscribe detaches from all dependencies and clears pending work', () => {
    const store = createCoreSignalStore();
    const s = store.signal(0);
    let runs = 0;
    const off = store.effect(() => {
      void s.value;
      runs++;
    });
    off();
    s.set(42);
    store.flush();
    expect(runs).toBe(1);
  });

  it('a set inside an effect waits for the next flush, no sync cascade', () => {
    const store = createCoreSignalStore();
    const src = store.signal(false);
    const dst = store.signal(0);
    let written = 0;
    let dstReads = 0;
    // Writer reads only src (writing a signal you also read would retrigger
    // yourself forever — same as any push-based reactive system).
    store.effect(() => {
      if (src.value) dst.set(++written);
    });
    store.effect(() => {
      void dst.value;
      dstReads++;
    });
    src.set(true);
    store.flush(); // writer ran, queued the reader
    expect(dstReads).toBe(1);
    store.flush(); // second flush applies the chained update
    expect(dstReads).toBe(2);
    expect(written).toBe(1);
    expect(dst.value).toBe(1);
  });
});

describe('core event bus', () => {
  it('delivers typed payloads to all subscribers in order', () => {
    const bus = createCoreEventBus();
    const seen: string[] = [];
    bus.on('light/changed', ({ to }) => seen.push(`a:${to}`));
    bus.on('light/changed', ({ to }) => seen.push(`b:${to}`));
    bus.emit('light/changed', { to: 'dusk' });
    expect(seen).toEqual(['a:dusk', 'b:dusk']);
  });

  it('survives an unsubscribe during dispatch without skipping others', () => {
    const bus = createCoreEventBus();
    let second = 0;
    const offFirst = bus.on('chunk/ready', () => offFirst());
    bus.on('chunk/ready', () => second++);
    bus.emit('chunk/ready', { key: { cx: 0, cz: 0 } }); // first removes itself mid-pass
    bus.emit('chunk/ready', { key: { cx: 1, cz: 0 } });
    expect(second).toBe(2);
  });

  it('emitting to an event with no subscribers is a no-op', () => {
    const bus = createCoreEventBus();
    expect(() => bus.emit('vehicle/recovered', {})).not.toThrow();
  });
});
