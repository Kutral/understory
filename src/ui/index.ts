/**
 * UI shell public surface.
 *
 * main.ts integration (one line, orchestrator to apply):
 *
 *   import { createUi } from './ui';
 *   const ui = createUi({ onStartDriving: ... });
 *   ui.mount(document.querySelector('#ui')!, quality);
 */
export { UnderstoryUi, createUi, type UiHooks } from './shell';
export { createUiSignalStore } from './store';
export { HudIdleTimer, performanceClock, type IdleClock } from './idle';
export { DEFAULT_SETTINGS, DEFAULT_BINDINGS, COPY, type UiSettings, type Phase } from './state';
