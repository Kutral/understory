import { TICK_DT } from '@contracts/constants';
import type { EventBus } from '@contracts/events';

/**
 * Fixed-timestep loop with accumulator. render-core agent (A) will own the
 * full version including interpolation and adaptive DPR; stub steps a no-op world.
 */
export class GameLoop {
  private acc = 0;
  private last = 0;
  running = false;

  constructor(
    private readonly tick: () => void,
    private readonly renderFrame: (alpha: number) => void,
    private readonly bus?: EventBus,
  ) {}

  start(): void {
    this.running = true;
    this.last = performance.now();
  }

  stop(): void {
    this.running = false;
  }

  frame(now: number): void {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TICK_DT && n < 5) {
      this.tick();
      this.acc -= TICK_DT;
      n++;
    }
    if (n === 5) this.acc = 0; // spiral-of-death guard
    this.renderFrame(this.acc / TICK_DT);
  }
}
