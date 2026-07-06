// Standalone "PIP Trainer" — deliberately NOT built on EnemyShip/ScenarioConfig/hitDetection.
// Players asked for a bare, ESP-style PIP to flick/track onto, not a physically simulated
// opponent ship — see the Evasive Pilot drill (combat/enemyAI.ts's evasiveThink) for that heavier
// approach, which this intentionally skips. This is just a point mass with capped acceleration
// (so its motion still reads as inertial rather than teleporting) plus a hold-to-score timer.
import type { Ship, Vec3 } from '../types';
import { clamp, normalize } from '../math/vec';
import { computeAxes } from '../math/quaternion';

export interface PipTrainerOptions {
  speed: number;              // m/s — the pip's top commanded velocity
  randomness: number;         // 0..1 — higher = shorter, sharper direction changes ("wiggle")
  holdDurationSec: number;    // seconds of continuous aim required to score a rep (0.001..2 range)
  avoidDegrees: number;       // degrees of boresight standoff the pip actively flees to maintain,
                               // 0 disables this entirely (pure random wander, old behavior)
  durationSec: number | null; // drill length; null = indefinite, same convention as other drills
}

export const PIP_TRAINER_DEFAULTS: PipTrainerOptions = {
  speed: 120, randomness: 0.5, holdDurationSec: 0.3, avoidDegrees: 6, durationSec: 120
};

// Meters ahead of the player's nose the pip's home point is anchored at spawn — fixed in world
// space for the whole drill (not re-centered on the player every tick), same convention as
// combat/enemyAI.ts's OrbitState.center.
const ANCHOR_DISTANCE = 300;
// Meters — how far the pip may wander from its anchor before a centering pull kicks in.
const WANDER_RADIUS = 45;
// Seconds between fresh random-direction commands at randomness=0 / randomness=1 — interpolated
// by the randomness knob, then jittered per-pick so it doesn't read as a metronome.
const MAX_DECISION_INTERVAL = 1.1;
const MIN_DECISION_INTERVAL = 0.15;
// Radians — how tight the player's nose must be on the pip to count as "aimed", matching the
// turret drills' AIM_FIRE_CONE_RAD convention (scenarios/runtime.ts).
const AIM_CONE_RAD = 0.05;
// Seconds the score-flash ring takes to fade after a rep completes — see render.ts.
export const SCORE_FLASH_DURATION = 0.25;

export interface PipTrainerState {
  anchor: Vec3;
  pos: Vec3;
  vel: Vec3;
  targetVel: Vec3;
  decisionTimer: number;
  holdTimer: number;   // seconds the player's nose has been continuously on the pip
  elapsedSec: number;
  reps: number;        // successful holds completed
  scoreFlash: number;  // seconds remaining on the "just scored" ring, 0 = none
  outcome: 'active' | 'won';
}

function vsub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function vadd(a: Vec3, b: Vec3): Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function vscale(a: Vec3, s: number): Vec3 { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function vlen(a: Vec3): number { return Math.hypot(a.x, a.y, a.z); }
function vdot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }

// Uniform-on-sphere direction sample (Archimedes' hat-box), so jink directions aren't biased
// toward the poles the way naive per-axis-random-then-normalize sampling would be.
function randomUnitVec3(): Vec3 {
  const u = Math.random() * 2 - 1;
  const theta = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  return { x: r * Math.cos(theta), y: r * Math.sin(theta), z: u };
}

export function startPipTrainer(player: Ship): PipTrainerState {
  const { forward } = computeAxes(player.quat);
  const anchor = vadd(player.pos, vscale(forward, ANCHOR_DISTANCE));
  return {
    anchor,
    pos: { ...anchor },
    vel: { x: 0, y: 0, z: 0 },
    targetVel: { x: 0, y: 0, z: 0 },
    decisionTimer: 0,
    holdTimer: 0,
    elapsedSec: 0,
    reps: 0,
    scoreFlash: 0,
    outcome: 'active'
  };
}

function pickNewTargetVelocity(opts: PipTrainerOptions): Vec3 {
  const magnitude = opts.speed * (0.3 + 0.7 * Math.random());
  return vscale(randomUnitVec3(), magnitude);
}

export function updatePipTrainer(state: PipTrainerState, opts: PipTrainerOptions, player: Ship, dt: number): void {
  if (state.outcome !== 'active') return;
  state.elapsedSec += dt;
  if (state.scoreFlash > 0) state.scoreFlash = Math.max(0, state.scoreFlash - dt);

  state.decisionTimer -= dt;
  if (state.decisionTimer <= 0) {
    state.targetVel = pickNewTargetVelocity(opts);
    const interval = MAX_DECISION_INTERVAL - (MAX_DECISION_INTERVAL - MIN_DECISION_INTERVAL) * clamp(opts.randomness, 0, 1);
    state.decisionTimer = interval * (0.6 + 0.8 * Math.random());
  }

  const { forward, right, up } = computeAxes(player.quat);
  const toPipBefore = vsub(state.pos, player.pos);
  const toPipBeforeDist = vlen(toPipBefore);

  // Crosshair avoidance: once the player's boresight comes within avoidDegrees of the pip, flee
  // along the lateral direction away from the boresight ray instead of following the random jink
  // — this is what stops the pip from passively sitting on (or drifting into) the crosshair; it
  // has to be actively chased down, not just waited out. Takes priority over the anchor cage below.
  let avoiding = false;
  const avoidRad = (opts.avoidDegrees * Math.PI) / 180;
  if (avoidRad > 0 && toPipBeforeDist > 1e-6) {
    const alongBoresight = vscale(forward, vdot(toPipBefore, forward));
    const lateral = vsub(toPipBefore, alongBoresight); // component of toPip perpendicular to boresight
    const lateralLen = vlen(lateral);
    // linear standoff radius equivalent to avoidRad at the pip's current range — small-angle
    // approx (tan ~ angle) is plenty accurate for the few-degree range this is tuned for
    const avoidRadiusAtRange = toPipBeforeDist * Math.tan(avoidRad);
    if (lateralLen < avoidRadiusAtRange) {
      avoiding = true;
      // flee within the plane perpendicular to the boresight — never straight along it — so it's
      // always actually opening the aim angle, not just changing range. If it's sitting dead-on
      // (lateralLen ~ 0) there's no defined lateral direction yet, so pick a fresh random one in
      // that same plane rather than leaving it stuck with a zero vector.
      const fleeDir = lateralLen > 1e-3
        ? vscale(lateral, 1 / lateralLen)
        : (() => { const a = Math.random() * Math.PI * 2; return vadd(vscale(right, Math.cos(a)), vscale(up, Math.sin(a))); })();
      const overshoot = 1 - clamp(lateralLen / avoidRadiusAtRange, 0, 1); // 1 = dead-on, 0 = at the edge
      state.targetVel = vscale(fleeDir, opts.speed * (0.6 + 0.4 * overshoot));
    }
  }

  // Soft cage: once past WANDER_RADIUS from the anchor, blend the commanded velocity toward
  // straight back to center so the pip settles back into view instead of wandering off forever —
  // a proportional blend, not a hard clamp, so the correction stays physically continuous. Skipped
  // while actively fleeing the crosshair — pulling toward the anchor and away from the boresight
  // at the same time can fight itself into a dead stall right where both zones overlap.
  if (!avoiding) {
    const offset = vsub(state.pos, state.anchor);
    const dist = vlen(offset);
    if (dist > WANDER_RADIUS) {
      const inward = vscale(normalize(offset), -opts.speed);
      const overshoot = clamp((dist - WANDER_RADIUS) / WANDER_RADIUS, 0, 1);
      state.targetVel = vadd(vscale(state.targetVel, 1 - overshoot), vscale(inward, overshoot));
    }
  }

  // Accel-limited approach to the commanded velocity — jerk-capped so it reads as inertial motion
  // (accelerating/decelerating) rather than snapping directly to a new heading. Higher randomness
  // also raises the accel cap, so a high setting can still deliver a sharp "wiggle" flick rather
  // than just re-aiming a slow, smooth drift more often.
  const maxAccel = opts.speed * (1.5 + 5 * clamp(opts.randomness, 0, 1));
  const dv = vsub(state.targetVel, state.vel);
  const dvLen = vlen(dv);
  const step = maxAccel * dt;
  state.vel = dvLen <= step ? { ...state.targetVel } : vadd(state.vel, vscale(dv, step / dvLen));
  state.pos = vadd(state.pos, vscale(state.vel, dt));

  const toPip = vsub(state.pos, player.pos);
  const toPipDist = vlen(toPip);
  const aimed = toPipDist > 1e-6 &&
    Math.acos(clamp(vdot(toPip, forward) / toPipDist, -1, 1)) <= AIM_CONE_RAD;

  if (aimed) {
    state.holdTimer += dt;
    if (state.holdTimer >= opts.holdDurationSec) {
      state.reps++;
      state.holdTimer = 0;
      state.scoreFlash = SCORE_FLASH_DURATION;
      state.decisionTimer = 0; // force an immediate fresh jink right after a scored rep
    }
  } else {
    state.holdTimer = 0;
  }

  if (opts.durationSec !== null && state.elapsedSec >= opts.durationSec) {
    state.outcome = 'won';
  }
}
