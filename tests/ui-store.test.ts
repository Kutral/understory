/**
 * Signal-store → DOM flush batching.
 *
 * Contract under test: signal writes never run effects synchronously; a
 * single flush() runs each affected effect exactly once, deduplicates
 * multi-signal changes, cascades effects queued by effects, and honours
 * unsubscribe. This is what keeps UI DOM writes batched at the frame
 * boundary and inside the <1ms/frame budget.
 */
import { describe, expect, it } from 'vitest';
import { createUiSignalStore } from '@/ui/store';

describe('createUiSignalStore', () => {
  it('runs the effect once immediately so initial bindings resolve', () => {
    const store = createUiSignalStore();
    const s = store.signal(7);
    let runs = 0;
    store.effect(() => {
      void s.value;
      runs++;
    });
    expect(runs).toBe(1);
  });

  it('does not re-run on set — only on flush (frame-boundary batching)', () => {
    const store = createUiSignalStore();
    const s = store.signal(0);
    let runs = 0;
    store.effect(() => {
      void s.value;
      runs++;
    });
    s.set(1);
    s.set(2);
    s.set(3);
    expect(runs).toBe(1); // nothing yet: writes are queued, not executed
    store.flush();
    expect(runs).toBe(2); // one flush, one re-run despite three sets
  });

  it('deduplicates an effect depending on several changed signals', () => {
    const store = createUiSignalStore();
    const a = store.signal(1);
    const b = store.signal(10);
    let runs = 0;
    store.effect(() => {
      void a.value;
      void b.value;
      runs++;
    });
    a.set(2);
    b.set(20);
    a.set(3);
    store.flush();
    expect(runs).toBe(2);
  });

  it('propagates through a chain within one flush', () => {
    const store = createUiSignalStore();
    const source = store.signal(1);
    // derived pattern used by the shell: effect reads one signal, writes another
    const derived = store.signal(0);
    store.effect(() => derived.set(source.value * 2));
    let observed = -1;
    store.effect(() => {
      void derived.value;
      observed = derived.value;
    });
    source.set(5);
    store.flush();
    expect(derived.value).toBe(10);
    expect(observed).toBe(10);
  });

  it('equal-value set is a no-op (no dirtying, no DOM write)', () => {
    const store = createUiSignalStore();
    const s = store.signal('visible');
    let runs = 0;
    store.effect(() => {
      void s.value;
      runs++;
    });
    s.set('visible');
    store.flush();
    expect(runs).toBe(1);
  });

  it('re-tracks dynamic dependencies between runs', () => {
    const store = createUiSignalStore();
    const flag = store.signal(true);
    const a = store.signal('a');
    const b = store.signal('b');
    let seen = '';
    store.effect(() => {
      seen = flag.value ? a.value : b.value;
    });
    b.set('B');
    store.flush();
    expect(seen).toBe('a'); // b is not a dependency this pass
    flag.set(false);
    a.set('unused-a');
    store.flush();
    expect(seen).toBe('B'); // picked up b when the branch switched
  });

  it('unsubscribe stops propagation', () => {
    const store = createUiSignalStore();
    const s = store.signal(0);
    let runs = 0;
    const stop = store.effect(() => {
      void s.value;
      runs++;
    });
    stop();
    s.set(9);
    store.flush();
    expect(runs).toBe(1);
  });

  it('flush with nothing pending is free', () => {
    const store = createUiSignalStore();
    expect(() => store.flush()).not.toThrow();
  });

  it('guards against dependency cycles instead of hanging', () => {
    const store = createUiSignalStore();
    const a = store.signal(0);
    const b = store.signal(0);
    store.effect(() => b.set(a.value + 1));
    store.effect(() => a.set(b.value + 1)); // pathological ping-pong
    expect(() => store.flush()).not.toThrow();
  });
});
