import type { DebugOverlay, DebugStats } from '@contracts/core';

/**
 * ?debug=1 overlay. Owns one fixed-position DOM element and writes text at
 * most every OVERLAY_INTERVAL_MS — the per-frame update() only mutates a
 * plain stats object, so tick phases never touch the DOM.
 *
 * `instances`: three r185's renderer.info does not expose an instance count,
 * so it is fed by whoever owns instanced meshes via `setInstanceCount()`;
 * until flora/world agents wire that, it reports 0 (honest zero, not a guess).
 */
const OVERLAY_INTERVAL_MS = 250;

export interface PerformanceMemoryInfo {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export class DebugHud implements DebugOverlay {
  private el: HTMLPreElement | null = null;
  private lastWriteAt = 0;
  private latest: DebugStats | null = null;
  private qualityLine = '';
  private instancesOverride: number | null = null;

  /** Called by owners of InstancedMesh/BatchedMesh to publish live counts. */
  setInstanceCount(n: number): void {
    this.instancesOverride = n;
  }

  /** Optional extra line from QualityManager.describe(). */
  setQualityLine(line: string): void {
    this.qualityLine = line;
  }

  update(stats: DebugStats): void {
    this.latest = stats;
    const now = performance.now();
    if (this.el === null) this.el = this.mount();
    if (now - this.lastWriteAt < OVERLAY_INTERVAL_MS) return;
    this.lastWriteAt = now;
    this.render();
  }

  private mount(): HTMLPreElement {
    const el = document.createElement('pre');
    el.id = 'understory-debug';
    el.setAttribute('role', 'status');
    el.style.cssText = [
      'position:fixed',
      'top:8px',
      'left:8px',
      'z-index:9999',
      'margin:0',
      'padding:6px 10px',
      'font:11px/1.5 ui-monospace,monospace',
      'color:#dfe9e2',
      'background:rgba(10,20,14,0.78)',
      'border-radius:6px',
      'pointer-events:none',
      'white-space:pre',
      'text-shadow:0 1px 2px rgba(0,0,0,0.8)',
    ].join(';');
    document.body.appendChild(el);
    return el;
  }

  private render(): void {
    const s = this.latest;
    if (s === null || this.el === null) return;
    const heap =
      s.heapMb === null ? 'n/a' : `${s.heapMb.toFixed(1)} MB`;
    const instances = this.instancesOverride ?? s.instances;
    this.el.textContent = [
      `understory debug — ${s.backend}`,
      `fps ${s.fps.toFixed(0)} | frame ${s.frameMs.toFixed(2)} ms`,
      `sim ${s.simMs.toFixed(2)} | render ${s.renderMs.toFixed(2)} | ui ${s.uiMs.toFixed(3)} ms`,
      `draw calls ${s.drawCalls} | tris ${formatInt(s.triangles)} | instances ${formatInt(instances)}`,
      `heap ${heap} | chunks live ${s.chunksLive} | light ${s.lightState}`,
      this.qualityLine,
    ]
      .filter((line) => line !== '')
      .join('\n');
  }
}

function formatInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** True for `?debug`, `?debug=1` (and any non-empty value except "0"/"false"). */
export function debugEnabled(): boolean {
  if (typeof location === 'undefined') return false;
  const raw = new URLSearchParams(location.search).get('debug');
  if (raw === null) return false;
  return raw !== '0' && raw.toLowerCase() !== 'false';
}

/** Chromium-only JS heap snapshot; null elsewhere (contract allows null). */
export function readHeapMb(): number | null {
  const mem = (performance as { memory?: PerformanceMemoryInfo }).memory;
  if (!mem) return null;
  return mem.usedJSHeapSize / (1024 * 1024);
}
