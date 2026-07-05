import { describe, it, expect } from 'vitest';
import { resolveHits } from '../src/combat/hitDetection';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import type { EnemyShip, Projectile, Ship } from '../src/types';

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
    hitFlash: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(50)
  };
}

function makeTestEnemy(pos: { x: number; y: number; z: number }): EnemyShip {
  return {
    type: SHIP_TYPES[0],
    pos,
    quat: { x: 0, y: 0, z: 0, w: 1 },
    vel: { x: 0, y: 0, z: 0 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: 0,
    boosting: false,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(50),
    behavior: 'turret',
    turnRateRadPerSec: 0,
    fireCooldown: 0
  };
}

describe('resolveHits', () => {
  it('damages the player and removes the projectile when an enemy shot lands within the hull radius', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeTestEnemy({ x: 0, y: 0, z: 1000 });
    const projectiles: Projectile[] = [
      { pos: { x: 1, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 0, owner: 'enemy' }
    ];

    resolveHits(projectiles, player, [enemy]);

    expect(player.health!.points).toBe(49);
    expect(projectiles.length).toBe(0);
    expect(player.hitFlash).toBe(1);
  });

  it('leaves an out-of-radius enemy shot untouched', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeTestEnemy({ x: 0, y: 0, z: 1000 });
    const projectiles: Projectile[] = [
      { pos: { x: 500, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, age: 0, owner: 'enemy' }
    ];

    resolveHits(projectiles, player, [enemy]);

    expect(player.health!.points).toBe(50);
    expect(projectiles.length).toBe(1);
  });

  it('damages the enemy (not the player) on a player-owned hit', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeTestEnemy({ x: 0, y: 0, z: 1000 });
    const projectiles: Projectile[] = [
      { pos: { x: 0, y: 0, z: 1000 }, vel: { x: 0, y: 0, z: 0 }, age: 0, owner: 'player' }
    ];

    resolveHits(projectiles, player, [enemy]);

    expect(enemy.health.points).toBe(49);
    expect(player.health!.points).toBe(50);
    expect(projectiles.length).toBe(0);
  });

  it('does not damage an already-destroyed enemy', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeTestEnemy({ x: 0, y: 0, z: 1000 });
    enemy.health.points = 0;
    const projectiles: Projectile[] = [
      { pos: { x: 0, y: 0, z: 1000 }, vel: { x: 0, y: 0, z: 0 }, age: 0, owner: 'player' }
    ];

    resolveHits(projectiles, player, [enemy]);

    expect(enemy.health.points).toBe(0);
    expect(projectiles.length).toBe(1); // no live target to consume it
  });
});
