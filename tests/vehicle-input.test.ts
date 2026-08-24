import { describe, it, expect } from 'vitest';
import { applyDeadzone } from '@/vehicle/vehicle-math';
import { BindingsStore, type KvStorage } from '@/vehicle/bindings';

function mapStorage(): KvStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe('analog deadzone math', () => {
  it('is exactly zero inside the deadzone', () => {
    expect(applyDeadzone(0, 0.14)).toBe(0);
    expect(applyDeadzone(0.07, 0.14)).toBe(0);
    expect(applyDeadzone(-0.14, 0.14)).toBe(0);
    expect(applyDeadzone(0.1399, 0.14)).toBe(0);
  });

  it('is continuous and small just past the edge (no input snap)', () => {
    const justPast = applyDeadzone(0.1401, 0.14);
    expect(justPast).toBeGreaterThan(0);
    expect(justPast).toBeLessThan(0.001);
  });

  it('reaches exactly ±1 at full deflection', () => {
    expect(applyDeadzone(1, 0.14)).toBeCloseTo(1, 12);
    expect(applyDeadzone(-1, 0.14)).toBeCloseTo(-1, 12);
  });

  it('is monotonic and sign-preserving across the whole range', () => {
    let prev = -1.01;
    for (let v = -1; v <= 1; v += 0.01) {
      const out = applyDeadzone(v, 0.14);
      expect(out).toBeGreaterThanOrEqual(prev - 1e-12);
      if (out !== 0) expect(Math.sign(out)).toBe(Math.sign(v || out));
      prev = out;
    }
  });

  it('rejects degenerate deadzones gracefully', () => {
    expect(applyDeadzone(0.5, 1)).toBe(0);
    expect(applyDeadzone(0.5, -0.5)).toBe(0);
  });
});

describe('remappable bindings persisted to storage', () => {
  it('defaults cover WASD + arrows + Space + R', () => {
    const s = new BindingsStore(null);
    expect(s.codesFor('throttle').sort()).toEqual(['ArrowUp', 'KeyW']);
    expect(s.codesFor('brake').sort()).toEqual(['ArrowDown', 'KeyS']);
    expect(s.codesFor('handbrake')).toEqual(['Space']);
    expect(s.codesFor('recover')).toEqual(['KeyR']);
  });

  it('rebind replaces the action and persists to the injected store', () => {
    const store = mapStorage();
    const s = new BindingsStore(store);
    expect(s.rebind('throttle', 'KeyY')).toBe(true);
    expect(s.codesFor('throttle')).toEqual(['KeyY']);
    // Reload from the same store: binding survives.
    const s2 = new BindingsStore(store);
    expect(s2.codesFor('throttle')).toEqual(['KeyY']);
  });

  it('rejects malformed codes without corrupting state', () => {
    const s = new BindingsStore(null);
    expect(s.rebind('throttle', 'not a code!')).toBe(false);
    expect(s.codesFor('throttle').sort()).toEqual(['ArrowUp', 'KeyW']);
  });

  it('ignores corrupted persisted data and falls back to defaults', () => {
    const store = mapStorage();
    store.setItem('understory.input.bindings.v1', '{oops not json');
    const s = new BindingsStore(store);
    expect(s.codesFor('recover')).toEqual(['KeyR']);
  });

  it('reset restores defaults and clears persistence', () => {
    const store = mapStorage();
    const s = new BindingsStore(store);
    s.rebind('left', 'KeyQ');
    s.reset();
    expect(s.codesFor('left').sort()).toEqual(['ArrowLeft', 'KeyA']);
    const s2 = new BindingsStore(store);
    expect(s2.codesFor('left').sort()).toEqual(['ArrowLeft', 'KeyA']);
  });
});
