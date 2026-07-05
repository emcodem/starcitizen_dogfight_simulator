import type { EnemyShip, Ship } from '../types';
import type { ScenarioConfig, ScenarioRuntime } from './types';
import { createHealth } from '../combat/health';
import { resolveHits } from '../combat/hitDetection';
import * as FighterAI from '../combat/enemyAI';
import { projectiles, spawnProjectileFrom, WEAPON } from '../world/weapons';
import { computeAxes, lookAtQuat, rotateTowards } from '../math/quaternion';
import { integrateFlight, resolveBoost } from '../physics/flightModel';

// Enemy only opens fire once its nose is roughly on target (~3 degrees) — gives the AI a visible
// "tracking, not yet locked" phase instead of hosing the player from any angle.
const AIM_FIRE_CONE_RAD = 0.05;

export function startScenario(config: ScenarioConfig, player: Ship): ScenarioRuntime {
  player.health = createHealth(config.hitsToKillPlayer);
  const enemies: EnemyShip[] = config.enemySpawns.map(spawn => ({
    type: spawn.type,
    pos: { x: spawn.pos.x, y: spawn.pos.y, z: spawn.pos.z },
    quat: { x: spawn.quat.x, y: spawn.quat.y, z: spawn.quat.z, w: spawn.quat.w },
    vel: { x: 0, y: 0, z: 0 },
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
  return { config, enemies, outcome: 'active' };
}

export function updateScenario(runtime: ScenarioRuntime, player: Ship, dt: number): void {
  if (runtime.outcome !== 'active') return;

  for (const enemy of runtime.enemies) {
    if (enemy.health.points <= 0) continue;

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

  resolveHits(projectiles, player, runtime.enemies);

  if (player.health && player.health.points <= 0) {
    runtime.outcome = 'lost';
  } else if (runtime.enemies.every(e => e.health.points <= 0)) {
    runtime.outcome = 'won';
  }
}
