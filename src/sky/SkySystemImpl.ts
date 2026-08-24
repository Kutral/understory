/**
 * SkySystem implementation — time-of-day + weather state machine.
 *
 * Pure-logic core (no three.js imports) so the whole thing is unit-testable in
 * node. Visual attachment lives in ./visuals.ts and is composed on by
 * createSkySystem() in ./index.ts.
 */

import type { EventBus } from '@contracts/events';
import { DAY_CYCLE_REAL_SECONDS, WEATHER_FADE_MAX_S } from '@contracts/constants';
import type { LightState, SkySnapshot, SkySystem, WeatherState } from '@contracts/sky';
import {
  DRIFT_HOURS_PER_SECOND,
  START_TIME_H,
  bandFor,
  isSunRising,
  moonElevationDeg,
  sunElevationDeg,
  wrap24,
} from './time';
import { computeAtmosphere, type AtmosphereState } from './palette';
import { WeatherMachine } from './weather';

export type SkyFullState = SkySnapshot & { atmosphere: AtmosphereState };

export class SkySystemImpl implements SkySystem {
  private bus: EventBus | null;
  private weatherMachine: WeatherMachine;
  private hours = START_TIME_H;
  private drift = false;
  private lastBand: LightState;

  /** Reused snapshot object — no per-frame allocation (frame contract rule). */
  private readonly snap: SkyFullState;

  constructor(bus: EventBus | null = null, seed = 0x5eed) {
    this.bus = bus;
    this.weatherMachine = new WeatherMachine(
      seed,
      // Emit as the crossfade BEGINS so fx/audio can pre-cue rain; the fade
      // itself guarantees there is never an audible/visible snap.
      (to) => this.bus?.emit('weather/changed', { to }),
    );
    this.lastBand = this.currentBand();
    this.snap = {
      timeOfDay: this.hours,
      lightState: this.lastBand,
      weather: 'clear',
      weatherBlend: 1,
      sunElevationDeg: sunElevationDeg(this.hours),
      moonElevationDeg: moonElevationDeg(this.hours),
      fogDensity: 0,
      atmosphere: computeAtmosphere(
        sunElevationDeg(this.hours),
        moonElevationDeg(this.hours),
        this.weatherMachine.sample(),
      ),
    };
    this.refresh();
  }

  get lightState(): LightState {
    return this.lastBand;
  }

  get weather(): WeatherState {
    return this.weatherMachine.weather;
  }

  /** 0..24 local solar time. */
  get timeOfDay(): number {
    return this.hours;
  }

  get driftEnabled(): boolean {
    return this.drift;
  }

  setTimeOfDay(hours: number): void {
    this.hours = wrap24(hours);
    const band = this.currentBand();
    if (band !== this.lastBand) {
      this.lastBand = band;
      this.bus?.emit('light/changed', { to: band });
    }
    this.refresh();
  }

  setDriftMode(on: boolean): void {
    this.drift = on;
  }

  setWeather(w: WeatherState): void {
    this.weatherMachine.request(w);
    this.refresh();
  }

  fixedUpdate(dt: number): void {
    if (this.drift && dt > 0) {
      this.setTimeOfDay(this.hours + DRIFT_HOURS_PER_SECOND * dt);
    }
    this.weatherMachine.update(dt);
    this.refresh();
  }

  /**
   * Test hook: advance exactly one drift day's worth of seconds.
   * (Convenience over fixedUpdate; kept out of the SkySystem interface.)
   */
  stepSeconds(seconds: number, tickDt = 1 / 60): void {
    const steps = Math.max(1, Math.round(seconds / tickDt));
    for (let i = 0; i < steps; i++) this.fixedUpdate(tickDt);
  }

  getSnapshot(): SkySnapshot {
    const s = this.snap;
    return {
      timeOfDay: s.timeOfDay,
      lightState: s.lightState,
      weather: s.weather,
      weatherBlend: s.weatherBlend,
      sunElevationDeg: s.sunElevationDeg,
      moonElevationDeg: s.moonElevationDeg,
      fogDensity: s.fogDensity,
    };
  }

  /** Full state including atmosphere palette — visuals consume this. */
  get fullState(): Readonly<SkyFullState> {
    return this.snap;
  }

  /** Debug/test-only: settle instantly into a weather state (no fade). */
  debugSettleWeather(w: WeatherState): void {
    this.weatherMachine.request(w);
    this.weatherMachine.update(WEATHER_FADE_MAX_S + 1);
    this.refresh();
  }

  dispose(): void {
    this.bus = null;
  }

  // ------------------------------------------------------------------

  private currentBand(): LightState {
    return bandFor(sunElevationDeg(this.hours), isSunRising(this.hours));
  }

  private refresh(): void {
    const w = this.weatherMachine.sample();
    const elev = sunElevationDeg(this.hours);
    const moonElev = moonElevationDeg(this.hours);
    const atmo = computeAtmosphere(elev, moonElev, w);
    const s = this.snap;
    s.timeOfDay = this.hours;
    s.lightState = this.lastBand;
    s.weather = this.weatherMachine.weather;
    s.weatherBlend = this.weatherMachine.blend;
    s.sunElevationDeg = elev;
    s.moonElevationDeg = moonElev;
    s.fogDensity = atmo.fogDensity;
    s.atmosphere = atmo;
  }
}

/** Contract constant re-export for tests/harness convenience. */
export const DAY_LENGTH_S = DAY_CYCLE_REAL_SECONDS;
