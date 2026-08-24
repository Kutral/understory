import { describe, expect, it } from 'vitest';
import { applyRemap, FocusRestore, actionLabel } from '../src/ui/remap';
import type { KeyBinding } from '@contracts/input';

const BASE: KeyBinding[] = [
  { action: 'throttle', code: 'KeyW' },
  { action: 'brake', code: 'KeyS' },
  { action: 'left', code: 'KeyA' },
  { action: 'right', code: 'KeyD' },
  { action: 'handbrake', code: 'Space' },
  { action: 'recover', code: 'KeyR' },
];

describe('applyRemap', () => {
  it('rebinds to an unused key', () => {
    const r = applyRemap(BASE, 'throttle', 'ArrowUp');
    expect(r.ok).toBe(true);
    expect(r.bindings.find((b) => b.action === 'throttle')?.code).toBe('ArrowUp');
    // original list untouched
    expect(BASE[0]?.code).toBe('KeyW');
  });

  it('swaps when the key belongs to another action, with a clear message', () => {
    const r = applyRemap(BASE, 'throttle', 'KeyS');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/Swapped with Brake/);
    expect(r.bindings.find((b) => b.action === 'throttle')?.code).toBe('KeyS');
    expect(r.bindings.find((b) => b.action === 'brake')?.code).toBe('KeyW');
    // no duplicates
    const codes = r.bindings.map((b) => b.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('rejects Escape with an explanation, bindings unchanged', () => {
    const r = applyRemap(BASE, 'throttle', 'Escape');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/reserved/);
    expect(r.bindings).toEqual(BASE);
  });

  it('same-key rebind is a no-op success', () => {
    const r = applyRemap(BASE, 'left', 'KeyA');
    expect(r.ok).toBe(true);
    expect(r.message).toBeUndefined();
  });

  it('unknown action is rejected safely', () => {
    const r = applyRemap(BASE, 'nonexistent' as KeyBinding['action'], 'KeyQ');
    expect(r.ok).toBe(false);
  });

  it('every swap leaves all six actions bound exactly once', () => {
    let current = BASE;
    for (const code of ['KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyC', 'KeyV']) {
      const r = applyRemap(current, 'handbrake', code);
      expect(r.ok).toBe(true);
      current = r.bindings;
    }
    const actions = current.map((b) => b.action).sort();
    expect(actions).toEqual(['brake', 'handbrake', 'left', 'recover', 'right', 'throttle']);
    expect(new Set(current.map((b) => b.code)).size).toBe(6);
  });
});

describe('actionLabel', () => {
  it('labels are sentence case and human', () => {
    expect(actionLabel('throttle')).toBe('Throttle');
    expect(actionLabel('left')).toBe('Steer left');
  });
});

describe('FocusRestore', () => {
  it('captures and releases the previous focus target once', () => {
    const el = { id: 'drive-btn' } as HTMLElement;
    const fr = new FocusRestore();
    fr.capture(el);
    expect(fr.hasPending).toBe(true);
    expect(fr.release()).toBe(el);
    expect(fr.hasPending).toBe(false);
    expect(fr.release()).toBeNull();
  });

  it('release without capture is null-safe', () => {
    const fr = new FocusRestore();
    expect(fr.release()).toBeNull();
  });
});
