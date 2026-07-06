import type { EnemyShip, Ship, Projectile, Vec3 } from '../types';
import { applyDamage } from './health';

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// Sphere-vs-sphere hit test: enemy-owned projectiles damage the player, player-owned projectiles
// damage whichever enemy they land inside. Consumed projectiles are removed. Generic over the
// `enemies` array so adding more opponents to a future scenario needs no changes here.
export function resolveHits(
  projectiles: Projectile[],
  player: Ship,
  enemies: EnemyShip[],
  onEnemyHit?: () => void,
  onEnemyDestroyed?: (enemy: EnemyShip) => void,
  onPlayerHit?: () => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];

    if (pr.owner === 'enemy') {
      if (player.health && player.health.points > 0 && distance(pr.pos, player.pos) <= player.type.hullRadius) {
        applyDamage(player.health);
        player.hitFlash = 1; // full-intensity hit-flash cue — fades over time in physics/step.ts
        onPlayerHit?.();
        projectiles.splice(i, 1);
      }
      continue;
    }

    for (const enemy of enemies) {
      if (enemy.health.points <= 0) continue;
      if (distance(pr.pos, enemy.pos) <= enemy.type.hullRadius) {
        const destroyed = applyDamage(enemy.health);
        onEnemyHit?.();
        if (destroyed) onEnemyDestroyed?.(enemy);
        projectiles.splice(i, 1);
        break;
      }
    }
  }
}
