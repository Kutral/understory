/**
 * Opening state (ART-DIRECTION 6.6): no title chrome. One Vollkorn italic
 * line fades in over the scene and out; settings sit behind Escape from
 * frame one; any other key starts driving.
 */
import { COPY } from './state';
import { h } from './dom';

export interface OpeningCallbacks {
  /** Any key (except Escape/modifiers) — start driving. */
  onStart(): void;
  /** Escape — open settings. */
  onPauseRequest(): void;
}

/** Keys that must never start a drive by themselves. */
const IGNORED_CODES = new Set([
  'Escape',
  'Tab',
  'CapsLock',
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'F5',
  'F11',
  'F12',
]);

export function createOpening(cb: OpeningCallbacks): {
  root: HTMLDivElement;
  dispose: () => void;
} {
  const root = h(
    'div',
    { class: 'us-opening' },
    h('p', { class: 'us-opening__line' }, COPY.openingLine),
  );

  const onKey = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      cb.onPauseRequest();
      return;
    }
    if (IGNORED_CODES.has(e.code)) return;
    cb.onStart();
  };
  const onPointer = (): void => cb.onStart();

  window.addEventListener('keydown', onKey);
  window.addEventListener('pointerdown', onPointer);

  return {
    root,
    dispose() {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
      root.remove();
    },
  };
}
