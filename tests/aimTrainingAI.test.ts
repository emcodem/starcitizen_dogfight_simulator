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
    boostCooldownTimer: 0,
    exploding: false,
    explosionTimer: 0,
    hitFlash: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0
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
    boostCooldownTimer: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
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

  it('keeps the drone at a constant radius from its fixed spawn center while the player is within the leash', () => {
    // pin the barrel-roll trigger roll off — it's a real chance per tick (see enemyAI.ts) that
    // would otherwise occasionally add up to +/-30m of cosmetic offset and flake this assertion
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const enemy = makeOrbiter(200);
    const player = makeTestShip({ x: 0, y: 0, z: 0 }); // well inside the 500m leash the whole time

    for (let i = 0; i < 30; i++) {
      orbiterThink(enemy, player, 1 / 60);
      const dist = Math.hypot(enemy.pos.x, enemy.pos.y, enemy.pos.z);
      expect(dist).toBeCloseTo(200, 3);
    }
  });

  it('lets the player close or open distance by flying, unlike a player-centered orbit, as long as it stays within the leash', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1); // pin the barrel-roll trigger off — see above
    const enemy = makeOrbiter(200);
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    orbiterThink(enemy, player, 1 / 60);
    const before = Math.hypot(enemy.pos.x, enemy.pos.y, enemy.pos.z);

    // moving the player, while still well within leashDistance (500m), must not tug the fixed
    // orbit center at all
    player.pos.x = 100;
    orbiterThink(enemy, player, 1 / 60);
    const after = Math.hypot(enemy.pos.x, enemy.pos.y, enemy.pos.z);
    expect(after).toBeCloseTo(before, 3); // orbit is unaffected by the player's position/movement
  });

  it('gives the drone a nonzero tangential velocity, not a stationary hover', () => {
    const enemy = makeOrbiter(200);
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    orbiterThink(enemy, player, 1 / 60);
    const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
    expect(speed).toBeGreaterThan(0);
  });

  it('eases the orbit center toward a player who has strayed past the leash distance', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1); // pin the barrel-roll trigger off — see above
    const enemy = makeOrbiter(100); // radius 100 around center (0,0,0)
    const player = makeTestShip({ x: 2000, y: 0, z: 0 }); // 2000m away, well past the 500m leash

    for (let i = 0; i < 300; i++) orbiterThink(enemy, player, 1 / 60); // 5s of simulated flight

    // center should have eased substantially toward the player instead of staying pinned at spawn
    expect(enemy.orbit!.center.x).toBeGreaterThan(500);
    const dist = Math.hypot(
      enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z
    );
    expect(dist).toBeLessThan(2000); // meaningfully closer than the original spawn-time distance
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
      boostCooldownTimer: 0,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0,
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

  function makeDrifter(pos: { x: number; y: number; z: number }, vel: { x: number; y: number; z: number }): EnemyShip {
    return {
      type: SHIP_TYPES[0],
      pos,
      quat: { x: 0, y: 0, z: 0, w: 1 },
      vel,
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      boostMeter: 0,
      boosting: false,
      boostCooldownTimer: 0,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0,
      health: createHealth(3),
      behavior: 'drifter',
      fireCooldown: 0,
      drift: { respawnTimer: 0 }
    };
  }

  it('banks into a turn-around instead of despawning once it has flown far past the player', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    // flying straight away from the player, well past the 500m turn distance
    const enemy = makeDrifter({ x: 0, y: 0, z: 400 }, { x: 0, y: 0, z: 100 });

    // one big tick to push it past turnDist and trigger the turn-around
    driftThink(enemy, player, 5);
    expect(enemy.drift!.turn).toBeDefined();
  });

  it('reverses heading and preserves speed over the course of a full turn-around', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeDrifter({ x: 0, y: 0, z: 400 }, { x: 0, y: 0, z: 100 });
    const speedBefore = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
    const dirBefore = { x: enemy.vel.x / speedBefore, y: enemy.vel.y / speedBefore, z: enemy.vel.z / speedBefore };

    driftThink(enemy, player, 5); // trigger the turn
    expect(enemy.drift!.turn).toBeDefined();

    // step through the whole turn duration in small ticks
    for (let i = 0; i < 400; i++) driftThink(enemy, player, 1 / 60);

    expect(enemy.drift!.turn).toBeUndefined(); // turn has completed
    const speedAfter = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
    expect(speedAfter).toBeCloseTo(speedBefore, 3); // speed held constant through the maneuver

    const dirAfter = { x: enemy.vel.x / speedAfter, y: enemy.vel.y / speedAfter, z: enemy.vel.z / speedAfter };
    const dot = dirBefore.x * dirAfter.x + dirBefore.y * dirAfter.y + dirBefore.z * dirAfter.z;
    expect(dot).toBeLessThan(0); // heading has substantially reversed, not just nudged
  });
});
