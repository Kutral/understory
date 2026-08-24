/**
 * Sky/atmosphere contract. sky-atmosphere agent (D) implements.
 */

/** The six authored lighting states. */
export type LightState =
  | 'dawn'
  | 'morning'
  | 'goldenHour'
  | 'dusk'
  | 'blueHour'
  | 'night';

export type WeatherState = 'clear' | 'mist' | 'drizzle' | 'rain' | 'afterRain';

export interface SkySnapshot {
  /** 0..24 local solar time. */
  timeOfDay: number;
  lightState: LightState;
  weather: WeatherState;
  /** 0..1 weather transition progress during crossfade. */
  weatherBlend: number;
  sunElevationDeg: number;
  moonElevationDeg: number;
  fogDensity: number;
}

export interface SkySystem {
  readonly lightState: LightState;
  readonly weather: WeatherState;
  /** Direct set for the UI scrub control (hours 0..24). */
  setTimeOfDay(hours: number): void;
  /** "Let it drift": full day in DAY_CYCLE_REAL_SECONDS. */
  setDriftMode(on: boolean): void;
  /** Request a weather change; crossfades over WEATHER_FADE_MIN_S..MAX_S. Never snaps. */
  setWeather(w: WeatherState): void;
  fixedUpdate(dt: number): void;
  dispose(): void;
}
