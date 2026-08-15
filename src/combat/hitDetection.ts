import type { CelestialBody, EnemyShip, Projectile, ShipBody } from '../core/world';
import type { Vec3 } from '../core/types';
import { add, clamp, dot, normalize, scale, sub } from '../math/vec';
import { applyDamage } from './health';
import { getWeaponType, DEFAULT_WEAPON_TYPE_ID } from '../physics/weapons';

// Projectile doesn't carry which weapon fired it, so this can't yet be a truly per-shot damage value
// (would need a field added once a second weapon actually exists) — fine while there's only one.
const WEAPON_DAMAGE = getWeaponType(DEFAULT_WEAPON_TYPE_ID).damage;

// Swept segment-vs-sphere: does the round's path this frame (prevPos → pos) pass within `radius` of
// `center`? A frame's sim step is never longer than main.ts's 50ms dt clamp regardless of the
// browser's actual frame rate (a slow/laggy real frame just gets clamped down for physics purposes,
// same as every other integrator in this project) — so a round can travel up to but never more than
// ~74 m in one step (1480 m/s × 50 ms) against hulls only ~10 m across. A bare point-in-sphere test
// at pos alone would let rounds tunnel clean through a target between steps at that speed, so we
// test the closest point on the travel segment instead. Returns that contact point (clamped onto the
// segment) so the caller can spawn the impact where the path grazes the sphere rather than wherever
// the round happened to land past it.
function sweepHitsSphere(prev: Vec3, pos: Vec3, center: Vec3, radius: number): Vec3 | null {
  const seg = sub(pos, prev);
  const toStart = sub(prev, center);
  const segLenSq = dot(seg, seg);
  // Fraction along the segment closest to the sphere center (0 = prev, 1 = pos); degenerate
  // zero-length segment (spawn frame) collapses to a point test at prev.
  const t = segLenSq < 1e-12 ? 0 : clamp(-dot(toStart, seg) / segLenSq, 0, 1);
  const closest = add(prev, scale(seg, t));
  const d = sub(closest, center);
  return dot(d, d) <= radius * radius ? closest : null;
}

// sweepHitsSphere's `hit` is the round's closest approach to the hull CENTER, which for a
// precisely-aimed shot can land anywhere inside the sphere, including almost exactly at the
// center — not confined to the hull surface at `radius`. That's fine for damage (any point inside
// counts as a hit) but wrong for the visual: a laser impact should spark where the beam struck the
// hull. (This used to matter doubly for hits on the PLAYER's own ship, where the pilot camera sits
// at that same center in first-person view, so a near-center impact origin put the spark burst
// essentially on top of the camera and blew the GPU spark shader's perspective size scaling out to
// cover the whole screen — see render/impactEffects.ts. resolveHits below now skips onImpact
// entirely for player-hull hits, so that case no longer reaches this function at all; it's kept
// here for enemy/celestial hits, where projecting onto the surface still keeps sparks looking like
// they struck the hull rather than floating inside it.) Project back onto the hull surface so the
// effect always spawns at a consistent `radius` distance from center, regardless of how close to
// dead-center the shot was.
function hullSurfaceImpact(hit: Vec3, center: Vec3, radius: number): [Vec3, Vec3] {
  const toHit = sub(hit, center);
  // A hit landing exactly at (or within floating-point noise of) dead-center makes the direction to
  // project along undefined — normalize()'s own zero-length fallback returns a zero vector here, not
  // a unit one, which would leave the "surface" point right back at center. Rare (a real shot is
  // never bit-exact on the center), but arbitrarily pick a fixed direction rather than let that
  // degenerate case slip through.
  const normal = dot(toHit, toHit) < 1e-9 ? { x: 0, y: 1, z: 0 } : normalize(toHit);
  return [add(center, scale(normal, radius)), normal];
}

// Enemy-owned rounds damage the player ship, player-owned rounds damage whichever alive enemy their
// path crosses. Consumed rounds are removed. Generic over the `enemies` array so more opponents
// later needs no changes here. `onImpact` fires at the contact point for every landed hit (both
// sides), so the caller can spawn a hit spark there — see combat/effects.ts.
export function resolveHits(
  projectiles: Projectile[],
  playerShip: ShipBody,
  enemies: EnemyShip[],
  onEnemyHit?: (enemy: EnemyShip) => void,
  onEnemyDestroyed?: (enemy: EnemyShip) => void,
  onPlayerHit?: () => void,
  onImpact?: (pos: Vec3, normal: Vec3) => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];

    if (pr.owner === 'enemy') {
      if (playerShip.health.points > 0) {
        const hit = sweepHitsSphere(pr.prevPos, pr.pos, playerShip.pos, playerShip.type.hullRadius);
        if (hit) {
          applyDamage(playerShip.health, WEAPON_DAMAGE);
          playerShip.hitFlash = 1;
          onPlayerHit?.();
          // Deliberately no onImpact() here: a hit on the player's OWN hull would spawn the GPU
          // spark burst just ~hullRadius in front of the pilot camera (see hullSurfaceImpact), which
          // in a head-on merge could stack many near-camera additive bursts into a screen-covering
          // whiteout + fill-rate framerate hit. The HUD's red damage-flash (ship.hitFlash, hud.ts)
          // already tells the player they were hit; no need to also render sparks in their own face.
          projectiles.splice(i, 1);
        }
      }
      continue;
    }

    for (const enemy of enemies) {
      if (enemy.respawnTimer > 0 || enemy.health.points <= 0) continue;
      const hit = sweepHitsSphere(pr.prevPos, pr.pos, enemy.pos, enemy.type.hullRadius);
      if (hit) {
        const destroyed = applyDamage(enemy.health, WEAPON_DAMAGE);
        onEnemyHit?.(enemy);
        if (destroyed) onEnemyDestroyed?.(enemy);
        onImpact?.(...hullSurfaceImpact(hit, enemy.pos, enemy.type.hullRadius));
        projectiles.splice(i, 1);
        break;
      }
    }
  }
}

// Projectile-vs-celestial-body: any round (either owner) that enters a body's radius is consumed and
// reports an impact at its position, so firing at the moon/planet/etc. shows a hit spark instead of
// the round silently passing through. Separate from resolveHits since bodies take no damage and the
// player/enemy checks are hull-sphere, not body-radius. Call after resolveHits so a round that hit a
// ship this frame is already gone.
export function resolveObjectHits(
  projectiles: Projectile[],
  bodies: CelestialBody[],
  onImpact?: (pos: Vec3, normal: Vec3) => void
): void {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    for (const body of bodies) {
      const hit = sweepHitsSphere(pr.prevPos, pr.pos, body.pos, body.radius);
      if (hit) {
        onImpact?.(...hullSurfaceImpact(hit, body.pos, body.radius));
        projectiles.splice(i, 1);
        break;
      }
    }
  }
}
