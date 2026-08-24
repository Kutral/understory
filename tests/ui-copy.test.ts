/**
 * Copy-rule compliance: every user-facing string in the shell must follow
 * docs/ART-DIRECTION — plain verbs, sentence case, no exclamation marks,
 * no achievement language, "Graphics quality" not "Fidelity Preset",
 * "Drive" not "Start Game".
 */
import { describe, expect, it } from 'vitest';
import { ACTION_LABELS, AUDIO_CHANNELS, COPY, DEFAULT_BINDINGS, QUALITY_TIERS } from '@/ui/state';

const ALL_STRINGS: string[] = [
  ...Object.values(COPY),
  ...QUALITY_TIERS.map((t) => t.label),
  ...AUDIO_CHANNELS.map((a) => a.label),
  ...ACTION_LABELS.map((a) => a.label),
];

const BANNED_PATTERNS: Array<[RegExp, string]> = [
  [/!/, 'exclamation marks'],
  [/\bStart Game\b/i, '"Start Game" (use "Drive")'],
  [/\bFidelity\b/i, '"Fidelity" anything (use "Graphics quality")'],
  [/\bachievement\b/i, 'achievement language'],
  [/\bcongratulations\b/i, 'achievement language'],
  [/\bunlock(ed|able)?\b/i, 'achievement language'],
  [/\bpress start\b/i, '"Press Start" chrome'],
];

describe('UI copy rules', () => {
  it('contains the mandated strings verbatim', () => {
    expect(COPY.openingLine).toBe('Drive as long as you like.');
    expect(COPY.graphicsQuality).toBe('Graphics quality');
    expect(COPY.drive).toBe('Drive');
  });

  it('never uses banned patterns', () => {
    for (const s of ALL_STRINGS) {
      for (const [pattern, why] of BANNED_PATTERNS) {
        expect(s, `"${s}" must not use ${why}`).not.toMatch(pattern);
      }
    }
  });

  it('is sentence case (no ALL-CAPS words)', () => {
    for (const s of ALL_STRINGS) {
      expect(s).not.toMatch(/\b[A-Z]{2,}\b/);
    }
  });

  it('default bindings cover exactly the KeyBinding actions', () => {
    const actions = DEFAULT_BINDINGS.map((b) => b.action).sort();
    const expected = ACTION_LABELS.map((a) => a.action).sort();
    expect(actions).toEqual(expected);
  });

  it('silence preset label is a plain noun', () => {
    expect(COPY.silencePreset).toBe('Silence');
  });
});
