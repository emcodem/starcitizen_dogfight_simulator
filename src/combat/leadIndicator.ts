import type { Vec3 } from '../types';

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Solves the standard firing-solution intercept problem and returns the world point the shooter
// should aim their reticle at to hit `targetPos`/`targetVel` with a shot exiting at
// `projectileSpeed` — accounting for the shooter's own velocity, since projectiles here inherit
// it (see world/weapons.ts spawnProjectileFrom). Works for a moving shooter and/or moving target,
// so it stays valid for a future scenario with a maneuvering opponent, not just a stationary one.
// Returns null when no real intercept exists (e.g. the target can outrun the projectile).
export function computeLeadPoint(
  shooterPos: Vec3,
  shooterVel: Vec3,
  targetPos: Vec3,
  targetVel: Vec3,
  projectileSpeed: number
): Vec3 | null {
  const r = sub(targetPos, shooterPos);
  const vRel = sub(targetVel, shooterVel);

  const a = dot(vRel, vRel) - projectileSpeed * projectileSpeed;
  const b = 2 * dot(r, vRel);
  const c = dot(r, r);

  let t: number | null = null;
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-9) return null;
    const candidate = -c / b;
    if (candidate > 1e-6) t = candidate;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);
    const positives = [t1, t2].filter(x => x > 1e-6);
    if (positives.length === 0) return null;
    t = Math.min(...positives);
  }
  if (t === null) return null;

  return {
    x: targetPos.x + vRel.x * t,
    y: targetPos.y + vRel.y * t,
    z: targetPos.z + vRel.z * t
  };
}
