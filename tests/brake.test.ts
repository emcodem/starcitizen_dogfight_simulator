import { describe, it, expect, afterEach } from 'vitest';
import { step } from '../src/physics/step';
import { makeShip } from '../src/ship/shipState';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import { keys } from '../src/input/controlsModule';

afterEach(() => {
  for (const code of Object.keys(keys)) keys[code] = false;
});

// Identity orientation: forward == +Z, right == +X, up == -Y (see math/quaternion.ts convention)
describe('space brake', () => {
  // decoupled mode isolates the brake's own effect from the (irrelevant, here) absence of drag —
  // coupled-mode braking uses the exact same formula, since the passive linear drag is skipped
  // while actively braking (see the "matches decoupled braking" test at the bottom of this file);
  // otherwise drag stacked on top of the brake's own thrust-based decel and let a full brake stop
  // the ship harder than its strongest thruster could ever accelerate it.

  it('decelerates forward motion using retro thrust / mass, not a fixed decay constant', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    ship.vel = { x: 0, y: 0, z: 50 };
    keys['KeyX'] = true; // default spaceBrake keybind
    const dt = 0.01; // small enough that retro thrust/mass*dt doesn't clamp to zero (see below)
    step(ship, dt);
    const expectedDelta = (ship.type.linearThrust.retro / ship.type.mass) * dt;
    expect(ship.vel.z).toBeCloseTo(50 - expectedDelta, 3);
  });

  it('decelerates backward motion using main thrust / mass (asymmetric with forward braking)', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    ship.vel = { x: 0, y: 0, z: -50 };
    keys['KeyX'] = true;
    const dt = 0.01;
    step(ship, dt);
    const expectedDelta = (ship.type.linearThrust.main / ship.type.mass) * dt;
    expect(ship.vel.z).toBeCloseTo(-50 + expectedDelta, 3);
  });

  it('never overshoots past zero into the opposite direction in a single frame', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    ship.vel = { x: 0, y: 0, z: 0.001 }; // tiny residual velocity
    keys['KeyX'] = true;
    step(ship, 1); // huge dt relative to how little velocity there is to kill
    expect(ship.vel.z).toBe(0);
  });

  it('brakes diagonal (lateral+vertical) motion as one combined-axis maneuver, preserving direction', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    ship.vel = { x: 30, y: -20, z: 0 }; // right (+X) and up (-Y, per axis convention)
    keys['KeyX'] = true;
    const dt = 0.05;
    const originalRatio = ship.vel.x / -ship.vel.y; // lateral:vertical direction, before braking
    step(ship, dt);

    // Local-frame (lateral=+30, vertical=+20 — moving up uses the weaker down-thruster to brake).
    // The flight computer can't push each axis at its own independent max without bending the
    // resultant velocity off its original heading, so the weaker-relative axis (vertical, here)
    // throttles the whole maneuver down below what either axis could do alone.
    const speed = Math.hypot(30, 20);
    const ux = 30 / speed, uy = 20 / speed;
    const strafeAccel = ship.type.linearThrust.strafe / ship.type.mass;
    const verticalAccel = ship.type.linearThrust.verticalDown / ship.type.mass;
    const maxDecel = Math.min(strafeAccel / ux, verticalAccel / uy);
    const newSpeed = speed - maxDecel * dt;

    expect(ship.vel.x).toBeCloseTo(ux * newSpeed, 3);
    expect(ship.vel.y).toBeCloseTo(-(uy * newSpeed), 3);
    // direction is preserved exactly — only the magnitude shrinks
    expect(ship.vel.x / -ship.vel.y).toBeCloseTo(originalRatio, 6);
    // combining axes to stay on-heading costs total stopping power vs. braking each axis at its
    // own independent max (the old, direction-bending behavior) — that would have applied a
    // combined vector of hypot(strafeAccel, verticalAccel), always >= this single scalar maxDecel
    expect(maxDecel).toBeLessThan(Math.hypot(strafeAccel, verticalAccel));
  });

  it('matches decoupled braking exactly — passive coupled-mode drag is skipped while braking', () => {
    const ship = makeShip(SHIP_TYPES[0]); // decoupled: false, by default
    ship.vel = { x: 0, y: 0, z: 50 };
    keys['KeyX'] = true;
    const dt = 0.01;
    step(ship, dt);
    const expectedDelta = (ship.type.linearThrust.retro / ship.type.mass) * dt;
    // same result as the decoupled case above — brake alone determines deceleration, never harder
    // than the ship's own thrust rating for that axis
    expect(ship.vel.z).toBeCloseTo(50 - expectedDelta, 3);
  });

  it('does nothing when not engaged', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.vel = { x: 0, y: 0, z: 50 };
    // no brake key held, and decoupled so the normal coupled-mode drag doesn't interfere
    ship.decoupled = true;
    step(ship, 0.1);
    expect(ship.vel.z).toBeCloseTo(50, 3);
  });
});
