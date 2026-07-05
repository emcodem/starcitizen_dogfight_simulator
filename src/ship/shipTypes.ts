import type { ShipType } from '../types';

// Gladius — derived from real SCM data: 226 m/s SCM speed, 100 m/s reverse speed, 68/52/200 deg/s
// pitch/yaw/roll, 520/268 m/s forward/back boost speed, 82/62/240 deg/s boosted pitch/yaw/roll,
// 48,552 kg real mass. Retro/strafe/vertical thrust, and the boost meter's capacity/recharge rate
// (no real data available for those), are estimated.
//
// angularThrust/boostAngularThrust are each set to their corresponding maxAngVel * angularDrag
// (same angularDrag either way — boost doesn't change RCS dampening, just authority). angularDrag
// is applied every frame proportional to the current angular velocity (see physics/step.ts), so
// the ship settles at a steady state of angularThrust / angularDrag, NOT at maxAngVel — the clamp
// is a ceiling, not a target. Deriving angularThrust this way makes full input actually converge
// to the documented real rotation rate instead of stalling out at roughly half of it.
//
// massKg (real mass, 48,552 kg) isn't wired into the physics yet — `mass` below is a separately
// tuned gameplay value used for both linear thrust-to-accel and rotational inertia (see
// physics/step.ts). Recorded here so it's available once a real mass-to-`mass` conversion (or a
// switch to using massKg directly) is worked out.
export const SHIP_TYPES: ShipType[] = [
  {
    name: 'Gladius',
    mass: 1.5,
    massKg: 48552,
    linearThrust: { main: 203, retro: 142, strafe: 120, vertical: 120 },
    angularThrust: { pitch: 3.094, yaw: 2.366, roll: 9.074 },
    linearDrag: 0.6,
    angularDrag: 2.6,
    maxAngVel: { pitch: 1.19, yaw: 0.91, roll: 3.49 },
    scmSpeed: 226,
    scmSpeedBack: 100,
    boostSpeedForward: 520,
    boostSpeedBack: 268,
    boostCapacity: 5,
    boostRechargeRate: 0.4,
    boostMaxAngVel: { pitch: 1.431, yaw: 1.082, roll: 4.189 },
    boostAngularThrust: { pitch: 3.721, yaw: 2.813, roll: 10.891 },
    hullRadius: 10 // approx half-length of a real Gladius (~22m), used for hit detection/drawing
  }
];
