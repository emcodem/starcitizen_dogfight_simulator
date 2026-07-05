import { describe, it, expect } from 'vitest';
import { orbiterThink, spawnDriftState, driftThink } from '../src/combat/enemyAI';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import type { EnemyShip, Ship } from '../src/types';

function makeTestShip(pos: { x: number; y: number; z: number }): Ship {
  return {
    type: SHIP_TYPES[0],
    pos,
    vel: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0,
    decoupled: false,
    spaceBrakeOn: false,
    boostMeter: 0,
    boosting: false,
    exploding: false,
    explosionTimer: 0,
    hitFlash: 0
  };
}

function makeOrbiter(radius: number): EnemyShip {
  return {
    type: SHIP_TYPES[0],
    pos: { x: 0, y: 0, z: 0 },
    quat: { x: 0, y: 0, z: 0, w: 1 },
    vel: { x: 0, y: 0, z: 0 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: 0,
    boosting: false,
    health: createHealth(3),
    behavior: 'orbiter',
    fireCooldown: 0,
    orbit: {
      radius,
      angularSpeed: 0.2,
      phase: 0,
      planeRight: { x: 1, y: 0, z: 0 },
      planeUp: { x: 0, y: 0, z: 1 },
      respawnTimer: 0
    }
  };
}

describe('orbiterThink', () => {
  it('keeps the drone at a constant radius from the (possibly moving) player, tracking its center', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeOrbiter(200);

    for (let i = 0; i < 30; i++) {
      orbiterThink(enemy, player, 1 / 60);
      const dist = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z);
      expect(dist).toBeCloseTo(200, 3);
    }

    // player moves — the orbit should re-center on the new position, not the old one
    player.pos = { x: 500, y: 0, z: 0 };
    orbiterThink(enemy, player, 1 / 60);
    const dist = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z);
    expect(dist).toBeCloseTo(200, 3);
  });

  it('gives the drone a nonzero tangential velocity, not a stationary hover', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeOrbiter(200);
    orbiterThink(enemy, player, 1 / 60);
    const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
    expect(speed).toBeGreaterThan(0);
  });
});

describe('drifter spawn + think', () => {
  it('spawns outside the player and flies in a straight line at constant velocity', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const spawn = spawnDriftState(player);
    const enemy: EnemyShip = {
      type: SHIP_TYPES[0],
      pos: spawn.pos,
      quat: { x: 0, y: 0, z: 0, w: 1 },
      vel: spawn.vel,
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      boostMeter: 0,
      boosting: false,
      health: createHealth(3),
      behavior: 'drifter',
      fireCooldown: 0,
      drift: { respawnTimer: 0 }
    };

    const velBefore = { ...enemy.vel };
    driftThink(enemy, player, 1 / 60);
    driftThink(enemy, player, 1 / 60);
    expect(enemy.vel).toEqual(velBefore); // ballistic — velocity never changes

    const expectedPos = {
      x: spawn.pos.x + velBefore.x * (2 / 60),
      y: spawn.pos.y + velBefore.y * (2 / 60),
      z: spawn.pos.z + velBefore.z * (2 / 60)
    };
    expect(enemy.pos.x).toBeCloseTo(expectedPos.x, 5);
    expect(enemy.pos.y).toBeCloseTo(expectedPos.y, 5);
    expect(enemy.pos.z).toBeCloseTo(expectedPos.z, 5);
  });

  it('reports out-of-range once it has flown far past the player', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy: EnemyShip = {
      type: SHIP_TYPES[0],
      pos: { x: 0, y: 0, z: 1300 },
      quat: { x: 0, y: 0, z: 0, w: 1 },
      vel: { x: 0, y: 0, z: 100 },
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      boostMeter: 0,
      boosting: false,
      health: createHealth(3),
      behavior: 'drifter',
      fireCooldown: 0,
      drift: { respawnTimer: 0 }
    };
    // one big tick to push it well past the 1400m despawn range
    const outOfRange = driftThink(enemy, player, 5);
    expect(outOfRange).toBe(true);
  });
});
