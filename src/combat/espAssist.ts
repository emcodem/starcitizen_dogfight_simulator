// =====================================================================
// ESP — "Enhanced Stick Precision"-style aim assist. Always active: whenever the crosshair's
// current lead-indicator (see combat/pipTargeting.ts) falls within a configurable circle around
// screen center, yaw/pitch input is dampened the closer it gets to dead center. This is meant to
// curb overshoot when sweeping onto a fast-moving target, not to aim for the player — outside the
// circle, input passes through completely unmodified.
// =====================================================================

import { registerConfig } from '../input/configRegistry';

let circleRadiusPx = 45; // px around screen center — smaller than the mouse-look reticle circle
let dampeningStrength = 0.7; // 0..1 — fraction of input speed removed at dead center

export function getCircleRadius(): number {
  return circleRadiusPx;
}
export function setCircleRadius(v: number): void {
  circleRadiusPx = v;
}
export function getDampeningStrength(): number {
  return dampeningStrength;
}
export function setDampeningStrength(v: number): void {
  dampeningStrength = v;
}

// 1 = no dampening (at/beyond the circle radius), ramping linearly down to (1 - dampeningStrength)
// at dead center.
export function dampingFactorForDistance(screenDist: number): number {
  if (screenDist >= circleRadiusPx || circleRadiusPx <= 0) return 1;
  const proximity = 1 - screenDist / circleRadiusPx; // 0 at edge, 1 at center
  return 1 - dampeningStrength * proximity;
}

interface EspConfig {
  circleRadiusPx: number;
  dampeningStrength: number;
}
registerConfig({
  key: 'esp',
  serialize: (): EspConfig => ({ circleRadiusPx, dampeningStrength }),
  deserialize: data => {
    const d = data as Partial<EspConfig> | null | undefined;
    if (!d) return;
    if (typeof d.circleRadiusPx === 'number') circleRadiusPx = d.circleRadiusPx;
    if (typeof d.dampeningStrength === 'number') dampeningStrength = d.dampeningStrength;
  }
});
