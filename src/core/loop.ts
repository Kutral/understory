import { TICK_DT, MAX_TICKS_PER_FRAME } from '@contracts/constants';
import type { EventBus } from '@contracts/events';

/**
 * Fixed-timestep loop per src/contracts/frame.ts.
 *
 * - `renderer.setAnimationLoop((t) => loop.frame(t))` drives it (WebGPU-safe).
 * - Wall dt is accumulated (clamped at 0.25s for tab-switch spikes), then
 *   0..MAX_TICKS_PER_FRAME fixed TICK_DT ticks run, then ONE render with
 *   interpolation alpha = acc / TICK_DT ∈ [0,1).
 * - Spiral-of-death guard: if backlog still exceeds one tick after the max
 *   tick count, the remainder is dropped (acc = 0). Under sustained overload
 *   the sim slows down instead of the frame time growing without bound.
 *
 * Timing fields (simMs/renderMs/frameMs) are measured around each phase and
 * read by the debug overlay; renderMs is CPU submit time only — GPU work is
 * async on WebGPU and not captured here.
 */
export interface GameLoopOptions {
  /** Override for tests. Defaults to MAX_TICKS_PER_FRAME from constants. */
  maxTicksPerFrame?: number;
}

export class GameLoop {
  private acc = 0;
  private last = 0;
  running = false;

  /** Ticks executed by the most recent frame(). */
  ticksLastFrame = 0;
  /** True if the last frame hit the spiral-of-death guard and dropped backlog. */
  droppedBacklogLastFrame = false;
  /** Measured ms of the fixed-tick batch in the last frame. */
  simMs = 0;
  /** Measured CPU submit ms of the render callback in the last frame. */
  renderMs = 0;
  /** Measured total ms inside frame() in the last frame. */
  frameMs = 0;
  /** Exponential moving average of frame dt, seeded at 16.6ms. */
  avgFrameMs = 1000 / 60;

  private readonly maxTicks: number;
  private readonly alphaEmaWeight = 0.05;

  constructor(
    private readonly tick: () => void,
    private readonly renderFrame: (alpha: number) => void,
    private readonly bus?: EventBus,
    options?: GameLoopOptions,
  ) {
    this.maxTicks = Math.max(1, Math.floor(options?.maxTicksPerFrame ?? MAX_TICKS_PER_FRAME));
  }

  /** The bus is injected for future loop events; exposed so the DI is not dead weight. */
  get eventBus(): EventBus | undefined {
    return this.bus;
  }

  start(now: number = performance.now()): void {
    this.running = true;
    this.last = now;
  }

  stop(): void {
    this.running = false;
  }

  frame(now: number): void {
    if (!this.running) return;
    const t0 = performance.now();

    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.25) dt = 0.25;

    this.avgFrameMs += (dt * 1000 - this.avgFrameMs) * this.alphaEmaWeight;
    this.acc += dt;

    let n = 0;
    const simStart = performance.now();
    while (this.acc >= TICK_DT && n < this.maxTicks) {
      this.tick();
      this.acc -= TICK_DT;
      n++;
    }
    this.simMs = performance.now() - simStart;

    // Spiral-of-death guard: work remains after the cap → surrender the backlog.
    this.droppedBacklogLastFrame = n === this.maxTicks && this.acc >= TICK_DT;
    if (this.droppedBacklogLastFrame) this.acc = 0;

    // Interpolation fraction between the last two simulated states, clamped to [0,1).
    let alpha = this.acc / TICK_DT;
    if (!(alpha >= 0)) alpha = 0;
    if (alpha > 0.999) alpha = 0.999;

    this.ticksLastFrame = n;

    const renderStart = performance.now();
    this.renderFrame(alpha);
    this.renderMs = performance.now() - renderStart;

    this.frameMs = performance.now() - t0;
  }
}
