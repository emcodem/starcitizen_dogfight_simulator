import type { EnemyShip, Ship } from '../types';
import type { ScenarioConfig, ScenarioRuntime } from './types';
import { createHealth } from '../combat/health';
import { resolveHits } from '../combat/hitDetection';
import * as FighterAI from '../combat/enemyAI';
import { evaluateGateCrossing } from './gatePath';
import { projectiles, spawnProjectileFrom, WEAPON } from '../world/weapons';
import { computeAxes, lookAtQuat, rotateTowards } from '../math/quaternion';
import { integrateFlight, resolveBoost } from '../physics/flightModel';

// Enemy only opens fire once its nose is roughly on target (~3 degrees) — gives the AI a visible
// "tracking, not yet locked" phase instead of hosing the player from any angle.
const AIM_FIRE_CONE_RAD = 0.05;

// Kept short so it doesn't linger through an orbiter/drifter's respawn — see render.ts's
// drawEnemyExplosions, which reads this same constant to fade the burst out in sync.
export const ENEMY_EXPLOSION_DURATION = 0.6;

export function startScenario(config: ScenarioConfig, player: Ship): ScenarioRuntime {
  player.health = createHealth(config.hitsToKillPlayer);
  player.vel = config.playerInitialVel
    ? { x: config.playerInitialVel.x, y: config.playerInitialVel.y, z: config.playerInitialVel.z }
    : { x: 0, y: 0, z: 0 };
  const enemies: EnemyShip[] = config.enemySpawns.map(spawn => ({
    type: spawn.type,
    pos: { x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z },
    quat: { x: spawn.quat.x, y: spawn.quat.y, z: spawn.quat.z, w: spawn.quat.w },
    vel: spawn.initialVel ? { x: spawn.initialVel.x, y: spawn.initialVel.y, z: spawn.initialVel.z } : { x: 0, y: 0, z: 0 },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boostMeter: spawn.type.boostCapacity,
    boosting: false,
    health: createHealth(config.hitsToKillEnemy),
    behavior: spawn.behavior,
    turnRateRadPerSec: spawn.turnRateRadPerSec,
    ai: spawn.behavior === 'fighter'
      ? { mode: 'close', modeTimer: 0, clock: 0, jinkSeed: Math.random() * 1000, tuning: spawn.tuning ?? FighterAI.FIGHTER_TUNING_ACE }
      : undefined,
    fireCooldown: 0
  }));

  // 'orbiter'/'drifter' spawns don't fly from their config pos/quat — they get a fresh randomized
  // flight path right away, same as how 'chaser'/'fighter' spawns immediately take over steering.
  const aggressiveness = config.droneAggressiveness ?? 0.5;
  for (const enemy of enemies) {
    if (enemy.behavior === 'orbiter') {
      enemy.orbit = FighterAI.spawnOrbitState(player.pos, aggressiveness);
    } else if (enemy.behavior === 'drifter') {
      const s = FighterAI.spawnDriftState(player, aggressiveness);
      enemy.pos = s.pos;
      enemy.vel = s.vel;
      enemy.quat = lookAtQuat(s.vel);
      enemy.drift = { respawnTimer: 0 };
    }
  }

  return {
    config, enemies, outcome: 'active', elapsedSec: 0, gateIndex: 0,
    stats: { shotsFired: 0, hitsLanded: 0, kills: 0 }, explosions: [], bubbleTimeSec: 0
  };
}

// Number of 100ms ticks the player has spent within rangeBubbleRadius, for display — see
// ScenarioRuntime.bubbleTimeSec's doc comment for why this is derived rather than an incremented
// counter (a plain time accumulator sidesteps any drift between real elapsed time and tick count).
export function bubbleTicks(runtime: ScenarioRuntime): number {
  return Math.floor(runtime.bubbleTimeSec / 0.1);
}

export function updateScenario(runtime: ScenarioRuntime, player: Ship, dt: number): void {
  if (runtime.outcome !== 'active') return;
  runtime.elapsedSec += dt;

  for (const enemy of runtime.enemies) {
    // 'orbiter'/'drifter' handle their own dead-state below (countdown + respawn) — everything
    // else (turret/chaser/fighter) just stays dead once destroyed, per the 'destroy' scenarios'
    // design. Skipping dead orbiters/drifters here too would make that respawn code unreachable.
    if (enemy.health.points <= 0 && enemy.behavior !== 'orbiter' && enemy.behavior !== 'drifter') continue;

    if (enemy.behavior === 'cruiser') {
      FighterAI.cruiseThink(enemy, dt);
      continue;
    }

    if (enemy.behavior === 'chaser') {
      const decision = FighterAI.chaserThink(enemy, player);
      const boost = resolveBoost(enemy.type, enemy.boostMeter, decision.boostRequested, dt);
      enemy.boostMeter = boost.boostMeter;
      enemy.boosting = boost.boosting;
      integrateFlight(enemy, decision.inputs, dt);

      enemy.fireCooldown -= dt;
      if (decision.wantsToFire && enemy.fireCooldown <= 0) {
        // re-check aim post-rotation — see canFireWithinTolerance's doc comment for why.
        const { forward, right, up } = computeAxes(enemy.quat);
        const dist = Math.hypot(
          player.pos.x - enemy.pos.x,
          player.pos.y - enemy.pos.y,
          player.pos.z - enemy.pos.z
        );
        if (FighterAI.canFireWithinTolerance(
          forward, decision.aimDir, dist,
          FighterAI.CHASER_TUNING.fireRange, FighterAI.CHASER_TUNING.fireLateralTolerance
        )) {
          spawnProjectileFrom(enemy.pos, enemy.vel, forward, right, up, 'enemy');
          enemy.fireCooldown = 1 / WEAPON.fireRate;
        }
      }
      continue;
    }

    if (enemy.behavior === 'fighter' && enemy.ai) {
      const decision = FighterAI.think(enemy, enemy.ai, player, dt);
      const boost = resolveBoost(enemy.type, enemy.boostMeter, decision.boostRequested, dt);
      enemy.boostMeter = boost.boostMeter;
      enemy.boosting = boost.boosting;
      integrateFlight(enemy, decision.inputs, dt);

      enemy.fireCooldown -= dt;
      if (decision.wantsToFire && enemy.fireCooldown <= 0) {
        // re-check aim using the orientation AFTER this tick's rotation (not the pre-rotation
        // orientation the AI's decision was based on) — see canFire's doc comment for why that
        // ordering matters: firing on the stale angle let shots leave aimed where the nose used
        // to be, not where it ends up.
        const { forward, right, up } = computeAxes(enemy.quat);
        const dist = Math.hypot(
          player.pos.x - enemy.pos.x,
          player.pos.y - enemy.pos.y,
          player.pos.z - enemy.pos.z
        );
        if (FighterAI.canFire(forward, decision.aimDir, dist, enemy.ai.tuning)) {
          spawnProjectileFrom(enemy.pos, enemy.vel, forward, right, up, 'enemy');
          enemy.fireCooldown = 1 / WEAPON.fireRate;
        }
      }
      continue;
    }

    if (enemy.behavior === 'orbiter') {
      if (enemy.health.points <= 0) {
        if (enemy.orbit) {
          // respawnTimer counts UP elapsed dead-time, so the very first dead frame doesn't
          // instantly respawn it — spawnOrbitState() below resets it to 0 for the next death.
          enemy.orbit.respawnTimer += dt;
          if (enemy.orbit.respawnTimer >= FighterAI.ORBITER_TUNING.respawnDelaySec) {
            enemy.health = createHealth(runtime.config.hitsToKillEnemy);
            enemy.orbit = FighterAI.spawnOrbitState(player.pos, runtime.config.droneAggressiveness ?? 0.5);
          }
        }
        continue;
      }
      FighterAI.orbiterThink(enemy, player, dt);
      continue;
    }

    if (enemy.behavior === 'drifter') {
      if (enemy.health.points <= 0) {
        if (enemy.drift) {
          enemy.drift.respawnTimer += dt; // see the orbiter branch above for why this counts up
          if (enemy.drift.respawnTimer >= FighterAI.DRIFTER_TUNING.respawnDelaySec) {
            enemy.health = createHealth(runtime.config.hitsToKillEnemy);
            const s = FighterAI.spawnDriftState(player, runtime.config.droneAggressiveness ?? 0.5);
            enemy.pos = s.pos;
            enemy.vel = s.vel;
            enemy.quat = lookAtQuat(s.vel);
            enemy.drift.respawnTimer = 0;
            enemy.drift.rollTimer = 0;
            enemy.drift.rollCooldown = 0;
            enemy.drift.turn = undefined; // in case it died mid turn-around
          }
        }
        continue;
      }
      // no out-of-range teleport here — driftThink itself banks into a turn-around once it's flown
      // too far (see DRIFTER_TUNING.turnDist), so the same drone keeps making passes indefinitely
      FighterAI.driftThink(enemy, player, dt, runtime.config.droneAggressiveness ?? 0.5);
      continue;
    }

    // 'turret' behavior — stays put (per the drill's design), just turns to face the player
    const toPlayer = {
      x: player.pos.x - enemy.pos.x,
      y: player.pos.y - enemy.pos.y,
      z: player.pos.z - enemy.pos.z
    };
    const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
    if (dist < 1e-6) continue;

    const targetQuat = lookAtQuat(toPlayer);
    enemy.quat = rotateTowards(enemy.quat, targetQuat, (enemy.turnRateRadPerSec ?? 0) * dt);

    const { forward, right, up } = computeAxes(enemy.quat);
    const aimDot = (toPlayer.x * forward.x + toPlayer.y * forward.y + toPlayer.z * forward.z) / dist;
    const aimAngle = Math.acos(Math.min(1, Math.max(-1, aimDot)));

    enemy.fireCooldown -= dt;
    if (aimAngle <= AIM_FIRE_CONE_RAD && enemy.fireCooldown <= 0) {
      spawnProjectileFrom(enemy.pos, enemy.vel, forward, right, up, 'enemy');
      enemy.fireCooldown = 1 / WEAPON.fireRate;
    }
  }

  resolveHits(projectiles, player, runtime.enemies, () => runtime.stats.hitsLanded++, enemy => {
    runtime.stats.kills++;
    runtime.explosions.push({ pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z }, timer: ENEMY_EXPLOSION_DURATION });
  });

  if (runtime.config.rangeBubbleRadius !== undefined) {
    const bubbleRadius = runtime.config.rangeBubbleRadius;
    const insideBubble = runtime.enemies.some(enemy =>
      enemy.health.points > 0 &&
      Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z) <= bubbleRadius
    );
    if (insideBubble) runtime.bubbleTimeSec += dt;
  }

  for (let i = runtime.explosions.length - 1; i >= 0; i--) {
    runtime.explosions[i].timer -= dt;
    if (runtime.explosions[i].timer <= 0) runtime.explosions.splice(i, 1);
  }

  if (player.health && player.health.points <= 0) {
    runtime.outcome = 'lost';
    runtime.failReason = 'died';
  } else if (runtime.config.winCondition === 'destroy') {
    if (runtime.enemies.every(e => e.health.points <= 0)) runtime.outcome = 'won';
  } else if (runtime.config.winCondition === 'survive') {
    // surviveDurationSec omitted means indefinite — the drill only ends when the player backs out
    // to the menu, it never auto-wins on a timer.
    const duration = runtime.config.surviveDurationSec;
    if (duration !== undefined && runtime.elapsedSec >= duration) runtime.outcome = 'won';
  } else {
    // 'gates' — advance/fail against the current target gate, then check the course-complete /
    // timeout conditions. Order matters: a gate clear on the final gate should win immediately,
    // not fall through to a timeout check that never gets the chance to matter.
    const gates = runtime.config.gatePath ?? [];
    const gate = gates[runtime.gateIndex];
    if (gate) {
      const crossing = evaluateGateCrossing(player.pos, gate);
      if (crossing === 'cleared') runtime.gateIndex++;
      else if (crossing === 'missed') {
        runtime.outcome = 'lost';
        runtime.failReason = 'missedGate';
      }
    }
    if (runtime.outcome === 'active') {
      if (runtime.gateIndex >= gates.length) {
        runtime.outcome = 'won';
      } else if (runtime.config.surviveDurationSec !== undefined && runtime.elapsedSec > runtime.config.surviveDurationSec) {
        runtime.outcome = 'lost';
        runtime.failReason = 'timeout';
      }
    }
  }
}
