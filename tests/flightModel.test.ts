import { describe, it, expect } from 'vitest';
import { integrateFlight } from '../src/physics/flightModel';
import { makeShip } from '../src/ship/shipState';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import type { FlightBody, FlightInputs } from '../src/physics/flightModel';

function runToSteadyState(rawPitch: number, rawYaw: number, boosting: boolean): FlightBody {
  const ship = makeShip(SHIP_TYPES[0]);
  const body: FlightBody = {
    type: ship.type,
    pos: ship.pos,
    vel: ship.vel,
    quat: ship.quat,
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boosting,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
  };
  const input: FlightInputs = {
    throttle: 0,
    pitch: rawPitch,
    yaw: rawYaw,
    roll: 0,
    strafeX: 0,
    strafeY: 0,
    brake: false,
    decoupled: true,
  };
  for (let i = 0; i < 100; i++) integrateFlight(body, input, 0.016);
  return body;
}

describe('integrateFlight — combined-axis input normalization', () => {
  it('should scale down multi-axis input to keep magnitude ≤ 1', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    const body: FlightBody = {
      type: ship.type,
      pos: ship.pos,
      vel: ship.vel,
      quat: ship.quat,
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      boosting: false,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0,
    };

    const input: FlightInputs = {
      throttle: 0,
      pitch: 1,
      yaw: 1,
      roll: 1,
      strafeX: 0,
      strafeY: 0,
      brake: false,
      decoupled: true,
    };

    for (let i = 0; i < 100; i++) {
      integrateFlight(body, input, 0.016);
    }

    // After 100 ticks, angular velocity should settle to steady-state.
    // With full (1, 1, 1) normalized to magnitude 1, each axis should get
    // scaled by 1/√3 ≈ 0.577, so steady state should be roughly 0.577x
    // of the single-axis max. Each axis has its own maxAngVel, so:
    // pitch: 0.577 * 1.19 ≈ 0.687, yaw: 0.577 * 0.91 ≈ 0.525, roll: 0.577 * 3.49 ≈ 2.014
    const expectedPitch = 1.19 / Math.sqrt(3);
    const expectedYaw = 0.91 / Math.sqrt(3);
    const expectedRoll = 3.49 / Math.sqrt(3);
    expect(Math.abs(body.angVel.pitch - expectedPitch)).toBeLessThan(0.15);
    expect(Math.abs(body.angVel.yaw - expectedYaw)).toBeLessThan(0.15);
    expect(Math.abs(body.angVel.roll - expectedRoll)).toBeLessThan(0.15);

    // Combined magnitude should not exceed what it would have been without normalization.
    // Without normalization: full (1, 1, 1) reaches (1.19, 0.91, 3.49) → magnitude 3.63.
    // With normalization: each scaled by 1/√3 → (0.687, 0.525, 2.014) → magnitude 2.09.
    const combinedMag = Math.hypot(
      body.angVel.pitch,
      body.angVel.yaw,
      body.angVel.roll
    );
    expect(combinedMag).toBeLessThan(2.5); // generous margin above ~2.09 expected
  });

  it('should not scale up small combined input', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    const body: FlightBody = {
      type: ship.type,
      pos: ship.pos,
      vel: ship.vel,
      quat: ship.quat,
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      boosting: false,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0,
    };

    const input: FlightInputs = {
      throttle: 0,
      pitch: 0.3,
      yaw: 0.3,
      roll: 0,
      strafeX: 0,
      strafeY: 0,
      brake: false,
      decoupled: true,
    };

    for (let i = 0; i < 100; i++) {
      integrateFlight(body, input, 0.016);
    }

    // Magnitude of (0.3, 0.3, 0) is ~0.424, which is < 1, so no scaling.
    // Steady state should match single-axis 0.3 input: ~0.3 * maxAngVel.
    const expectedPitch = 0.3 * 1.19;
    const expectedYaw = 0.3 * 0.91;
    expect(Math.abs(body.angVel.pitch - expectedPitch)).toBeLessThan(0.05);
    expect(Math.abs(body.angVel.yaw - expectedYaw)).toBeLessThan(0.05);
  });

  it('should allow full single-axis input to reach its own max', () => {
    const ship = makeShip(SHIP_TYPES[0]);
    const body: FlightBody = {
      type: ship.type,
      pos: ship.pos,
      vel: ship.vel,
      quat: ship.quat,
      angVel: { pitch: 0, yaw: 0, roll: 0 },
      boosting: false,
      throttleSpoolTime: 0,
      verticalSpoolTime: 0,
    };

    const input: FlightInputs = {
      throttle: 0,
      pitch: 1,
      yaw: 0,
      roll: 0,
      strafeX: 0,
      strafeY: 0,
      brake: false,
      decoupled: true,
    };

    for (let i = 0; i < 100; i++) {
      integrateFlight(body, input, 0.016);
    }

    // Single-axis full input (1) has magnitude 1, so no scaling.
    // Pitch should settle at maxAngVel.pitch = 1.19 rad/s.
    expect(Math.abs(body.angVel.pitch - 1.19)).toBeLessThan(0.15);
    expect(Math.abs(body.angVel.yaw)).toBeLessThan(0.05);
    expect(Math.abs(body.angVel.roll)).toBeLessThan(0.05);
  });
});

describe('integrateFlight — pitch/yaw angle sweep (0°/45°/90°, normal & boosted)', () => {
  const gladius = SHIP_TYPES[0];

  // rawPitch/rawYaw model the control scheme's actual output: full deflection (1) on each
  // active axis, not a pre-normalized unit vector — integrateFlight itself normalizes the
  // combined (1,1) diagonal down to the shared RCS budget (see flightModel.ts's inputScale).
  // This mirrors holding two rotation keys together, e.g. pitch-down + yaw-right.
  const angles = [
    { label: '0° (pure pitch)', rawPitch: 1, rawYaw: 0 },
    { label: '45° (pitch+yaw)', rawPitch: 1, rawYaw: 1 },
    { label: '90° (pure yaw)', rawPitch: 0, rawYaw: 1 },
  ];

  // integrateFlight computes drag from the angVel each tick STARTED with, so full sustained
  // input converges to the continuous fixed point input * maxAngVel regardless of frame rate —
  // 100 ticks is comfortably enough for the exponential approach to fully converge.
  function expectedSteadyState(rawInput: number, scale: number, maxAngVel: number): number {
    return rawInput * scale * maxAngVel;
  }

  it.each(angles)('normal: $label', ({ rawPitch, rawYaw }) => {
    const body = runToSteadyState(rawPitch, rawYaw, false);
    const inputMag = Math.hypot(rawPitch, rawYaw);
    const scale = inputMag > 1 ? 1 / inputMag : 1;
    const expectedPitch = expectedSteadyState(rawPitch, scale, gladius.maxAngVel.pitch);
    const expectedYaw = expectedSteadyState(rawYaw, scale, gladius.maxAngVel.yaw);
    expect(Math.abs(body.angVel.pitch - expectedPitch)).toBeLessThan(0.005);
    expect(Math.abs(body.angVel.yaw - expectedYaw)).toBeLessThan(0.005);
  });

  it.each(angles)('boosted: $label', ({ rawPitch, rawYaw }) => {
    const body = runToSteadyState(rawPitch, rawYaw, true);
    const inputMag = Math.hypot(rawPitch, rawYaw);
    const scale = inputMag > 1 ? 1 / inputMag : 1;
    // boost reuses the same angularDrag as normal flight — only authority/ceiling change (see shipTypes.ts)
    const expectedPitch = expectedSteadyState(rawPitch, scale, gladius.boostMaxAngVel.pitch);
    const expectedYaw = expectedSteadyState(rawYaw, scale, gladius.boostMaxAngVel.yaw);
    expect(Math.abs(body.angVel.pitch - expectedPitch)).toBeLessThan(0.005);
    expect(Math.abs(body.angVel.yaw - expectedYaw)).toBeLessThan(0.005);
  });

  it('combined rotation-rate magnitude at 45° stays below either single-axis max (shared RCS budget)', () => {
    const normal = runToSteadyState(1, 1, false);
    const boosted = runToSteadyState(1, 1, true);
    const normalMag = Math.hypot(normal.angVel.pitch, normal.angVel.yaw);
    const boostedMag = Math.hypot(boosted.angVel.pitch, boosted.angVel.yaw);
    expect(normalMag).toBeLessThan(gladius.maxAngVel.pitch);
    expect(boostedMag).toBeLessThan(gladius.boostMaxAngVel.pitch);
  });
});
