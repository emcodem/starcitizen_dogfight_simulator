import type { AngularState, ShipType } from '../types';

function scaleAngular(a: AngularState, scale: number): AngularState {
  return { pitch: a.pitch * scale, yaw: a.yaw * scale, roll: a.roll * scale };
}

function thrustFromMaxAngVel(maxAngVel: AngularState, angularDrag: AngularState): AngularState {
  return {
    pitch: maxAngVel.pitch * angularDrag.pitch,
    yaw: maxAngVel.yaw * angularDrag.yaw,
    roll: maxAngVel.roll * angularDrag.roll
  };
}

// Derives a variant of a ship type with its rotation rate scaled (e.g. 0.5 for a "half turn rate"
// drill opponent). angularThrust/boostAngularThrust are recomputed from the scaled maxAngVel so
// the steady-state-equals-maxAngVel tuning invariant (see shipTypes.ts, enforced for SHIP_TYPES by
// tests/shipTuning.test.ts) still holds for the derived type.
export function deriveShipType(base: ShipType, opts: { angularScale: number; name?: string }): ShipType {
  const maxAngVel = scaleAngular(base.maxAngVel, opts.angularScale);
  const boostMaxAngVel = scaleAngular(base.boostMaxAngVel, opts.angularScale);
  return {
    ...base,
    name: opts.name ?? base.name,
    maxAngVel,
    boostMaxAngVel,
    angularThrust: thrustFromMaxAngVel(maxAngVel, base.angularDrag),
    boostAngularThrust: thrustFromMaxAngVel(boostMaxAngVel, base.angularDrag)
  };
}
