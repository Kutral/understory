import { describe, expect, it } from 'vitest';
import { buildSpeciesGeometry, SPECIES_SHAPES } from '../src/flora/species-geometry';
import { pickSpecies, SPECIES_BIRCH, SPECIES_OAK, SPECIES_SNAG } from '../src/flora/placement';
import type { PineLod } from '../src/flora/geometry';

/** Combined per-LOD tri budget per tree (from PERF-BUDGET.md flora section). */
const TRI_BUDGET: Record<PineLod, number> = { full: 900, mid: 200, far: 60 };

const SPECIES = ['birch', 'oak', 'snag'] as const;

describe('species geometry', () => {
  for (const species of SPECIES) {
    for (const lod of ['full', 'mid', 'far'] as const) {
      it(`${species} ${lod} stays within the per-tree tri budget`, () => {
        const { geometry, triangles } = buildSpeciesGeometry(species, lod);
        expect(triangles).toBeLessThanOrEqual(TRI_BUDGET[lod]);
        expect(triangles).toBeGreaterThan(0);
        // Wind + part attributes present for the shared TSL pipeline.
        expect(geometry.getAttribute('aFlex')).toBeDefined();
        expect(geometry.getAttribute('aPart')).toBeDefined();
        geometry.dispose();
      });
    }
  }

  it('full LOD is denser than far LOD for every species', () => {
    for (const species of SPECIES) {
      const full = buildSpeciesGeometry(species, 'full').triangles;
      const mid = buildSpeciesGeometry(species, 'mid').triangles;
      const far = buildSpeciesGeometry(species, 'far').triangles;
      expect(full).toBeGreaterThan(mid);
      expect(mid).toBeGreaterThan(far);
    }
  });

  it('snag has bark-only vertices (no foliage part=1)', () => {
    const { geometry } = buildSpeciesGeometry('snag', 'full');
    const part = geometry.getAttribute('aPart');
    for (let i = 0; i < part.count; i++) {
      if ((part.getX(i) ?? 0) === 1) throw new Error('snag must be all bark');
    }
  });

  it('birch is slimmer than oak at the same LOD', () => {
    const birch = buildSpeciesGeometry('birch', 'mid').triangles;
    const oak = buildSpeciesGeometry('oak', 'mid').triangles;
    expect(birch).toBeLessThan(oak); // oak's broad canopy costs more
    expect(SPECIES_SHAPES.birch.spreadM).toBeLessThan(SPECIES_SHAPES.oak.spreadM);
  });
});

describe('pickSpecies rules', () => {
  it('wet gentle sites can become birch', () => {
    let birchSeen = false;
    for (let roll = 0; roll < 1; roll += 0.001) {
      if (pickSpecies(0.8, 0.2, 0.5, roll) === SPECIES_BIRCH) birchSeen = true;
    }
    expect(birchSeen).toBe(true);
  });

  it('clearings on easy slopes can become oak', () => {
    let oakSeen = false;
    for (let roll = 0; roll < 1; roll += 0.001) {
      if (pickSpecies(0.45, 0.3, 0.2, roll) === SPECIES_OAK) oakSeen = true;
    }
    expect(oakSeen).toBe(true);
  });

  it('dry sites grow snags at low rolls', () => {
    expect(pickSpecies(0.19, 0.5, 0.5, 0.0)).toBe(SPECIES_SNAG);
    expect(pickSpecies(0.95, 0.1, 0.9, 0.99)).not.toBe(SPECIES_SNAG);
  });

  it('steep ground never becomes anything but pine or snag', () => {
    for (let roll = 0; roll < 1; roll += 0.01) {
      const s = pickSpecies(0.7, 0.9, 0.6, roll);
      expect(s === 0 || s === SPECIES_SNAG).toBe(true);
    }
  });

  it('deterministic: pure function of its arguments', () => {
    expect(pickSpecies(0.7, 0.3, 0.4, 0.5)).toBe(pickSpecies(0.7, 0.3, 0.4, 0.5));
  });
});
