import type { Health } from '../types';

export function createHealth(maxPoints: number): Health {
  return { points: maxPoints, maxPoints };
}

// Subtracts `amount` points (default 1 — a plain "hit counts as one hit" rule for now). Returns
// true once this call brings points to 0 or below, i.e. the target is destroyed. `amount` exists
// so a future per-weapon damage value plugs in here without changing this function's shape.
export function applyDamage(health: Health, amount = 1): boolean {
  health.points = Math.max(0, health.points - amount);
  return health.points <= 0;
}
