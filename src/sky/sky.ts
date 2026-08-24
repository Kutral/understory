import type { LightState, SkySystem, WeatherState } from '@contracts/sky';

/** sky-atmosphere agent (D) owns. Stub: fixed noon, clear. */
export class StubSky implements SkySystem {
  readonly lightState: LightState = 'morning';
  readonly weather: WeatherState = 'clear';

  setTimeOfDay(): void {}
  fixedUpdate(): void {}
  setDriftMode(): void {}
  setWeather(): void {}
  dispose(): void {}
}
