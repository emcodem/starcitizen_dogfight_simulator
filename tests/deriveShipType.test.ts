import { describe, it, expect } from 'vitest';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import { deriveShipType } from '../src/ship/deriveShipType';

describe('deriveShipType', () => {
  const base = SHIP_TYPES[0];
  const half = deriveShipType(base, { angularScale: 0.5 });
  const axes = ['pitch', 'yaw', 'roll'] as const;

  for (const axis of axes) {
    it(`halves maxAngVel.${axis}`, () => {
      expect(half.maxAngVel[axis]).toBeCloseTo(base.maxAngVel[axis] * 0.5, 5);
    });

    it(`halves boostMaxAngVel.${axis}`, () => {
      expect(half.boostMaxAngVel[axis]).toBeCloseTo(base.boostMaxAngVel[axis] * 0.5, 5);
    });

    it(`${axis}: preserves the angularThrust/angularDrag == maxAngVel invariant`, () => {
      const steadyState = half.angularThrust[axis] / half.angularDrag;
      expect(steadyState).toBeCloseTo(half.maxAngVel[axis], 5);
    });

    it(`${axis}: preserves the boostAngularThrust/angularDrag == boostMaxAngVel invariant`, () => {
      const steadyState = half.boostAngularThrust[axis] / half.angularDrag;
      expect(steadyState).toBeCloseTo(half.boostMaxAngVel[axis], 5);
    });
  }

  it('leaves the base ship type untouched', () => {
    expect(base.maxAngVel.yaw).not.toBeCloseTo(half.maxAngVel.yaw, 5);
  });
});
