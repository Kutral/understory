import { describe, expect, it } from 'vitest';
import {
  classifyWorstFrame,
  evaluateGate,
  findFirstInteractive,
  heapDriftPct,
  nearestSample,
  percentile,
  summarizeFrames,
  type OverlaySample,
} from '../e2e/perf-stats';

describe('percentile', () => {
  it('returns the only value for n=1', () => {
    expect(percentile([7], 99)).toBe(7);
  });

  it('is exact at p=0/50/100 for sorted input', () => {
    const v = [1, 2, 3, 4];
    expect(percentile(v, 0)).toBe(1);
    expect(percentile(v, 50)).toBe(2.5);
    expect(percentile(v, 100)).toBe(4);
  });

  it('interpolates linearly and does not mutate its argument', () => {
    const v = [10, 20, 30, 40, 50];
    expect(percentile(v, 95)).toBeCloseTo(48);
    const sortedSnapshot = [...v].sort((a, b) => a - b);
    percentile(v, 42);
    expect([...v].sort((a, b) => a - b)).toEqual(sortedSnapshot);
  });
});

describe('summarizeFrames', () => {
  it('NaN across the board when no frames', () => {
    const s = summarizeFrames([]);
    expect(s.n).toBe(0);
    expect(Number.isNaN(s.p99Ms)).toBe(true);
  });

  it('computes p50/p99/worst/mean', () => {
    const deltas = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100 ms
    const s = summarizeFrames(deltas);
    expect(s.n).toBe(100);
    expect(s.p50Ms).toBeCloseTo(50.5);
    expect(s.p99Ms).toBeCloseTo(99.01);
    expect(s.worstMs).toBe(100);
    expect(s.meanMs).toBeCloseTo(50.5);
  });
});

describe('findFirstInteractive', () => {
  const times = (n: number, step = 16) => Array.from({ length: n }, (_, i) => i * step);

  it('finds the first settled cadence window after fromIdx', () => {
    // 40 slow frames (200ms), then steady 16ms frames.
    const t: number[] = [];
    let acc = 0;
    const d: number[] = [];
    for (let i = 0; i < 40; i++) {
      t.push(acc);
      acc += 200;
      d.push(200);
    }
    for (let i = 0; i < 60; i++) {
      t.push(acc);
      acc += 16;
      d.push(16);
    }
    const tti = findFirstInteractive(t, d, 0);
    expect(tti).toBe(t[40]);
  });

  it('returns null when cadence never stabilises', () => {
    expect(findFirstInteractive(times(60), Array(60).fill(300), 0)).toBeNull();
  });

  it('respects fromIdx', () => {
    const d = [...Array(30).fill(16), ...Array(30).fill(16)];
    const t = times(60);
    expect(findFirstInteractive(t, d, 35)).toBe(t[35]);
  });
});

describe('classifyWorstFrame', () => {
  const sample = (over: Partial<OverlaySample>): OverlaySample => ({
    t: 1000,
    drawCalls: 40,
    triangles: 900_000,
    instances: 0,
    frameMs: 16,
    simMs: 2,
    renderMs: 5,
    chunksLive: 25,
    fps: 60,
    ...over,
  });

  it('names chunk streaming when pending work or chunk-count change is visible', () => {
    const s = sample({ simMs: 12, chunksLive: 26 });
    const prev = sample({ chunksLive: 25 });
    expect(classifyWorstFrame(45, s, prev)).toContain('chunk streaming');
  });

  it('names render submit when render dominates sim', () => {
    expect(classifyWorstFrame(40, sample({ renderMs: 9, simMs: 1 }), null)).toContain(
      'render submit',
    );
  });

  it('names CPU sim when sim dominates render without streaming evidence', () => {
    expect(classifyWorstFrame(40, sample({ simMs: 6, renderMs: 2 }), null)).toContain('CPU sim');
  });

  it('degrades honestly with no nearby overlay sample', () => {
    expect(classifyWorstFrame(40, null, null)).toContain('unattributed');
  });
});

describe('nearestSample + heapDriftPct', () => {
  it('picks nearest within tolerance only', () => {
    const s = [
      { t: 900 },
      { t: 1300 },
    ];
    expect(nearestSample(s, 1000, 300)?.t).toBe(900);
    expect(nearestSample(s, 1000, 50)).toBeNull();
  });

  it('heap drift percentage sign and null handling', () => {
    expect(heapDriftPct(100, 110)).toBeCloseTo(10);
    expect(heapDriftPct(100, 90)).toBeCloseTo(-10);
    expect(heapDriftPct(0, 5)).toBeNull();
  });
});

describe('evaluateGate', () => {
  it('passes on p99<=20 and zero post-load compiles', () => {
    expect(evaluateGate({ p99Ms: 19.9, postLoadCompiles: 0, gpuValid: true }).verdict).toBe('PASS');
  });

  it('fails on either leg and notes software rasterisers', () => {
    expect(evaluateGate({ p99Ms: 25, postLoadCompiles: 0, gpuValid: true }).verdict).toBe('FAIL');
    expect(evaluateGate({ p99Ms: 10, postLoadCompiles: 3, gpuValid: true }).verdict).toBe('FAIL');
    const soft = evaluateGate({ p99Ms: 10, postLoadCompiles: 0, gpuValid: false });
    expect(soft.verdict).toBe('PASS');
    expect(soft.detail).toContain('software rasteriser');
  });

  it('reports frame-time leg NOT-MEASURABLE when cadence is null, compiles still decide', () => {
    const nm = evaluateGate({ p99Ms: null, postLoadCompiles: 0, gpuValid: false });
    expect(nm.verdict).toBe('PASS');
    expect(nm.detail).toContain('NOT-MEASURABLE');
    const nmFail = evaluateGate({ p99Ms: null, postLoadCompiles: 2, gpuValid: false });
    expect(nmFail.verdict).toBe('FAIL');
  });
});
