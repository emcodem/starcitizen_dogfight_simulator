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

  // At high speed the proportional brake controller (brakeGain * speed) exceeds the thruster
  // capacity, so decel saturates at the thruster rating — these tests exercise that saturated
  // regime (speeds well above the ~40 m/s crossover). The proportional easing near zero has its
  // own test further down.

  it('decelerates forward motion using retro thrust / mass, not a fixed decay constant', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    ship.vel = { x: 0, y: 0, z: 50 }; // 50 m/s: brakeGain*50 = 52 > retro cap (42), so cap governs
    keys['KeyX'] = true; // default spaceBrake keybind
    const dt = 0.01; // small enough that retro thrust/mass*dt doesn't clamp to zero (see below)
    step(ship, dt);
    const expectedDelta = (ship.type.linearThrust.retro / ship.type.mass) * dt;
    expect(ship.vel.z).toBeCloseTo(50 - expectedDelta, 3);
  });

  it('decelerates backward motion using main thrust / mass (asymmetric with forward braking)', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    // 200 m/s: brakeGain*200 = 208 > main cap (134), so the thruster cap governs (not proportional).
    // At the forward-brake speed of 50 the retro cap is far lower, so the same brake decelerates
    // backward motion much harder — the asymmetry this test is named for.
    ship.vel = { x: 0, y: 0, z: -200 };
    keys['KeyX'] = true;
    const dt = 0.01;
    step(ship, dt);
    const expectedDelta = (ship.type.linearThrust.main / ship.type.mass) * dt;
    expect(ship.vel.z).toBeCloseTo(-200 + expectedDelta, 3);
  });

  it('eases off proportionally near zero (velocity controller, not a flat thruster-rate decel)', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    // 20 m/s forward: below the ~40 m/s crossover, so brakeGain*speed (20.8 m/s^2) is weaker than
    // the retro cap (42) and governs instead — this is the long low-speed creep seen in the trace.
    ship.vel = { x: 0, y: 0, z: 20 };
    keys['KeyX'] = true;
    const dt = 0.01;
    step(ship, dt);
    const proportionalDelta = ship.type.brakeGain * 20 * dt;
    expect(ship.vel.z).toBeCloseTo(20 - proportionalDelta, 3);
    // strictly gentler than the flat retro-cap deceleration the old model applied all the way down
    const retroCapDelta = (ship.type.linearThrust.retro / ship.type.mass) * dt;
    expect(proportionalDelta).toBeLessThan(retroCapDelta);
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
    ship.vel = { x: 75, y: -50, z: 0 }; // right (+X) and up (-Y, per axis convention)
    keys['KeyX'] = true;
    const dt = 0.05;
    const originalRatio = ship.vel.x / -ship.vel.y; // lateral:vertical direction, before braking
    step(ship, dt);

    // Local-frame (lateral=+75, vertical=+50 — moving up uses the weaker down-thruster to brake).
    // The flight computer can't push each axis at its own independent max without bending the
    // resultant velocity off its original heading, so the weaker-relative axis (vertical, here)
    // throttles the whole maneuver down below what either axis could do alone.
    const speed = Math.hypot(75, 50);
    const ux = 75 / speed, uy = 50 / speed;
    const strafeAccel = ship.type.linearThrust.strafe / ship.type.mass;
    const verticalAccel = ship.type.linearThrust.verticalDown / ship.type.mass;
    const maxDecel = Math.min(strafeAccel / ux, verticalAccel / uy);
    // this speed is above the ~40 m/s crossover, so the thruster cap — not brakeGain*speed —
    // governs; assert that so the expected values below stay valid if brakeGain ever changes
    expect(ship.type.brakeGain * speed).toBeGreaterThan(maxDecel);
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
