import { describe, it, expect } from 'vitest';
import { SHIP_TYPES } from '../src/ship/shipTypes';

// Regression guard for the angularThrust/angularDrag tuning bug: angularDrag is applied every
// frame proportional to the current angular velocity (see physics/step.ts), so a ship settles
// at a steady state of angularThrust / angularDrag, NOT at maxAngVel — the clamp is a ceiling,
// not a target. If angularThrust is set too low relative to angularDrag (as it originally was),
// full input never actually reaches the ship's documented real rotation rate. This test fails
// loudly if that mistake is reintroduced for any ship/axis.
describe('ship angular tuning', () => {
  const axes = ['pitch', 'yaw', 'roll'] as const;

  for (const ship of SHIP_TYPES) {
    for (const axis of axes) {
      it(`${ship.name} ${axis}: angularThrust / angularDrag reaches maxAngVel`, () => {
        const steadyState = ship.angularThrust[axis] / ship.angularDrag;
        expect(steadyState).toBeCloseTo(ship.maxAngVel[axis], 2);
      });

      it(`${ship.name} ${axis}: boostAngularThrust / angularDrag reaches boostMaxAngVel`, () => {
        const steadyState = ship.boostAngularThrust[axis] / ship.angularDrag;
        expect(steadyState).toBeCloseTo(ship.boostMaxAngVel[axis], 2);
      });

      it(`${ship.name} ${axis}: boostMaxAngVel is faster than the non-boosted rate`, () => {
        expect(ship.boostMaxAngVel[axis]).toBeGreaterThan(ship.maxAngVel[axis]);
      });
    }
  }
});
