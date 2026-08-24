import type { VehicleController, VehicleState } from '@contracts/vehicle';
import type { InputState } from '@contracts/input';

/** vehicle-input agent (C) owns. Stub: stationary car. */
export class StubVehicle implements VehicleController {
  readonly state: VehicleState = {
    speedMs: 0,
    rpm01: 0,
    gear: 'N',
    surface: 1,
    airborneWheels: 4,
  };

  async init(): Promise<void> {}

  place(): void {}

  fixedUpdate(_dt: number, _input: InputState): void {}

  recover(): void {}

  dispose(): void {}
}
