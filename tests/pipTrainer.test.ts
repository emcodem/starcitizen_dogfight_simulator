import { describe, it, expect, vi, afterEach } from 'vitest';
import { startPipTrainer, updatePipTrainer, PIP_TRAINER_DEFAULTS } from '../src/combat/pipTrainer';
import { lookAtQuat } from '../src/math/quaternion';
import { createHealth } from '../src/combat/health';
import { SHIP_TYPES } from '../src/ship/shipTypes';
import type { Ship } from '../src/types';

function makePlayer(): Ship {
  return {
    type: SHIP_TYPES[0],
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    quat: lookAtQuat({ x: 0, y: 0, z: 1 }),
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    throttle: 0,
    decoupled: false,
    spaceBrakeOn: false,
    boostMeter: 0,
    boosting: false,
    boostCooldownTimer: 0,
    exploding: false,
    explosionTimer: 0,
    hitFlash: 0,
    throttleSpoolTime: 0,
    verticalSpoolTime: 0,
    health: createHealth(999)
  };
}

describe('pipTrainer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('spawns 300m directly ahead of the player nose', () => {
    const player = makePlayer();
    const state = startPipTrainer(player);
    expect(state.pos).toEqual({ x: 0, y: 0, z: 300 });
    expect(state.outcome).toBe('active');
    expect(state.reps).toBe(0);
  });

  it('scores a rep once the player holds boresight on the pip for holdDurationSec, then resets the timer', () => {
    const player = makePlayer();
    const state = startPipTrainer(player);
    // pin the pip dead ahead of the player's nose so "aimed" is always true regardless of its
    // own random jink — isolates the hold-timer logic from the motion model
    state.pos = { x: 0, y: 0, z: 300 };
    state.vel = { x: 0, y: 0, z: 0 };
    // speed: 0 freezes the motion model entirely, isolating the hold-timer logic from any drift
    // off boresight that the pip's own random jink would otherwise cause mid-hold
    const opts = { ...PIP_TRAINER_DEFAULTS, holdDurationSec: 0.1, speed: 0 };

    updatePipTrainer(state, opts, player, 0.05);
    expect(state.reps).toBe(0);
    expect(state.holdTimer).toBeCloseTo(0.05, 5);

    updatePipTrainer(state, opts, player, 0.06);
    expect(state.reps).toBe(1);
    expect(state.holdTimer).toBe(0);
  });

  it('resets the hold timer the instant the player looks away, instead of accumulating across gaps', () => {
    const player = makePlayer();
    const state = startPipTrainer(player);
    state.pos = { x: 0, y: 0, z: 300 };
    state.vel = { x: 0, y: 0, z: 0 };
    const opts = { ...PIP_TRAINER_DEFAULTS, holdDurationSec: 1, speed: 0 };

    updatePipTrainer(state, opts, player, 0.5);
    expect(state.holdTimer).toBeCloseTo(0.5, 5);

    // yank the pip far off boresight for one tick
    state.pos = { x: 5000, y: 5000, z: 300 };
    updatePipTrainer(state, opts, player, 1 / 60);
    expect(state.holdTimer).toBe(0);
    expect(state.reps).toBe(0);
  });

  it('ends the drill once elapsed time reaches durationSec, and never ends when durationSec is null', () => {
    const player = makePlayer();
    const finite = startPipTrainer(player);
    const finiteOpts = { ...PIP_TRAINER_DEFAULTS, durationSec: 1 };
    updatePipTrainer(finite, finiteOpts, player, 0.6);
    expect(finite.outcome).toBe('active');
    updatePipTrainer(finite, finiteOpts, player, 0.5);
    expect(finite.outcome).toBe('won');

    const indefinite = startPipTrainer(player);
    const indefiniteOpts = { ...PIP_TRAINER_DEFAULTS, durationSec: null };
    for (let i = 0; i < 600; i++) updatePipTrainer(indefinite, indefiniteOpts, player, 1 / 60);
    expect(indefinite.outcome).toBe('active');
  });

  it('moves with capped acceleration rather than teleporting to its new commanded velocity', () => {
    const player = makePlayer();
    const state = startPipTrainer(player);
    state.decisionTimer = 0;
    // avoidDegrees: 0 disables crosshair avoidance — the pip spawns dead-on boresight, which would
    // otherwise immediately override the mocked random jink below with a flee vector
    const opts = { ...PIP_TRAINER_DEFAULTS, speed: 100, randomness: 0, avoidDegrees: 0 };

    vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.5)   // u for randomUnitVec3
      .mockReturnValueOnce(0)     // theta for randomUnitVec3 -> direction along +x
      .mockReturnValueOnce(1)     // magnitude fraction -> full opts.speed
      .mockReturnValue(0.5);      // subsequent interval jitter calls

    updatePipTrainer(state, opts, player, 1 / 60);
    const speedAfterOneTick = Math.hypot(state.vel.x, state.vel.y, state.vel.z);
    // at randomness=0 the accel cap is 1.5x speed — over one 1/60s tick that's well under the
    // full 100 m/s commanded magnitude, proving it ramped rather than snapped
    expect(speedAfterOneTick).toBeGreaterThan(0);
    expect(speedAfterOneTick).toBeLessThan(100);
  });

  it('pulls the pip back toward its anchor once it wanders past the cage radius', () => {
    const player = makePlayer();
    const state = startPipTrainer(player);
    state.pos = { x: 0, y: 0, z: 300 + 200 }; // way outside the ~45m wander cage
    state.vel = { x: 0, y: 0, z: 0 };
    state.decisionTimer = 999; // no fresh jink this tick — isolate the cage's centering pull
    // avoidDegrees: 0 disables crosshair avoidance — this position is also dead-on boresight, which
    // would otherwise take priority over the cage and mask what this test is isolating
    const opts = { ...PIP_TRAINER_DEFAULTS, avoidDegrees: 0 };

    updatePipTrainer(state, opts, player, 1 / 60);
    // velocity should have gained a component back toward the anchor (negative z, since the pip
    // overshot on +z)
    expect(state.vel.z).toBeLessThan(0);
  });

  it('flees the crosshair once the player aims within avoidDegrees, rather than sitting still or drifting closer', () => {
    const player = makePlayer();
    const state = startPipTrainer(player);
    state.pos = { x: 0, y: 0, z: 300 }; // dead-on boresight
    state.vel = { x: 0, y: 0, z: 0 };
    state.decisionTimer = 999; // no fresh random jink — isolate the avoidance behavior
    const opts = { ...PIP_TRAINER_DEFAULTS, avoidDegrees: 10, speed: 100 };

    for (let i = 0; i < 30; i++) updatePipTrainer(state, opts, player, 1 / 60);

    // player sits at the origin facing +z (see makePlayer), so the boresight ray IS the z-axis —
    // perpendicular distance off it is just the x/y magnitude
    const lateral = Math.hypot(state.pos.x, state.pos.y);
    // it should have moved measurably off the boresight ray, not stayed pinned dead-center
    expect(lateral).toBeGreaterThan(1);
  });

  it('does not flee the crosshair when avoidDegrees is 0', () => {
    const player = makePlayer();
    const state = startPipTrainer(player);
    state.pos = { x: 0, y: 0, z: 300 }; // dead-on boresight, inside the cage too — nothing else should move it
    state.vel = { x: 0, y: 0, z: 0 };
    state.decisionTimer = 999;
    const opts = { ...PIP_TRAINER_DEFAULTS, avoidDegrees: 0, speed: 100 };

    updatePipTrainer(state, opts, player, 1 / 60);
    expect(state.vel).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.pos).toEqual({ x: 0, y: 0, z: 300 });
  });
});
