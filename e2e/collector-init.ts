/**
 * In-page instrumentation source for the perf collector.
 *
 * This file is a STRING (injected via page.addInitScript) so it runs in the
 * page before any app code. It must be plain ES2017+ with no imports.
 *
 * Methods (documented in docs/PERF.md):
 *  - frame times: window.requestAnimationFrame is wrapped before app boot;
 *    every successive-callback delta is pushed to __understoryPerf.rafD.
 *  - heap: performance.memory sampled every 2000 ms by an in-page interval
 *    (Chromium-only, matching the debug overlay's own readHeapMb).
 *  - draw calls / tris / instances / sim+render ms: a MutationObserver on the
 *    #understory-debug overlay (?debug=1) parses each 250ms textContent write.
 *  - shader compiles: HTMLCanvasElement.prototype.getContext is wrapped and
 *    the returned webgl2 context's createProgram/linkProgram/compileShader are
 *    shadowed with counting wrappers; boot completion is detected from the
 *    '[understory] booted' console.info (console methods wrapped first).
 *    'THREE.WebGLProgram' console messages are also counted as a secondary,
 *    three-specific sniffing channel.
 */
export const COLLECTOR_INIT_SCRIPT = /* js */ `
(() => {
  const P = {
    tStart: performance.now(),
    bootMarkerAt: null,
    backendMsg: null,
    rafT: [],
    rafD: [],
    heap: [],
    overlay: [],
    gl: { programsLinked: [], shadersCompiled: 0, contextsSeen: [] },
    consoleCompileSniffs: 0,
    consoleTail: [],
  };
  window.__understoryPerf = P;

  // --- console: boot marker + backend + THREE.WebGLProgram sniffing ----------
  for (const level of ['info', 'log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      try {
        const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
        if (text.includes('[understory] booted')) P.bootMarkerAt = performance.now();
        if (text.includes('[understory] backend:')) P.backendMsg = text.trim();
        if (text.includes('THREE.WebGLProgram')) P.consoleCompileSniffs++;
        P.consoleTail.push(text);
        if (P.consoleTail.length > 40) P.consoleTail.shift();
      } catch {}
      orig(...args);
    };
  }

  // --- WebGL program/compile counting ---------------------------------------
  const origGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args) {
    const ctx = origGetContext.apply(this, args);
    try {
      if (
        ctx &&
        typeof ctx.createProgram === 'function' &&
        !ctx.__understoryCounted &&
        String(args[0]).startsWith('webgl')
      ) {
        ctx.__understoryCounted = true;
        P.gl.contextsSeen.push(String(args[0]));
        for (const name of ['createProgram', 'linkProgram', 'compileShader']) {
          const bound = ctx[name].bind(ctx);
          ctx[name] = (...a) => {
            const t = performance.now();
            if (name === 'createProgram' || name === 'compileShader') P.gl.shadersCompiled++;
            if (name === 'linkProgram') P.gl.programsLinked.push(t);
            return bound(...a);
          };
        }
      }
    } catch {}
    return ctx;
  };

  // --- frame-time capture -----------------------------------------------------
  let lastRaf = null;
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return origRaf(function (ts) {
      const now = performance.now();
      if (lastRaf !== null) {
        P.rafT.push(now);
        P.rafD.push(now - lastRaf);
      }
      lastRaf = now;
      cb(ts);
    });
  };

  // --- heap sampling every 2 s -------------------------------------------------
  setInterval(() => {
    const mem = performance.memory;
    if (mem) P.heap.push({ t: performance.now(), used: mem.usedJSHeapSize });
  }, 2000);

  // --- debug-overlay parsing ----------------------------------------------------
  const NUM = '[0-9][0-9,]*\\.?[0-9]*';
  const grab = (re, text) => {
    const m = text.match(re);
    return m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
  };
  const parseOverlay = () => {
    const el = document.getElementById('understory-debug');
    if (!el || !el.textContent) return;
    const text = el.textContent;
    P.overlay.push({
      t: performance.now(),
      fps: grab(new RegExp('fps (' + NUM + ')'), text),
      frameMs: grab(new RegExp('frame (' + NUM + ') ms'), text),
      simMs: grab(new RegExp('sim (' + NUM + ')'), text),
      renderMs: grab(new RegExp('render (' + NUM + ')'), text),
      drawCalls: grab(new RegExp('draw calls (' + NUM + ')'), text),
      triangles: grab(new RegExp('tris (' + NUM + ')'), text),
      instances: grab(new RegExp('instances (' + NUM + ')'), text),
      chunksLive: grab(new RegExp('chunks live (' + NUM + ')'), text),
    });
  };
  const hookOverlay = () => {
    const el = document.getElementById('understory-debug');
    if (!el) {
      setTimeout(hookOverlay, 250);
      return;
    }
    parseOverlay();
    new MutationObserver(parseOverlay).observe(el, { childList: false, subtree: false, characterData: true });
    // textContent assignment triggers characterData only when text node reused;
    // el.textContent = ... replaces the text node -> childList fires on <pre>.
    new MutationObserver(parseOverlay).observe(el, { childList: true });
  };
  addEventListener('DOMContentLoaded', hookOverlay);
})();
`;
