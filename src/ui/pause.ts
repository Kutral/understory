/**
 * Pause / settings panel — a field permit laid over the scene.
 * Graphics quality, resolution scale, FOV, audio faders with a silence
 * preset, control remapping, accessibility toggles and seed entry.
 *
 * Full keyboard support: focus is trapped while open, Escape closes (unless
 * a key is being remapped — there Escape cancels the capture), every control
 * is a native element with a visible focus ring.
 */
import type { AudioChannel } from '@contracts/audio';
import type { KeyBinding } from '@contracts/input';
import { h } from './dom';
import {
  ACTION_LABELS,
  AUDIO_CHANNELS,
  COPY,
  QUALITY_TIERS,
  type UiSettings,
} from './state';

export interface PauseCallbacks {
  /** The "Drive" button — always means: drive. */
  onResume(): void;
  /** Escape inside the panel — close back to wherever we came from. */
  onRequestClose(): void;
  onSettingsChange(next: UiSettings): void;
  onBindingsChange(bindings: KeyBinding[]): void;
  onSeedChange(seed: number): void;
}

export interface PauseHandle {
  root: HTMLDivElement;
  open(focusTarget?: HTMLElement): void;
  close(): void;
  readonly isOpen: boolean;
  applySettings(settings: UiSettings): void;
  dispose(): void;
}

export function createPause(
  initial: UiSettings,
  initialBindings: KeyBinding[],
  cb: PauseCallbacks,
): PauseHandle {
  const veil = h('div', { class: 'us-veil', hidden: true }) as HTMLDivElement;

  const settings: UiSettings = structuredClone(initial);
  let bindings: KeyBinding[] = initialBindings.map((b) => ({ ...b }));
  let isOpen = false;
  let listening: { action: KeyBinding['action']; btn: HTMLButtonElement } | null = null;

  // --- header -------------------------------------------------------------
  const title = h('h2', { class: 'us-pause__title' }, COPY.pauseTitle);
  const hint = h('p', { class: 'us-pause__hint' }, COPY.pauseHint);

  // --- graphics -----------------------------------------------------------
  const tierSelect = h(
    'select',
    { class: 'us-select', 'aria-label': COPY.graphicsQuality },
    ...QUALITY_TIERS.map((t) => h('option', { value: t.id }, t.label)),
  );
  tierSelect.value = settings.tier;
  tierSelect.addEventListener('change', () => commit({ tier: tierSelect.value as UiSettings['tier'] }));

  const resScale = rangeInput(0.5, 2, 0.05);
  const fov = rangeInput(45, 100, 1);
  resScale.setAttribute('aria-label', COPY.resolutionScale);
  fov.setAttribute('aria-label', COPY.fieldOfView);
  const resValue = dataValue();
  const fovValue = dataValue();
  resScale.addEventListener('input', () => {
    resValue.textContent = Number(resScale.value).toFixed(2);
    commit({ resolutionScale: Number(resScale.value) });
  });
  fov.addEventListener('input', () => {
    fovValue.textContent = `${fov.value}\u00B0`;
    commit({ fovDeg: Number(fov.value) });
  });

  const graphics = h(
    'fieldset',
    { class: 'us-fieldset' },
    h('legend', {}, 'Graphics'),
    row(COPY.graphicsQuality, tierSelect),
    row(COPY.resolutionScale, resScale, resValue),
    row(COPY.fieldOfView, fov, fovValue),
  );

  // --- sound --------------------------------------------------------------
  const volumeInputs = new Map<AudioChannel, HTMLInputElement>();
  const mixerRows = AUDIO_CHANNELS.map(({ id, label }) => {
    const input = rangeInput(0, 1, 0.01);
    input.value = String(settings.volumes[id]);
    input.setAttribute('aria-label', label);
    input.addEventListener('input', () => {
      settings.preset = 'default';
      commitVolumes(id, Number(input.value));
    });
    volumeInputs.set(id, input);
    return row(label, input);
  });

  const silenceBtn = h('button', { class: 'us-btn us-btn--ghost', type: 'button' }, COPY.silencePreset);
  silenceBtn.addEventListener('click', () => {
    for (const { id } of AUDIO_CHANNELS) {
      if (id !== 'master') {
        settings.volumes[id] = 0;
        volumeInputs.get(id)!.value = '0';
      }
    }
    settings.preset = 'silence';
    commit({});
  });

  const sound = h(
    'fieldset',
    { class: 'us-fieldset us-mixer' },
    h('legend', {}, COPY.sound),
    ...mixerRows,
    h('div', { class: 'us-row' }, h('span', { class: 'us-row__label' }, 'Preset'), silenceBtn),
  );

  // --- controls -----------------------------------------------------------
  const keyButtons = new Map<KeyBinding['action'], HTMLButtonElement>();
  const controlRows = ACTION_LABELS.map(({ action, label }) => {
    const btn = h('button', { class: 'us-key', type: 'button' }, prettyKey(codeFor(action)));
    btn.setAttribute('aria-label', `${label} key`);
    btn.addEventListener('click', () => startListening(action, btn));
    keyButtons.set(action, btn);
    return row(label, btn);
  });

  const controls = h(
    'fieldset',
    { class: 'us-fieldset' },
    h('legend', {}, COPY.controls),
    ...controlRows,
  );

  // --- accessibility + world ----------------------------------------------
  const reducedMotion = checkboxInput(COPY.reducedMotion, settings.reducedMotion, (v) =>
    commit({ reducedMotion: v }),
  );
  const horizonLock = checkboxInput(COPY.horizonLock, settings.horizonLock, (v) =>
    commit({ horizonLock: v }),
  );

  const access = h(
    'fieldset',
    { class: 'us-fieldset' },
    h('legend', {}, COPY.accessibility),
    h('div', { class: 'us-row' }, reducedMotion.wrap),
    h('div', { class: 'us-row' }, horizonLock.wrap),
  );

  const seedLabel = h('label', { for: 'us-seed' }, COPY.seedLabel);
  const seedInput = h('input', {
    class: 'us-input',
    id: 'us-seed',
    type: 'number',
    min: '0',
    max: '999999',
    step: '1',
  }) as HTMLInputElement;
  const seedError = h('span', { class: 'us-hint-text', role: 'alert', hidden: true });
  seedError.style.display = 'none';
  const applySeed = h('button', { class: 'us-btn us-btn--ghost', type: 'button' }, COPY.applySeed);
  applySeed.addEventListener('click', () => {
    const n = Number(seedInput.value);
    if (!Number.isInteger(n) || n < 0 || n > 999_999) {
      seedError.textContent = COPY.seedInvalid;
      seedError.hidden = false;
      seedError.style.display = '';
      seedInput.setAttribute('aria-invalid', 'true');
      return;
    }
    seedError.hidden = true;
    seedError.style.display = 'none';
    seedInput.removeAttribute('aria-invalid');
    cb.onSeedChange(n);
  });

  const world = h(
    'fieldset',
    { class: 'us-fieldset' },
    h('legend', {}, COPY.world),
    h('div', { class: 'us-row' }, seedLabel, h('div', { class: 'us-pause__seed' }, seedInput, applySeed), seedError),
  );

  // --- footer ---------------------------------------------------------------
  const driveBtn = h('button', { class: 'us-btn us-btn--primary', type: 'button' }, COPY.drive);
  driveBtn.addEventListener('click', () => cb.onResume());

  title.id = 'us-pause-title';

  const panel = h(
    'section',
    {
      class: 'us-pause',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'us-pause-title',
    },
    h('header', { class: 'us-pause__header' }, title, hint),
    graphics,
    sound,
    controls,
    access,
    world,
    h('footer', { class: 'us-pause__footer' }, driveBtn),
  );
  veil.append(panel);

  // --- behaviour -------------------------------------------------------------

  function startListening(action: KeyBinding['action'], btn: HTMLButtonElement): void {
    cancelListening();
    listening = { action, btn };
    btn.dataset.listening = 'true';
    btn.textContent = COPY.pressAKey;
  }

  function cancelListening(): void {
    if (!listening) return;
    listening.btn.dataset.listening = 'false';
    listening.btn.textContent = prettyKey(codeFor(listening.action));
    listening = null;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!isOpen) return;
    if (listening) {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') rebind(listening.action, e.code);
      cancelListening();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the shell's global Escape must not re-open us
      close();
      cb.onRequestClose();
      return;
    }
    if (e.code === 'Tab') trapFocus(e);
  }

  function trapFocus(e: KeyboardEvent): void {
    const focusables = panel.querySelectorAll<HTMLElement>(
      'button, select, input, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || !panel.contains(activeEl))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function rebind(action: KeyBinding['action'], code: string): void {
    // one binding per action AND per key: drop both collisions
    bindings = bindings
      .filter((b) => b.action !== action && b.code !== code)
      .concat([{ action, code }])
      .sort(
        (a, b) =>
          ACTION_LABELS.findIndex((l) => l.action === a.action) -
          ACTION_LABELS.findIndex((l) => l.action === b.action),
      );
    refreshKeyButtons();
    cb.onBindingsChange(bindings);
  }

  function refreshKeyButtons(): void {
    for (const { action } of ACTION_LABELS) {
      const btn = keyButtons.get(action)!;
      const code = codeFor(action);
      btn.textContent = prettyKey(code);
      btn.disabled = code === '';
      btn.dataset.listening = 'false';
    }
  }

  function codeFor(action: KeyBinding['action']): string {
    return bindings.find((b) => b.action === action)?.code ?? '';
  }

  function commit(partial: Partial<UiSettings>): void {
    Object.assign(settings, partial);
    cb.onSettingsChange(structuredClone(settings));
  }

  function commitVolumes(changed: AudioChannel, v: number): void {
    settings.volumes = { ...settings.volumes, [changed]: v };
    cb.onSettingsChange(structuredClone(settings));
  }

  function open(focusTarget?: HTMLElement): void {
    if (isOpen) return;
    isOpen = true;
    veil.hidden = false;
    window.addEventListener('keydown', onKeyDown, true); // capture: win the race with game input
    // start at the top of the form so the panel doesn't scroll to the footer
    (focusTarget ?? tierSelect).focus();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    cancelListening();
    veil.hidden = true;
    window.removeEventListener('keydown', onKeyDown, true);
  }

  function applySettings(next: UiSettings): void {
    Object.assign(settings, structuredClone(next));
    tierSelect.value = settings.tier;
    resScale.value = String(settings.resolutionScale);
    resValue.textContent = Number(settings.resolutionScale).toFixed(2);
    fov.value = String(settings.fovDeg);
    fovValue.textContent = `${settings.fovDeg}\u00B0`;
    for (const { id } of AUDIO_CHANNELS) volumeInputs.get(id)!.value = String(settings.volumes[id]);
    reducedMotion.input.checked = settings.reducedMotion;
    horizonLock.input.checked = settings.horizonLock;
  }

  function dispose(): void {
    close();
    veil.remove();
  }

  // init rendered values
  applySettings(settings);

  return { root: veil, open, close, get isOpen() { return isOpen; }, applySettings, dispose };
}

// --- small builders ----------------------------------------------------------

function rangeInput(min: number, max: number, step: number): HTMLInputElement {
  return h('input', {
    class: 'us-range',
    type: 'range',
    min: String(min),
    max: String(max),
    step: String(step),
  }) as HTMLInputElement;
}

function dataValue(): HTMLSpanElement {
  return h('span', { class: 'us-value' }) as HTMLSpanElement;
}

function row(label: string, ...control: Array<Node>): HTMLDivElement {
  const children: Array<Node> = [];
  if (label) children.push(h('label', {}, label));
  else children.push(h('span', {}));
  children.push(h('div', { class: 'us-row__control' }, ...control));
  return h('div', { class: 'us-row' }, ...children);
}

function checkboxInput(label: string, checked: boolean, onChange: (v: boolean) => void): {
  wrap: HTMLLabelElement;
  input: HTMLInputElement;
} {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const wrap = h('label', { class: 'us-check' }, input, document.createTextNode(label));
  return { wrap, input };
}

/** "KeyW" → "W", "Space" → "Space", "ArrowUp" → "↑"-free plain words only. */
function prettyKey(code: string): string {
  if (code === '') return '\u2014';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
