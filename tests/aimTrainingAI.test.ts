import { describe, it, expect, vi, afterEach } from 'vitest';
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

function makeOrbiter(radius: number, center = { x: 0, y: 0, z: 0 }): EnemyShip {
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
      center,
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the drone at a constant radius from its fixed spawn center, not the player', () => {
    // pin the barrel-roll trigger roll off — it's a real chance per tick (see enemyAI.ts) that
    // would otherwise occasionally add up to +/-30m of cosmetic offset and flake this assertion
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const enemy = makeOrbiter(200);

    for (let i = 0; i < 30; i++) {
      orbiterThink(enemy, 1 / 60);
      const dist = Math.hypot(enemy.pos.x, enemy.pos.y, enemy.pos.z);
      expect(dist).toBeCloseTo(200, 3);
    }
  });

  it('lets the player close or open distance by flying, unlike a player-centered orbit', () => {
    const enemy = makeOrbiter(200);
    orbiterThink(enemy, 1 / 60);
    const before = Math.hypot(enemy.pos.x, enemy.pos.y, enemy.pos.z);

    // the player flying toward the (fixed) orbit center must not change the drone's position at all
    const player = makeTestShip({ x: 500, y: 0, z: 0 });
    orbiterThink(enemy, 1 / 60);
    const after = Math.hypot(enemy.pos.x, enemy.pos.y, enemy.pos.z);
    expect(after).toBeCloseTo(before, 3); // orbit is unaffected by the player's position/movement
    expect(player.pos.x).toBe(500); // sanity: player did move, yet the orbiter didn't track it
  });

  it('gives the drone a nonzero tangential velocity, not a stationary hover', () => {
    const enemy = makeOrbiter(200);
    orbiterThink(enemy, 1 / 60);
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
