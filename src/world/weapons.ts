import type { Ship, Vec3, Projectile } from '../types';
import { computeAxes } from '../math/quaternion';

// ---------- Weapons — traveling projectiles, visuals only for now (no hit detection yet) ----------
export const WEAPON = {
  muzzleSpeed: 1400,   // m/s, added on top of the ship's own velocity (matches SC-style ballistics)
  fireRate: 10,        // rounds per second while the trigger is held
  lifetime: 2.5,       // seconds before a round despawns
  muzzleForward: 3,    // spawn offset ahead of the camera so tracers don't clip through it
  muzzleRight: 1.1,    // alternating left/right muzzle offset, purely visual (twin-gun look)
  muzzleDown: 0.6
};

export const projectiles: Projectile[] = [];

let firing = false;
let fireCooldown = 0;
let muzzleAlternate = 1; // flips between -1/1 each shot

export function setFiring(value: boolean): void {
  firing = value;
}

function spawnProjectile(ship: Ship, forward: Vec3, right: Vec3, up: Vec3): void {
  const mx = right.x * (muzzleAlternate * WEAPON.muzzleRight) - up.x * WEAPON.muzzleDown + forward.x * WEAPON.muzzleForward;
  const my = right.y * (muzzleAlternate * WEAPON.muzzleRight) - up.y * WEAPON.muzzleDown + forward.y * WEAPON.muzzleForward;
  const mz = right.z * (muzzleAlternate * WEAPON.muzzleRight) - up.z * WEAPON.muzzleDown + forward.z * WEAPON.muzzleForward;
  projectiles.push({
    pos: { x: ship.pos.x + mx, y: ship.pos.y + my, z: ship.pos.z + mz },
    vel: {
      x: ship.vel.x + forward.x * WEAPON.muzzleSpeed,
      y: ship.vel.y + forward.y * WEAPON.muzzleSpeed,
      z: ship.vel.z + forward.z * WEAPON.muzzleSpeed
    },
    age: 0
  });
  muzzleAlternate *= -1;
}

export function updateProjectiles(dt: number, ship: Ship): void {
  if (firing && fireCooldown <= 0) {
    const { forward, right, up } = computeAxes(ship.quat);
    spawnProjectile(ship, forward, right, up);
    fireCooldown = 1 / WEAPON.fireRate;
  }
  fireCooldown -= dt;

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.pos.x += pr.vel.x * dt;
    pr.pos.y += pr.vel.y * dt;
    pr.pos.z += pr.vel.z * dt;
    pr.age += dt;
    if (pr.age > WEAPON.lifetime) projectiles.splice(i, 1);
  }
}
