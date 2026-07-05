import type { EnemyShip, Vec3 } from '../types';
import { computeLeadPoint, wouldHitIfFiredNow } from './leadIndicator';
import { project, type Camera } from '../render/projection';
import { WEAPON } from '../world/weapons';

// meters — a lead point only counts as an active target once this close, matching the old
// render.ts PIP_RANGE this module replaces
const PIP_RANGE = 1500;

export interface ActivePip {
  enemy: EnemyShip;
  screenX: number;
  screenY: number;
  // true if firing right now, with the shooter's actual current facing and both craft holding
  // their current velocity, would land within the target's hull radius — drives the PIP's
  // hit/no-hit color in render.ts.
  wouldHit: boolean;
}

// Soft-lock: with multiple live enemies (e.g. the Aim Training drill's drone swarm), both the PIP
// drawn on screen and the ESP dampening it drives need to agree on a single "current target" —
// this picks whichever enemy's lead point currently projects closest to the crosshair. Callers in
// render.ts (drawing) and physics/step.ts (ESP dampening) share this one function so they can
// never disagree.
export function findActivePip(
  shooterPos: Vec3, shooterVel: Vec3,
  cam: Camera,
  enemies: EnemyShip[],
  viewportWidth: number, viewportHeight: number
): ActivePip | null {
  const cx = viewportWidth / 2, cy = viewportHeight / 2;
  let best: ActivePip | null = null;
  let bestDist = Infinity;

  for (const enemy of enemies) {
    if (enemy.health.points <= 0) continue;
    const dist = Math.hypot(enemy.pos.x - shooterPos.x, enemy.pos.y - shooterPos.y, enemy.pos.z - shooterPos.z);
    if (dist > PIP_RANGE) continue;
    const lead = computeLeadPoint(shooterPos, shooterVel, enemy.pos, enemy.vel, WEAPON.muzzleSpeed);
    if (!lead) continue;
    const p = project(lead.x, lead.y, lead.z, cam, viewportWidth, viewportHeight);
    if (!p) continue;
    const screenDist = Math.hypot(p.x - cx, p.y - cy);
    if (screenDist < bestDist) {
      bestDist = screenDist;
      const wouldHit = wouldHitIfFiredNow(
        shooterPos, shooterVel, cam.axes.forward,
        enemy.pos, enemy.vel, enemy.type.hullRadius,
        WEAPON.muzzleSpeed, WEAPON.lifetime
      );
      best = { enemy, screenX: p.x, screenY: p.y, wouldHit };
    }
  }

  return best;
}
