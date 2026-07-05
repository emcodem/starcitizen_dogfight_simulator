import type { Ship, ShipType } from '../types';
import { SPAWN } from '../world/station';
import { projectiles } from '../world/weapons';

export function makeShip(type: ShipType): Ship {
  return {
    type,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    // orientation as a quaternion — keeps pitch/yaw/roll relative to the ship's
    // CURRENT body axes, so rotation always feels consistent regardless of roll
    quat: { x: 0, y: 0, z: 0, w: 1 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, // -1..1, main/retro thrust intent
    decoupled: false,
    spaceBrakeOn: false,
    boostMeter: type.boostCapacity,
    boosting: false,
    exploding: false,
    explosionTimer: 0,
    hitFlash: 0
  };
}

export function resetShip(ship: Ship): void {
  ship.pos = { x: SPAWN.pos.x, y: SPAWN.pos.y, z: SPAWN.pos.z };
  ship.vel = { x: 0, y: 0, z: 0 };
  ship.quat = { x: SPAWN.quat.x, y: SPAWN.quat.y, z: SPAWN.quat.z, w: SPAWN.quat.w };
  ship.angVel = { pitch: 0, yaw: 0, roll: 0 };
  ship.throttle = 0;
  ship.spaceBrakeOn = false;
  ship.boostMeter = ship.type.boostCapacity;
  ship.boosting = false;
  ship.exploding = false;
  ship.explosionTimer = 0;
  ship.hitFlash = 0;
  projectiles.length = 0;
}
