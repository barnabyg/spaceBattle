import type { Scenario } from '../sim/battle';
import { vec3 } from '../sim/vector';

/** Two ships 300 000 km apart, drifting past each other. */
export const OPENING_PASS: Scenario = {
  name: 'Opening pass',
  starts: [
    { position: vec3(-150_000e3, 0, 0), velocity: vec3(2_000, 1_200, 0) },
    { position: vec3(150_000e3, 20_000e3, 10_000e3), velocity: vec3(-1_500, -800, -300) },
  ],
};
