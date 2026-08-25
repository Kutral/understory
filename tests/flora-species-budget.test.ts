import { describe, expect, it } from 'vitest';
import {
  FAR_CAP,
  FLORA_IMPOSTOR_DRAWS,
  FLORA_NATIVE_BANDS,
  FLORA_SPECIES_COUNT,
  floraDrawCeiling,
} from '../src/flora/placement';

describe('species draw budget', () => {
  it('ceiling is 3 bands × species + 1 impostor draw', () => {
    expect(FLORA_NATIVE_BANDS).toBe(3);
    expect(FLORA_SPECIES_COUNT).toBe(4);
    expect(FLORA_IMPOSTOR_DRAWS).toBe(1);
    // Full mix: 4 species × 3 native bands + 1 impostor cross = 13.
    expect(floraDrawCeiling()).toBe(13);
  });

  it('ceiling stays far under the <150 combined budget', () => {
    expect(floraDrawCeiling()).toBeLessThan(150);
  });

  it('caps stay within per-draw instance limits', () => {
    expect(FAR_CAP).toBeLessThanOrEqual(6144);
  });
});
