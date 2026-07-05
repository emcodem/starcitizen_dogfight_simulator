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

// Effective pitch/yaw damping for a tick — dampening only kicks in while BOTH the PIP and the
// player's own stick (mouse-look's virtual joystick, or any other absolute-position input) sit
// inside the assist circle. Gating on the stick too matters: without it, slamming the stick to
// full deflection to snap onto a new target still got dampened the instant the PIP swept past
// center, robbing the player of full pitch/yaw authority exactly when they threw the biggest
// input. ESP is meant to steady fine tracking on a target you're already mostly on, not to
// override a deliberate large input.
export function dampingFactor(pipScreenDist: number, stickScreenDist: number): number {
  if (stickScreenDist >= circleRadiusPx) return 1;
  return dampingFactorForDistance(pipScreenDist);
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
