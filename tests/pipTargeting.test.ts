import { describe, it, expect } from 'vitest';
import { findActivePip } from '../src/combat/pipTargeting';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import type { Camera } from '../src/render/projection';
import type { EnemyShip } from '../src/types';

function makeEnemy(pos: { x: number; y: number; z: number }): EnemyShip {
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
    health: createHealth(10),
    behavior: 'turret',
    fireCooldown: 0
  };
}

const shooterPos = { x: 0, y: 0, z: 0 };
const shooterVel = { x: 0, y: 0, z: 0 };
const cam: Camera = {
  pos: shooterPos,
  axes: { forward: { x: 0, y: 0, z: 1 }, right: { x: 1, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } }
};
const VIEWPORT_W = 800, VIEWPORT_H = 600;

describe('findActivePip', () => {
  it('returns null when no enemies are alive', () => {
    const dead = makeEnemy({ x: 0, y: 0, z: 500 });
    dead.health.points = 0;
    expect(findActivePip(shooterPos, shooterVel, cam, [dead], VIEWPORT_W, VIEWPORT_H)).toBeNull();
  });

  it('returns null when the only enemy is beyond PIP range', () => {
    const farEnemy = makeEnemy({ x: 0, y: 0, z: 2000 });
    expect(findActivePip(shooterPos, shooterVel, cam, [farEnemy], VIEWPORT_W, VIEWPORT_H)).toBeNull();
  });

  it('picks whichever enemy projects closest to the crosshair among several', () => {
    const onAxis = makeEnemy({ x: 0, y: 0, z: 500 });       // dead-ahead — projects to screen center
    const offAxis = makeEnemy({ x: 150, y: 0, z: 500 });    // off to the side — projects away from center
    const result = findActivePip(shooterPos, shooterVel, cam, [offAxis, onAxis], VIEWPORT_W, VIEWPORT_H);
    expect(result).not.toBeNull();
    expect(result!.enemy).toBe(onAxis);
    expect(result!.screenX).toBeCloseTo(VIEWPORT_W / 2, 1);
    expect(result!.screenY).toBeCloseTo(VIEWPORT_H / 2, 1);
  });
});
