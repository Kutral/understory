import { describe, expect, it } from 'vitest';
import { QualityManager, AUTO_WINDOW_MS } from '@/core/quality';
import { MAX_DPR_SCALE, MIN_DPR_SCALE, resolveTierSettings } from '@/core/quality-tiers';
import { createCoreEventBus } from '@/core/event-bus';

/** Drive `qm` with a synthetic frame-time pattern; one update() per 600ms. */
function drive(qm: QualityManager, frameMs: number, frames: number): void {
  let now = 0;
  for (let i = 0; i < frames; i++) {
    qm.observeFrame(frameMs);
    if ((i + 1) % 20 === 0) {
      now += 600;
      qm.update(now, () => {});
    }
  }
}

describe('quality tier settings', () => {
  it('maps each fixed tier to its feature set', () => {
    const low = resolveTierSettings('low');
    expect(low.dprScale).toBe(MIN_DPR_SCALE);
    expect(low.bloom).toBe(false);
    expect(low.godRays).toBe(false);

    const ultra = resolveTierSettings('ultra');
    expect(ultra.bloom).toBe(true);
    expect(ultra.dof).toBe(true);
    expect(ultra.grain).toBe(true);
    expect(ultra.godRays).toBe(true);

    for (const tier of ['low', 'medium', 'high', 'ultra'] as const) {
      expect(resolveTierSettings(tier).tier).toBe(tier);
    }
  });

  it('auto seeds at high features with dprScale 1.0', () => {
    const auto = resolveTierSettings('auto');
    expect(auto.tier).toBe('auto');
    expect(auto.dprScale).toBe(1.0);
    expect(auto.bloom).toBe(true);
  });
});

describe('QualityManager', () => {
  it('emits quality/tierChanged once per actual change', () => {
    const bus = createCoreEventBus();
    const tiers: string[] = [];
    bus.on('quality/tierChanged', ({ to }) => tiers.push(to));
    const qm = new QualityManager(bus);
    qm.setTier('high');
    qm.setTier('high'); // no-op
    qm.setTier('auto');
    expect(tiers).toEqual(['high', 'auto']);
    expect(qm.settings.tier).toBe('auto');
  });

  it('ignores frame samples while not in auto mode', () => {
    const qm = new QualityManager();
    drive(qm, 40, 400); // would crush DPR if auto were active
    expect(qm.tier).toBe('medium');
    expect(qm.settings.dprScale).toBe(0.85);
    expect(qm.windowAverage()).toBe(0);
  });

  it('auto mode lowers DPR toward the floor under sustained overload', () => {
    const qm = new QualityManager();
    qm.setTier('auto');
    drive(qm, AUTO_WINDOW_MS * 2.5, 2000);
    expect(qm.settings.dprScale).toBe(MIN_DPR_SCALE);
  });

  it('auto mode raises DPR to the ceiling with sustained headroom', () => {
    const qm = new QualityManager();
    qm.setTier('auto');
    drive(qm, 8, 2000);
    expect(qm.settings.dprScale).toBe(MAX_DPR_SCALE);
  });

  it('stays in the comfort band without adjusting (hysteresis)', () => {
    const qm = new QualityManager();
    qm.setTier('auto');
    drive(qm, 15.0, 2000); // between 13.3 and 16.6
    expect(qm.settings.dprScale).toBe(1.0);
  });

  it('clamps the final pixel ratio at 2 on high-DPR displays', () => {
    const qm = new QualityManager();
    qm.setTier('ultra');
    qm.configure('webgpu', 3); // 3× display
    // ultra dprScale 1.25 × 3 would be 3.75 — must clamp.
    let applied = 0;
    qm.apply((pr) => {
      applied = pr;
    });
    expect(applied).toBe(2);
  });

  it('applies baseDpr × dprScale on ordinary displays', () => {
    const qm = new QualityManager();
    qm.setTier('ultra');
    qm.configure('webgpu', 1);
    let applied = 0;
    qm.apply((pr) => {
      applied = pr;
    });
    expect(applied).toBeCloseTo(1.25, 5);
  });

  it('warmup: no adjustment before the rolling window fills', () => {
    const qm = new QualityManager();
    qm.setTier('auto');
    for (let i = 0; i < 39; i++) qm.observeFrame(40); // one short of a full window
    qm.update(10_000, () => {});
    expect(qm.settings.dprScale).toBe(1.0);
  });
});
