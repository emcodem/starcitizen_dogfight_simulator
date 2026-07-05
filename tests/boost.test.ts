import { describe, it, expect, afterEach } from 'vitest';
import { step } from '../src/physics/step';
import { makeShip } from '../src/ship/shipState';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import { keys } from '../src/input/controlsModule';
import { setStationActive } from '../src/world/station';

afterEach(() => {
  // ControlsModule.keys is a module-level singleton — reset it so tests don't leak state
  for (const code of Object.keys(keys)) keys[code] = false;
});

describe('boost meter', () => {
  it('starts full', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    expect(ship.boostMeter).toBe(ship.type.boostCapacity);
  });

  it('drains while boost is held, and marks the ship as boosting', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    keys['ShiftLeft'] = true; // default boost keybind
    step(ship, 1);
    expect(ship.boosting).toBe(true);
    expect(ship.boostMeter).toBeCloseTo(ship.type.boostCapacity - 1, 5);
  });

  it('recharges while not boosting, capped at capacity', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.boostMeter = 0;
    step(ship, 100); // way more than enough time to fully recharge
    expect(ship.boosting).toBe(false);
    expect(ship.boostMeter).toBe(ship.type.boostCapacity);
  });

  it('cannot go boosting once the meter is empty, even while the key is held', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.boostMeter = 0;
    keys['ShiftLeft'] = true;
    step(ship, 0.016);
    expect(ship.boosting).toBe(false);
    // holding the (currently ineffective) boost key doesn't block regen — it starts
    // recharging immediately once there's nothing left to drain
    expect(ship.boostMeter).toBeGreaterThan(0);
  });
});

describe('boosted speed cap', () => {
  it('raises the coupled-mode speed cap above scmSpeed while boosting', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    const highSpeed = (ship.type.scmSpeed + ship.type.boostSpeedForward) / 2; // between the two caps
    ship.vel = { x: 0, y: 0, z: highSpeed };
    keys['ShiftLeft'] = true;
    step(ship, 0.016);
    const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    expect(speed).toBeGreaterThan(ship.type.scmSpeed);
  });

  it('boosted thrust actually accelerates the ship past scmSpeed in coupled mode', () => {
    // regression guard: boosting used to only raise the speed *cap*, leaving thrust unchanged —
    // since drag makes unboosted thrust settle at exactly scmSpeed by construction, the ship could
    // never actually reach a speed where the higher cap mattered
    setStationActive(false); // flying forward for 5s would otherwise crash straight into it
    const ship = makeShip(SHIP_TYPES[0]);
    keys['KeyW'] = true; // default strafeForward keybind — step() derives throttle from this each tick
    keys['ShiftLeft'] = true;
    for (let i = 0; i < 300; i++) step(ship, 1 / 60); // 5s — the full boost meter
    setStationActive(true);
    const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    expect(speed).toBeGreaterThan(ship.type.scmSpeed);
  });

  it('bleeds excess speed back down toward scmSpeed gradually, not instantly, when not boosting', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    const highSpeed = (ship.type.scmSpeed + ship.type.boostSpeedForward) / 2;
    ship.vel = { x: 0, y: 0, z: highSpeed };
    step(ship, 0.016);
    const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    // a single small tick shouldn't have snapped all the way down to the cap already
    expect(speed).toBeLessThan(highSpeed);
    expect(speed).toBeGreaterThan(ship.type.scmSpeed);
  });

  it('uses the lower reverse-speed cap when flying backward relative to the ship\'s nose', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    // identity orientation: forward == +Z, so negative Z velocity is "backward"
    const highReverseSpeed = (ship.type.scmSpeedBack + ship.type.scmSpeed) / 2; // above scmSpeedBack, below scmSpeed
    ship.vel = { x: 0, y: 0, z: -highReverseSpeed };
    for (let i = 0; i < 600; i++) step(ship, 1 / 60); // let the gradual bleed-down actually reach the cap
    const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    expect(speed).toBeLessThanOrEqual(ship.type.scmSpeedBack + 1e-6);
  });

  it('still applies while decoupled — decoupling removes auto-damping drag, not the SCM/boost speed limiter', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    const highSpeed = (ship.type.scmSpeed + ship.type.boostSpeedForward) / 2;
    ship.vel = { x: 0, y: 0, z: highSpeed };
    for (let i = 0; i < 600; i++) step(ship, 1 / 60); // no boost key held; let the bleed-down finish
    const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    expect(speed).toBeLessThanOrEqual(ship.type.scmSpeed + 1e-6);
  });

  it('lets a decoupled boost exceed scmSpeed, then bleeds back down gradually — not instantly — once boost ends', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    ship.decoupled = true;
    const highSpeed = (ship.type.scmSpeed + ship.type.boostSpeedForward) / 2;
    ship.vel = { x: 0, y: 0, z: highSpeed };
    keys['ShiftLeft'] = true;
    step(ship, 0.016);
    expect(Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z)).toBeGreaterThan(ship.type.scmSpeed);

    keys['ShiftLeft'] = false;
    step(ship, 0.016);
    const speedRightAfter = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    // still bleeding down, like a brake — not snapped straight to the cap in one frame
    expect(speedRightAfter).toBeGreaterThan(ship.type.scmSpeed);

    for (let i = 0; i < 600; i++) step(ship, 1 / 60); // plenty of time for the bleed-down to finish
    const speedEventually = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    expect(speedEventually).toBeLessThanOrEqual(ship.type.scmSpeed + 1e-6);
  });
});

describe('boosted rotation-rate cap', () => {
  it('raises the pitch rate ceiling above maxAngVel while boosting', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    const highRate = (ship.type.maxAngVel.pitch + ship.type.boostMaxAngVel.pitch) / 2; // between the two caps
    ship.angVel.pitch = highRate;
    keys['ShiftLeft'] = true;
    step(ship, 0.001); // tiny dt so drag barely nudges it, isolating the clamp behavior
    expect(ship.angVel.pitch).toBeGreaterThan(ship.type.maxAngVel.pitch);
  });

  it('still clamps pitch rate to maxAngVel when not boosting', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    const highRate = (ship.type.maxAngVel.pitch + ship.type.boostMaxAngVel.pitch) / 2;
    ship.angVel.pitch = highRate;
    step(ship, 0.001);
    expect(ship.angVel.pitch).toBeLessThanOrEqual(ship.type.maxAngVel.pitch + 1e-6);
  });
});
