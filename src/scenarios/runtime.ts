import type { EnemyShip, Ship } from '../types';
import type { ScenarioConfig, ScenarioRuntime } from './types';
import { createHealth } from '../combat/health';
import { resolveHits } from '../combat/hitDetection';
import { projectiles, spawnProjectileFrom, WEAPON } from '../world/weapons';
import { computeAxes, lookAtQuat, rotateTowards } from '../math/quaternion';

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
    health: createHealth(config.hitsToKillEnemy),
    turnRateRadPerSec: spawn.turnRateRadPerSec,
    fireCooldown: 0
  }));
  return { config, enemies, outcome: 'active' };
}

export function updateScenario(runtime: ScenarioRuntime, player: Ship, dt: number): void {
  if (runtime.outcome !== 'active') return;

  for (const enemy of runtime.enemies) {
    if (enemy.health.points <= 0) continue;

    const toPlayer = {
      x: player.pos.x - enemy.pos.x,
      y: player.pos.y - enemy.pos.y,
      z: player.pos.z - enemy.pos.z
    };
    const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
    if (dist < 1e-6) continue;

    // stays put (per the drill's design), just turns to face the player at its capped rate
    const targetQuat = lookAtQuat(toPlayer);
    enemy.quat = rotateTowards(enemy.quat, targetQuat, enemy.turnRateRadPerSec * dt);

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
