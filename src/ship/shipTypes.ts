import type { ShipType } from '../types';

// Gladius — derived from real SCM data: 226 m/s SCM speed, 68/52/200 deg/s pitch/yaw/roll.
// Retro/strafe/vertical thrust are approximated (not provided); boost speeds (520/268) not yet modeled.
//
// angularThrust is set to maxAngVel * angularDrag for each axis. angularDrag is applied every
// frame proportional to the current angular velocity (see physics/step.ts), so the ship settles
// at a steady state of angularThrust / angularDrag, NOT at maxAngVel — the clamp is a ceiling,
// not a target. Setting angularThrust this way makes full input actually converge to the
// documented real rotation rate instead of stalling out at roughly half of it.
export const SHIP_TYPES: ShipType[] = [
  {
    name: 'Gladius',
    mass: 1.5,
    linearThrust: { main: 203, retro: 142, strafe: 120, vertical: 120 },
    angularThrust: { pitch: 3.094, yaw: 2.366, roll: 9.074 },
    linearDrag: 0.6,
    angularDrag: 2.6,
    maxAngVel: { pitch: 1.19, yaw: 0.91, roll: 3.49 },
    scmSpeed: 226
  }
];
