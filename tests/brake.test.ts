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
    const dt = 0.1;
    step(ship, dt);
    const expectedDelta = (ship.type.linearThrust.retro / ship.type.mass) * dt;
    expect(ship.vel.z).toBeCloseTo(50 - expectedDelta, 3);
  });

  it('decelerates backward motion using main thrust / mass (asymmetric with forward braking)', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    ship.vel = { x: 0, y: 0, z: -50 };
    keys['KeyX'] = true;
    const dt = 0.1;
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

  it('decelerates lateral and vertical motion using strafe/vertical thrust independently', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    ship.vel = { x: 30, y: -20, z: 0 }; // right (+X) and up (-Y, per axis convention)
    keys['KeyX'] = true;
    const dt = 0.05;
    step(ship, dt);
    const strafeDelta = (ship.type.linearThrust.strafe / ship.type.mass) * dt;
    const verticalDelta = (ship.type.linearThrust.vertical / ship.type.mass) * dt;
    expect(ship.vel.x).toBeCloseTo(30 - strafeDelta, 3);
    expect(ship.vel.y).toBeCloseTo(-20 + verticalDelta, 3);
  });

  it('matches decoupled braking exactly — passive coupled-mode drag is skipped while braking', () => {
    const ship = makeShip(SHIP_TYPES[0]); // decoupled: false, by default
    ship.vel = { x: 0, y: 0, z: 50 };
    keys['KeyX'] = true;
    const dt = 0.1;
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
