import { describe, it, expect } from 'vitest';
import * as FighterAI from '../src/combat/enemyAI';
import { integrateFlight, resolveBoost } from '../src/physics/flightModel';
import { deriveShipType } from '../src/ship/deriveShipType';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import { lookAtQuat } from '../src/math/quaternion';
import type { EnemyShip, Ship } from '../src/types';

// Same angularScale as scenarios/definitions.ts's ROOKIE_GLADIUS — physically slower-turning hull
// is part of what makes the runaway failure mode reproducible (a full-speed ship needs turn rate
// to reorient during recovery, not just brake authority).
const ROOKIE_GLADIUS = deriveShipType(SHIP_TYPES[0], { angularScale: 0.65, name: 'test-rookie' });

function makeTestPlayer(vel: { x: number; y: number; z: number }): Ship {
  return {
    type: SHIP_TYPES[0], pos: { x: 0, y: 0, z: 0 }, vel,
    quat: lookAtQuat({ x: 0, y: 0, z: 1 }), angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0, decoupled: false, spaceBrakeOn: false, boostMeter: 0, boosting: false,
    boostCooldownTimer: 0, exploding: false, explosionTimer: 0, hitFlash: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0
  };
}

function makeRookieEnemy(): EnemyShip {
  return {
    // real scenario spawn: at rest, 2600m out, nose toward the player — see
    // scenarios/definitions.ts's fighter-intercept-rookie config
    type: ROOKIE_GLADIUS, pos: { x: 0, y: 0, z: 2600 }, quat: lookAtQuat({ x: 0, y: 0, z: -1 }),
    vel: { x: 0, y: 0, z: 0 }, angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: ROOKIE_GLADIUS.boostCapacity, boosting: false, boostCooldownTimer: 0,
    throttleSpoolTime: 0, verticalSpoolTime: 0,
    health: { points: 50, maxPoints: 50 }, behavior: 'fighter',
    ai: { mode: 'close', modeTimer: 0, clock: 0, jinkSeed: 0, repositionElapsed: 0, tuning: FighterAI.FIGHTER_TUNING_ROOKIE },
    fireCooldown: 0
  };
}

describe('rookie fighter AI leash — regression for the "flies away forever" bug', () => {
  it('never lets separation balloon far past closeRange, even after a hard head-on merge pass', () => {
    // player merges through at full boost, then cuts throttle to re-engage — a real player doesn't
    // keep flying away forever after a pass, so a synthetic player with no deceleration at all would
    // make "separation grows" meaningless (that's the PLAYER leaving, not the enemy fleeing).
    const player = makeTestPlayer({ x: 0, y: 0, z: SHIP_TYPES[0].boostSpeedForward });
    const enemy = makeRookieEnemy();

    let maxDistAfterPass = 0;
    let passed = false;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 40; i++) { // 40 simulated seconds
      if (passed) player.vel = { x: 0, y: 0, z: 0 };
      player.pos.x += player.vel.x * dt;
      player.pos.y += player.vel.y * dt;
      player.pos.z += player.vel.z * dt;

      const decision = FighterAI.think(enemy, enemy.ai!, player, dt);
      const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
      enemy.boostMeter = boost.boostMeter;
      enemy.boosting = boost.boosting;
      enemy.boostCooldownTimer = boost.cooldownTimer;
      integrateFlight(enemy, decision.inputs, dt);

      const dist = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z);
      if (dist < 150) passed = true; // merge pass happened
      if (passed && dist > maxDistAfterPass) maxDistAfterPass = dist;
    }

    // regression guard: this used to reach ~1800m (nearly 2x closeRange) before the predictive
    // stopping-distance check + throttle/brake conflict fixes in enemyAI.ts/think()
    expect(maxDistAfterPass).toBeLessThan(FighterAI.FIGHTER_TUNING_ROOKIE.closeRange * 1.2);
  });

  it("doesn't thrash between 'close' and 'reposition' every tick while recovering from an overshoot", () => {
    const player = makeTestPlayer({ x: 0, y: 0, z: SHIP_TYPES[0].boostSpeedForward });
    const enemy = makeRookieEnemy();

    let passed = false;
    let lastMode = enemy.ai!.mode;
    let transitionsAfterPass = 0;
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 40; i++) {
      if (passed) player.vel = { x: 0, y: 0, z: 0 };
      player.pos.x += player.vel.x * dt;
      player.pos.y += player.vel.y * dt;
      player.pos.z += player.vel.z * dt;

      const decision = FighterAI.think(enemy, enemy.ai!, player, dt);
      const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
      enemy.boostMeter = boost.boostMeter;
      enemy.boosting = boost.boosting;
      enemy.boostCooldownTimer = boost.cooldownTimer;
      integrateFlight(enemy, decision.inputs, dt);

      const dist = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z);
      if (dist < 150) passed = true;
      if (passed && enemy.ai!.mode !== lastMode) {
        transitionsAfterPass++;
        lastMode = enemy.ai!.mode;
      }
    }

    // regression guard: without hysteresis on the predictive too-far check, this used to flip-flop
    // 'close'/'reposition' every 10-20ms while the outward speed settled right at the threshold —
    // visible nose-flicking jitter even though the resulting distance was fine. A real recovery
    // settles into a handful of mode changes, not hundreds.
    expect(transitionsAfterPass).toBeLessThan(15);
  });
});
