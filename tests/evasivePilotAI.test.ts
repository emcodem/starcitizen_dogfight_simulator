import { describe, it, expect, vi, afterEach } from 'vitest';
import { evasiveThink, spawnEvasiveState, EVASIVE_TUNING } from '../src/combat/enemyAI';
import { integrateFlight, resolveBoost } from '../src/physics/flightModel';
import { computeAxes, lookAtQuat } from '../src/math/quaternion';
import { normalize } from '../src/math/vec';
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
    verticalSpoolTime: 0,
    health: createHealth(999)
  };
}

function makeEvasiveEnemy(pos: { x: number; y: number; z: number }): EnemyShip {
  return {
    type: SHIP_TYPES[0],
    pos,
    quat: { x: 0, y: 0, z: 0, w: 1 },
    vel: { x: 0, y: 0, z: 0 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: SHIP_TYPES[0].boostCapacity,
    boosting: false,
    boostCooldownTimer: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(999),
    behavior: 'evasive',
    fireCooldown: 0,
    evasive: spawnEvasiveState()
  };
}

// Drives the enemy through the real flight model for `steps` ticks, exactly like
// scenarios/runtime.ts's 'evasive' dispatch branch does. Also advances the player's own position by
// its (constant, in these tests) velocity — a no-op for the stationary-player tests, but required for
// tests that give the player a nonzero velocity, or its position silently falls out of sync with a
// velocity the AI is trying to feed-forward against.
function driveEvasive(enemy: EnemyShip, player: Ship, dt: number, steps: number, returnFireEnabled = false): void {
  for (let i = 0; i < steps; i++) {
    player.pos.x += player.vel.x * dt;
    player.pos.y += player.vel.y * dt;
    player.pos.z += player.vel.z * dt;
    const decision = evasiveThink(enemy, enemy.evasive!, player, dt, returnFireEnabled);
    const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, dt);
    enemy.boostMeter = boost.boostMeter;
    enemy.boosting = boost.boosting;
    enemy.boostCooldownTimer = boost.cooldownTimer;
    integrateFlight(enemy, decision.inputs, dt);
  }
}

describe('evasiveThink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('flies to and then holds roughly standoffDistance ahead of a stationary player', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    // spawn it already at the standoff point, like runtime.ts's startScenario does
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });
    enemy.quat = lookAtQuat({ x: 0, y: 0, z: -1 }); // nose toward the player, like a real spawn

    driveEvasive(enemy, player, 1 / 60, 300); // 5s of simulated flight

    const dist = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z);
    // it's constantly juking side to side/up-down, not pinned dead-center, so allow generous slack
    // around the nominal standoff rather than an exact match
    expect(Math.abs(dist - EVASIVE_TUNING.standoffDistance)).toBeLessThan(70);
  });

  it("keeps pace when the player accelerates away, instead of letting the player pass it", () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });
    enemy.quat = lookAtQuat({ x: 0, y: 0, z: -1 }); // nose toward the player, like a real spawn

    player.vel.z = 150; // cruising forward at constant velocity — the AI's feed-forward term reads this
    for (let i = 0; i < 600; i++) {
      player.pos.z += player.vel.z * (1 / 60);
      const decision = evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
      const boost = resolveBoost(enemy.type, enemy.boostMeter, enemy.boosting, enemy.boostCooldownTimer, decision.boostRequested, 1 / 60);
      enemy.boostMeter = boost.boostMeter;
      enemy.boosting = boost.boosting;
      enemy.boostCooldownTimer = boost.cooldownTimer;
      integrateFlight(enemy, decision.inputs, 1 / 60);
    }

    // the drone must still be ahead of the player along the player's own forward axis, not behind it
    const toEnemy = { x: enemy.pos.x - player.pos.x, y: enemy.pos.y - player.pos.y, z: enemy.pos.z - player.pos.z };
    const { forward: playerForward } = computeAxes(player.quat);
    const forwardComponent = toEnemy.x * playerForward.x + toEnemy.y * playerForward.y + toEnemy.z * playerForward.z;
    expect(forwardComponent).toBeGreaterThan(0);
  });

  it('picks a jink direction via MPC and commits to it until the replan window elapses', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });
    enemy.quat = lookAtQuat({ x: 0, y: 0, z: -1 }); // nose toward the player, like a real spawn

    evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
    const chosenX = enemy.evasive!.jinkStrafeX;
    const chosenY = enemy.evasive!.jinkStrafeY;
    // must be one of the actual candidate directions MPC evaluates, not an arbitrary value
    const isKnownDirection = [0, 1, -1, 0.7071].some(v => Math.abs(Math.abs(chosenX) - v) < 1e-3)
      && [0, 1, -1, 0.7071].some(v => Math.abs(Math.abs(chosenY) - v) < 1e-3);
    expect(isKnownDirection).toBe(true);
    expect(enemy.evasive!.jinkReplanTimer).toBeGreaterThan(0);

    // commits — a tick well inside the replan window shouldn't change the chosen direction
    evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
    expect(enemy.evasive!.jinkStrafeX).toBe(chosenX);
    expect(enemy.evasive!.jinkStrafeY).toBe(chosenY);

    // once the replan window elapses, it re-evaluates (and commits to a fresh timer either way,
    // whether or not the winning direction happens to repeat)
    evasiveThink(enemy, enemy.evasive!, player, EVASIVE_TUNING.mpcReplanSec + 0.01, false);
    expect(enemy.evasive!.jinkReplanTimer).toBeGreaterThan(0);
  });

  it("matches the player's bank (up vector) regardless of which way its own nose points", () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    // roll the player hard onto its side
    player.quat = { x: 0, y: 0, z: Math.sin(Math.PI / 4), w: Math.cos(Math.PI / 4) };
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });
    enemy.quat = lookAtQuat({ x: 0, y: 0, z: -1 }); // nose toward the player, like a real spawn
    // pin the jink at dead-ahead (no MPC replan) so aimDir doesn't wander vertically — a nose that's
    // genuinely tipped away from the horizontal necessarily drags the up-hint-derived "up" away from
    // the player's own (matching bank while free-aiming the nose is a real geometric tradeoff, not a
    // controller bug); this isolates the steady-state bank convergence itself. wasThreatened is
    // preset to true too — this exact stationary, dead-ahead spawn is itself a "shot would land"
    // state, and leaving it false would let the rising-edge force-replan in evasiveThink override
    // the pinned timer right back to a fresh (possibly non-zero) jink direction.
    enemy.evasive!.jinkReplanTimer = 999;
    enemy.evasive!.wasThreatened = true;

    driveEvasive(enemy, player, 1 / 60, 180); // 3s — enough to converge bank at full rotational authority

    const { up: playerUp } = computeAxes(player.quat);
    const { up: enemyUp } = computeAxes(enemy.quat);
    const dot = playerUp.x * enemyUp.x + playerUp.y * enemyUp.y + playerUp.z * enemyUp.z;
    expect(dot).toBeGreaterThan(0.95); // nearly parallel bank
  });

  it('keeps its nose generally pointed at the player, not facing away', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });
    enemy.quat = lookAtQuat({ x: 0, y: 0, z: -1 }); // spawns nose-on, like a real spawn

    driveEvasive(enemy, player, 1 / 60, 120); // 2s

    const toPlayer = normalize({ x: player.pos.x - enemy.pos.x, y: player.pos.y - enemy.pos.y, z: player.pos.z - enemy.pos.z });
    const { forward: enemyForward } = computeAxes(enemy.quat);
    const dot = toPlayer.x * enemyForward.x + toPlayer.y * enemyForward.y + toPlayer.z * enemyForward.z;
    expect(dot).toBeGreaterThan(0.8); // nose is generally aimed back at the player, not away
  });

  it("force-replans the MPC jink choice the instant the player's shot would actually land, and re-evaluates on a faster cadence afterward", () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    // start well off the player's boresight — not threatened
    const enemy = makeEvasiveEnemy({ x: 500, y: 500, z: 500 });
    enemy.quat = lookAtQuat(normalize({ x: -500, y: -500, z: -500 })); // nose toward the player, like a real spawn
    evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
    expect(enemy.evasive!.wasThreatened).toBe(false);
    // pin the replan timer far in the future — if the threat transition below doesn't force an
    // immediate replan, this would otherwise mask it by "coincidentally" being due to replan anyway
    enemy.evasive!.jinkReplanTimer = 999;

    // now directly along the player's boresight, both stationary — a shot fired right now would land
    enemy.pos = { x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance };
    const decision = evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);

    expect(enemy.evasive!.wasThreatened).toBe(true);
    // replanned this same tick (not left at the 999 pin) and committed to the faster threat cadence,
    // not the calmer baseline one
    expect(enemy.evasive!.jinkReplanTimer).toBeCloseTo(EVASIVE_TUNING.mpcThreatReplanSec, 5);
    expect(decision.boostRequested).toBe(true); // panic burn on the exact tick a threat first appears
  });

  it('engages chase facing once a forward-speed deficit crosses the enter threshold, and releases once it drops below the (lower) exit threshold', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });
    // enemy already sits exactly at the standoff point with zero relative lateral/vertical offset,
    // so forwardVelDeficit reduces to just (player forward speed - enemy forward speed) here

    // small deficit, comfortably under chaseEnterVelDeficit — stays in the default 'watch' facing
    player.vel.z = 20;
    evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
    expect(enemy.evasive!.chasing).toBe(false);

    // large deficit, comfortably over chaseEnterVelDeficit — engages 'chase' to bring main thrust
    // to bear instead of relying on weak retro thrust while nose-locked on the player
    player.vel.z = EVASIVE_TUNING.chaseEnterVelDeficit + 50;
    evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
    expect(enemy.evasive!.chasing).toBe(true);

    // deficit worked down to just under chaseExitVelDeficit (not just under the higher enter
    // threshold — that's the whole point of hysteresis) — releases back to watching the player
    enemy.vel.z = player.vel.z - (EVASIVE_TUNING.chaseExitVelDeficit - 5);
    evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
    expect(enemy.evasive!.chasing).toBe(false);
  });

  it('never enters shootback mode when return fire is disabled', () => {
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });

    let sawFireIntent = false;
    for (let i = 0; i < 600; i++) {
      const decision = evasiveThink(enemy, enemy.evasive!, player, 1 / 60, false);
      if (decision.wantsToFire) sawFireIntent = true;
    }
    expect(sawFireIntent).toBe(false);
  });

  it('can enter shootback mode and signal fire intent when return fire is enabled', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // always beats the per-tick shootback chance roll
    const player = makeTestShip({ x: 0, y: 0, z: 0 });
    const enemy = makeEvasiveEnemy({ x: 0, y: 0, z: EVASIVE_TUNING.standoffDistance });

    const decision = evasiveThink(enemy, enemy.evasive!, player, 1 / 60, true);
    expect(decision.wantsToFire).toBe(true);
    expect(enemy.evasive!.mode).toBe('shootback');
  });
});
