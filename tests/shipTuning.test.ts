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
        const steadyState = ship.angularThrust[axis] / ship.angularDrag[axis];
        expect(steadyState).toBeCloseTo(ship.maxAngVel[axis], 2);
      });

      it(`${ship.name} ${axis}: boostAngularThrust / angularDrag reaches boostMaxAngVel`, () => {
        const steadyState = ship.boostAngularThrust[axis] / ship.angularDrag[axis];
        expect(steadyState).toBeCloseTo(ship.boostMaxAngVel[axis], 2);
      });

      it(`${ship.name} ${axis}: boostMaxAngVel is faster than the non-boosted rate`, () => {
        expect(ship.boostMaxAngVel[axis]).toBeGreaterThan(ship.maxAngVel[axis]);
      });
    }
  }
});

// Same tuning invariant as above, for linear thrust: boostLinearThrust must be high enough that
// the ship actually accelerates (against boostLinearDrag) up to the documented boosted top speed,
// not just that the speed cap was raised without the thrust to ever reach it. Boost uses its own
// boostLinearDrag rather than linearDrag — real-game measurement showed boosting is far less
// damped than plain thrust (not just "more thrust"), so boostLinearThrust can end up *lower* than
// plain linearThrust despite the higher top speed; there's no "stronger than non-boosted" guard
// here for that reason (see shipTypes.ts).
describe('ship boosted linear tuning', () => {
  for (const ship of SHIP_TYPES) {
    it(`${ship.name}: boostLinearThrust.main / (mass * boostLinearDrag) reaches boostSpeedForward`, () => {
      const steadyState = ship.boostLinearThrust.main / (ship.mass * ship.boostLinearDrag);
      expect(steadyState).toBeCloseTo(ship.boostSpeedForward, 2);
    });

    it(`${ship.name}: boostLinearThrust.retro / (mass * boostLinearDrag) reaches boostSpeedBack`, () => {
      const steadyState = ship.boostLinearThrust.retro / (ship.mass * ship.boostLinearDrag);
      expect(steadyState).toBeCloseTo(ship.boostSpeedBack, 2);
    });

    it(`${ship.name}: boostSpeedForward/Back are faster than the non-boosted scmSpeed/scmSpeedBack`, () => {
      expect(ship.boostSpeedForward).toBeGreaterThan(ship.scmSpeed);
      expect(ship.boostSpeedBack).toBeGreaterThan(ship.scmSpeedBack);
    });
  }
});
