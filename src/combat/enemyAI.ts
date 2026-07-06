import type { AngularState, EnemyShip, EvasiveAIMemory, FighterAIMemory, FighterTuning, OrbitState, Quat, Ship, ShipType, Vec3 } from '../types';
import type { FlightInputs } from '../physics/flightModel';
import { integrateFlight } from '../physics/flightModel';
import { computeAxes, lookAtQuat, quatMultiply, rotateVecByQuat } from '../math/quaternion';
import { clamp, cross, normalize } from '../math/vec';
import { computeLeadPoint, closestApproachIfFiredNow } from './leadIndicator';
import { WEAPON } from '../world/weapons';

// ===========================================================================
// FighterAI — the 'fighter' EnemyShip behavior. Flies on the exact same RCS thrust model as the
// player (physics/flightModel.ts) instead of teleporting its nose onto the target like the
// stationary 'turret' drill, and runs a small state machine so it behaves like it's actually
// dogfighting rather than just tracking:
//
//   close      — too far to fight; burn straight at the player to close the gap
//   engage     — in the fight; hold a stand-off range and take deflection shots via computeLeadPoint
//   reposition — bad angle to the target; extend and loop back instead of trying to instantly
//                reverse (how much it commits to this vs. just fighting the turn is tuning-driven)
//   evade      — the player is on our six, close, and boresighted; jink off-axis and burn away
//
// Steering itself is a proportional controller on the quaternion error between the current and
// desired orientation (see steeringToward) — the vector part of that relative quaternion is,
// by construction, expressed in the same body-frame (pitch=x, yaw=y, roll=z) convention that
// integrateOrientation uses for angVel, so it drops straight in as stick input with no manual
// sign/axis guessing.
//
// All of the actual difficulty is data, not code — see FighterTuning (src/types.ts) and the two
// presets below. A scenario picks a preset (or a custom FighterTuning) per enemy spawn; this file
// has no hardcoded numbers, so a third difficulty tier is just a third preset object.
// ===========================================================================

// Confident, close-range dogfighter: fights through bad angles instead of running from them, only
// breaks off when genuinely gunned from behind, and gets back into the fight quickly.
export const FIGHTER_TUNING_ACE: FighterTuning = {
  steerGain: 7,
  engageRange: 450,
  engageBand: 120,
  closeRange: 1300,
  fireRange: 900,
  fireLateralTolerance: 10,
  overshootAngleRad: 2.7,        // ~155 degrees — only extends on a near-total reversal
  repositionExtendBias: 0.3,     // prioritizes turning back over running, on the rare occasion it does
  repositionBoost: true,
  threatRange: 700,
  threatConeRad: 0.22,           // ~13 degrees — only bails when precisely boresighted
  evadeMinSeconds: 1.2,
  modeCommitSeconds: 1.0,
  weaveFreq: 2.2
};

// Hesitant, long-range opponent: bails into a wide extend at the first bad angle, needs a clean
// setup to risk firing, and spooks easily. Pair with a physically slower-turning ship type (see
// scenarios/definitions.ts) for the full "rookie" effect.
export const FIGHTER_TUNING_ROOKIE: FighterTuning = {
  steerGain: 3,
  engageRange: 800,
  engageBand: 220,
  closeRange: 1300,
  fireRange: 800,
  fireLateralTolerance: 6,        // needs a much cleaner shot before it'll pull the trigger
  overshootAngleRad: 0.9,         // ~52 degrees — bails into reposition easily
  repositionExtendBias: 0.85,     // commits hard to running before circling back
  repositionBoost: true,
  threatRange: 1000,
  threatConeRad: 0.4,             // ~23 degrees — spooked by anything roughly pointed its way
  evadeMinSeconds: 3.5,
  modeCommitSeconds: 2.0,
  weaveFreq: 1.2
};

export interface FighterDecision {
  inputs: FlightInputs;
  boostRequested: boolean; // resolved against the boost meter by the caller (see physics/flightModel.ts)
  wantsToFire: boolean;    // true only while in 'engage' mode — see canFire for the actual aim gate
  aimDir: Vec3;            // world-space direction this tick's gun solution is aiming at
}

// Whether `forward` is aimed precisely enough at `aimDir`, at `dist` meters, to actually land a
// hit — not just "close enough" on a fixed angular cone. A few degrees of boresight error is tens
// of meters of lateral miss at gunnery range, so this gates on the *lateral miss distance* the
// current angular error implies, scaled by range, instead. Must be called with the enemy's
// orientation AFTER this tick's integrateFlight call (see scenarios/runtime.ts) — checking against
// the pre-rotation orientation would let a shot fire "aimed" at a direction the nose has already
// rotated past by the time the projectile actually leaves the muzzle.
export function canFireWithinTolerance(
  forward: Vec3,
  aimDir: Vec3,
  dist: number,
  fireRange: number,
  fireLateralTolerance: number
): boolean {
  if (dist > fireRange) return false;
  return dist * Math.tan(angleBetween(forward, aimDir)) <= fireLateralTolerance;
}

export function canFire(forward: Vec3, aimDir: Vec3, dist: number, tuning: FighterTuning): boolean {
  return canFireWithinTolerance(forward, aimDir, dist, tuning.fireRange, tuning.fireLateralTolerance);
}

// Proportional steering: how hard to push pitch/yaw/roll to turn `current` toward facing `dir`.
// `upHint` defaults to world-up (lookAtQuat's own default) — pass a specific up vector (e.g. the
// player's own up axis) to also converge the bank angle toward that instead, see evasiveThink.
function steeringToward(current: Quat, dir: Vec3, gain: number, upHint?: Vec3): { pitch: number; yaw: number; roll: number } {
  const target = upHint ? lookAtQuat(dir, upHint) : lookAtQuat(dir);
  const qConj: Quat = { w: current.w, x: -current.x, y: -current.y, z: -current.z };
  let rel = quatMultiply(qConj, target);
  if (rel.w < 0) rel = { w: -rel.w, x: -rel.x, y: -rel.y, z: -rel.z }; // shortest-path rotation
  return {
    pitch: clamp(rel.x * gain, -1, 1),
    yaw: clamp(rel.y * gain, -1, 1),
    roll: clamp(rel.z * gain, -1, 1)
  };
}

function angleBetween(a: Vec3, b: Vec3): number {
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(dot);
}

export function think(enemy: EnemyShip, ai: FighterAIMemory, player: Ship, dt: number): FighterDecision {
  const tuning = ai.tuning;
  ai.clock += dt;

  const toPlayer: Vec3 = {
    x: player.pos.x - enemy.pos.x,
    y: player.pos.y - enemy.pos.y,
    z: player.pos.z - enemy.pos.z
  };
  const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z);
  const toPlayerDir = normalize(toPlayer);

  const { forward: enemyForward } = computeAxes(enemy.quat);
  const { forward: playerForward } = computeAxes(player.quat);

  // is the player on our six, close, and boresighted? — triggers evasive maneuvering. Requiring
  // "behind us" (not just "pointed at us") matters: a head-on merge pass also has the player
  // pointed roughly at us, but that's a mutual gun pass, not a one-sided threat worth breaking off
  // for — real BFM only bails out from a guns-tracking-your-six situation.
  const toEnemyDir: Vec3 = { x: -toPlayerDir.x, y: -toPlayerDir.y, z: -toPlayerDir.z };
  const playerAimAngle = angleBetween(playerForward, toEnemyDir);
  const playerIsAstern = angleBetween(enemyForward, toPlayerDir) > Math.PI * 0.6; // ~108 degrees
  const threatened = dist < tuning.threatRange && playerAimAngle < tuning.threatConeRad && playerIsAstern;

  // lead point for our own gun solution — reused as "which way to point to actually hit it"
  const lead = computeLeadPoint(enemy.pos, enemy.vel, player.pos, player.vel, WEAPON.muzzleSpeed);
  const aimDir = lead
    ? normalize({ x: lead.x - enemy.pos.x, y: lead.y - enemy.pos.y, z: lead.z - enemy.pos.z })
    : toPlayerDir;
  const aimAngle = angleBetween(enemyForward, aimDir);

  // ---- state machine ----
  // ai.modeTimer gates involuntary overrides of the current mode. This matters for 'threatened':
  // a player just holding station on our six keeps `threatened` true every single frame, so
  // without a floor here evade would re-arm its own timer forever and never let go — this ship
  // would flee indefinitely from anyone who simply stays on its tail, which is the normal thing a
  // pursuing player does. Committing to whatever evade hands off to (close/reposition) for a
  // minimum window, immune to re-triggering evade, guarantees it actually gets a chance to turn
  // and fight back instead.
  if (ai.modeTimer > 0) ai.modeTimer -= dt;

  if (ai.mode === 'evade') {
    if (ai.modeTimer <= 0) {
      // coming out of evade the nose is pointed away from the fight — loop back around rather
      // than assuming a clean shot is immediately available
      ai.mode = dist > tuning.closeRange ? 'close' : 'reposition';
      ai.modeTimer = tuning.modeCommitSeconds;
    }
  } else if (threatened && ai.modeTimer <= 0) {
    ai.mode = 'evade';
    ai.modeTimer = tuning.evadeMinSeconds;
  } else if (ai.modeTimer <= 0) {
    const next = dist > tuning.closeRange
      ? 'close'
      // bad angle to the target — extend and loop back rather than trying to muscle an instant
      // reversal (how readily this triggers, and how far it commits to extending, is tuning-driven)
      : aimAngle > tuning.overshootAngleRad ? 'reposition' : 'engage';
    if (next !== ai.mode) ai.modeTimer = tuning.modeCommitSeconds;
    ai.mode = next;
  }

  let steerDir: Vec3;
  let throttle = 1;
  let boostRequested = false;
  let brake = false;
  let strafeX = 0, strafeY = 0;
  let wantsToFire = false;

  switch (ai.mode) {
    case 'close':
      steerDir = toPlayerDir; // pure pursuit while just eating distance
      throttle = 1;
      boostRequested = dist > tuning.closeRange * 1.4;
      break;

    case 'reposition': {
      // keep flying roughly along current velocity (extend) with a bias back toward the player —
      // repositionExtendBias controls how much it commits to running vs. curving back immediately
      const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z);
      const extendDir = speed > 1 ? normalize(enemy.vel) : enemyForward;
      const bias = tuning.repositionExtendBias;
      steerDir = normalize({
        x: extendDir.x * bias + toPlayerDir.x * (1 - bias),
        y: extendDir.y * bias + toPlayerDir.y * (1 - bias),
        z: extendDir.z * bias + toPlayerDir.z * (1 - bias)
      });
      throttle = 1;
      boostRequested = tuning.repositionBoost;
      break;
    }

    case 'evade': {
      // jink off the player's boresight: nose off-axis plus lateral RCS thrust, so the flight
      // path itself (not just where the nose points) becomes hard to track
      const jinkYaw = Math.sin(ai.clock * tuning.weaveFreq + ai.jinkSeed) > 0 ? 1 : -1;
      const away: Vec3 = { x: -toPlayerDir.x, y: -toPlayerDir.y, z: -toPlayerDir.z };
      const { right: enemyRight, up: enemyUp } = computeAxes(enemy.quat);
      steerDir = normalize({
        x: away.x + enemyRight.x * jinkYaw * 0.6,
        y: away.y + enemyUp.y * 0.3,
        z: away.z + enemyRight.z * jinkYaw * 0.6
      });
      throttle = 1;
      boostRequested = true;
      strafeX = jinkYaw * Math.sin(ai.clock * tuning.weaveFreq * 1.3 + ai.jinkSeed);
      strafeY = Math.cos(ai.clock * tuning.weaveFreq * 0.9 + ai.jinkSeed) * 0.6;
      break;
    }

    case 'engage':
    default: {
      steerDir = aimDir;
      // hold station around engageRange — proportional throttle, hard brake if way too close
      const rangeError = dist - tuning.engageRange;
      throttle = Math.abs(rangeError) <= tuning.engageBand
        ? clamp(rangeError / tuning.engageBand, -1, 1) * 0.3
        : clamp(rangeError / tuning.closeRange, -1, 1);
      brake = rangeError < -tuning.engageBand * 1.5;
      // a light weave so it isn't flying a dead-straight line while shooting
      strafeX = Math.sin(ai.clock * tuning.weaveFreq + ai.jinkSeed) * 0.35;
      strafeY = Math.cos(ai.clock * tuning.weaveFreq * 0.7 + ai.jinkSeed) * 0.2;
      wantsToFire = true; // actual aim precision is re-checked post-rotation via canFire
      break;
    }
  }

  const steer = steeringToward(enemy.quat, steerDir, tuning.steerGain);

  return {
    inputs: {
      throttle,
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      strafeX,
      strafeY,
      brake,
      decoupled: false
    },
    boostRequested,
    wantsToFire,
    aimDir
  };
}

// ===========================================================================
// ChaserAI — the 'chaser' EnemyShip behavior, used by the evasion drills (see
// scenarios/definitions.ts). Unlike FighterAI there's no state machine: it always just flies to
// hold a fixed offset directly behind the player and fires when boresighted. It deliberately never
// disengages or repositions — the player's job is to break its aim (e.g. by flying a barrel-roll
// gate path), not to out-fight it.
// ===========================================================================
export const CHASER_TUNING = {
  standoffDistance: 130, // meters directly behind the player it tries to hold station at
  steerGain: 5,
  fireRange: 450,
  fireLateralTolerance: 8
};

export function chaserThink(enemy: EnemyShip, player: Ship): FighterDecision {
  const { forward: playerForward } = computeAxes(player.quat);
  const stationPoint: Vec3 = {
    x: player.pos.x - playerForward.x * CHASER_TUNING.standoffDistance,
    y: player.pos.y - playerForward.y * CHASER_TUNING.standoffDistance,
    z: player.pos.z - playerForward.z * CHASER_TUNING.standoffDistance
  };
  const toStation: Vec3 = {
    x: stationPoint.x - enemy.pos.x,
    y: stationPoint.y - enemy.pos.y,
    z: stationPoint.z - enemy.pos.z
  };
  const distToStation = Math.hypot(toStation.x, toStation.y, toStation.z);
  const steerDir = distToStation > 1 ? normalize(toStation) : playerForward;

  const toPlayer: Vec3 = {
    x: player.pos.x - enemy.pos.x,
    y: player.pos.y - enemy.pos.y,
    z: player.pos.z - enemy.pos.z
  };
  const dist = Math.hypot(toPlayer.x, toPlayer.y, toPlayer.z) || 1;
  const aimDir = normalize(toPlayer);

  const steer = steeringToward(enemy.quat, steerDir, CHASER_TUNING.steerGain);
  const { forward: enemyForward } = computeAxes(enemy.quat);

  return {
    inputs: {
      throttle: clamp(distToStation / 150, 0.15, 1),
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      strafeX: 0,
      strafeY: 0,
      brake: false,
      decoupled: false
    },
    boostRequested: distToStation > 350,
    wantsToFire: dist <= CHASER_TUNING.fireRange && angleBetween(enemyForward, aimDir) < 0.3,
    aimDir
  };
}

// ===========================================================================
// EvasivePilotAI — the 'evasive' EnemyShip behavior, used only by the Evasive Pilot drill (see
// scenarios/definitions.ts). Two mostly-independent halves:
//
// FORWARD AXIS (standoff-holding) — a plain velocity-servo: match the player's own forward speed
// (feed-forward) plus a correction proportional to the standoffDistance shortfall. Not re-rolled or
// randomized (the target is just "stay standoffDistance ahead"), so it converges cleanly and doesn't
// have the achievability problems the lateral/vertical axis used to.
//
// LATERAL/VERTICAL AXES (the jink) — receding-horizon MODEL PREDICTIVE CONTROL instead of a
// hand-tuned reroll-and-servo heuristic. A fixed reroll-a-random-target-then-chase-it approach (what
// this used to do) is fundamentally reactive: it can't know whether the direction it just picked is
// actually a good idea, only follow it until a timer says "pick a new one" — which reads as
// low-effort and, worse, ends up looking close to a straight line whenever the servo's response time
// doesn't match the reroll cadence (a real, measured failure mode of the old design). MPC instead:
//   1. Builds several candidate constant strafeX/strafeY/boost commands (8 directions + hold, each
//      with/without boost).
//   2. For EACH candidate, clones the drone's current state and forward-simulates it through the
//      SAME real flight model (physics/flightModel.ts's integrateFlight) the whole game runs on, for
//      a short horizon — this is "the AI" quite literally driving its own physics sim as a predictor,
//      not a separate approximation of it.
//   3. Scores each candidate's resulting trajectory: reward ending up hard for the player's CURRENT
//      aim to hit (via the same closestApproachIfFiredNow the player's own PIP color uses), reward
//      ending up with a velocity that's substantially DIFFERENT from its current one (the actual
//      "jerk"/PIP-defeating quantity — see this file's evasive-behavior doc comment in types.ts),
//      and penalize drifting far from the standoff distance.
//   4. Commits to the winning candidate's strafeX/strafeY/boost for a short window (re-planning more
//      often — a receding horizon — rather than committing to a long, unverified maneuver), then
//      repeats. Reacting to a detected threat forces an immediate replan instead of waiting out the
//      window, same idea as the old design's "break now" rule.
// Orientation is held FIXED for the (short, ~1s) planning horizon — a real reorientation takes
// several seconds at this ship's turn rate (see the chase/watch split below), so freezing it for the
// much shorter planning window is a reasonable approximation, not a meaningful source of error.
//
// Nose facing is a hysteresis switch between two modes, not a permanent lock:
//   'watch' (default) — nose on the player (aimDir), so it reads as an opponent fighting you, not a
//              target flying formation with its back turned, and so it can see you for MPC's threat
//              detection. This is mechanically fine MOST of the time: once its own velocity has
//              converged to match yours, the remaining forward-axis correction is small, so it
//              doesn't matter that main thrust now points the "wrong" way (at you) for that axis.
//   'chase'    — nose swung to point along the player's OWN forward axis instead, entered only once
//              the forward-axis velocity deficit gets large (e.g. you just boosted away). Facing the
//              player for that correction would mean using this ship's weak retro thrust (63) against
//              a large deficit instead of its main thrust (201) — which is exactly what made the drone
//              read as sluggish/"flies in one straight line" once nose-lock kept it retro-only for its
//              single largest, most common correction. Hysteresis (separate enter/exit thresholds)
//              stops it flip-flopping facing every tick right at the boundary.
// Bank is separately slaved to the player's own via `upHint` on steeringToward regardless of which of
// the two the nose is doing, so it never appears to roll independently of the player — "always roll
// matches" from the drill's design brief.
//
// The AI only ever issues thruster commands through the same realistic flight model as everything
// else, so the actual G-loading and reversal snap the player sees is bounded by real thrust/speed,
// not faked — exactly the high-jerk, low-predictability motion this drill trains against (see the
// 'evasive' EnemyBehavior doc comment in types.ts).
// ===========================================================================
export const EVASIVE_TUNING = {
  standoffDistance: 50,        // meters directly ahead of the player's nose it tries to hold station at
  steerGain: 7,
  positionCorrectionGain: 1.2,   // 1/s — how much of the standoffDistance shortfall (meters, forward
                                  // axis only) gets added to the player's own velocity as the desired
                                  // closing speed — see the forward-axis doc comment above
  velocityBand: 30,               // m/s of velocity error (desired vs. actual) that maps to full
                                   // throttle deflection on the forward axis
  chaseEnterVelDeficit: 45,      // m/s of forward-axis deficit that triggers the 'chase' facing (see
                                 // the doc comment above) — set above velocityBand so it only kicks in
                                 // once the deficit is genuinely too large for the 'watch' facing's
                                 // (weak, retro-only) authority to plausibly correct
  chaseExitVelDeficit: 15,       // releases back to 'watch' once the deficit drops below this — kept
                                 // well below chaseEnterVelDeficit (hysteresis) so it doesn't
                                 // flip-flop facing every tick right at one threshold
  chaseStruggleTolerance: 0.8,   // 'chasing' only counts as genuinely helping once it's shrunk the
                                 // deficit to at most this fraction of chaseEnterVelDeficit — if it's
                                 // still above that after chaseStruggleLimitSec, the drone's own max
                                 // turn rate can't out-rotate whatever the player is doing (a real
                                 // physical limit when both fly the same ship — see the "give up
                                 // chasing" doc comment), so continuing to chase is a losing battle
  chaseStruggleLimitSec: 1.2,    // seconds of chasing without meaningful improvement before giving up
                                 // and forcing an immediate break instead — see chaseStruggleTolerance
  chaseCooldownSec: 1.0,         // seconds 'chasing' stays disabled after a forced break, so it
                                 // doesn't immediately re-enter the same losing chase it just gave up
  boostVelocityThreshold: 20,    // m/s of tracking deficit still needed before it kicks in boost —
                                 // kept low so afterburner gets used liberally any time main thrust
                                 // is doing real work, not just as a rare last resort. Boost never
                                 // helps strafe (real SC's afterburner only affects the main engine —
                                 // see ShipType.boostLinearThrust's doc comment), so this only ever
                                 // fires while genuinely using throttle, but that should be often
  threatMarginMultiplier: 2.5,  // MPC's hit-risk term activates once a candidate's predicted miss
                                 // distance would be within this many hull radii, not only once it
                                 // would already technically connect — lets it react before a shot
                                 // actually lands, not only after
  mpcHorizonSec: 0.4,            // how far ahead each jink candidate is forward-simulated — short on
                                  // purpose: a long horizon lets a LOT of drift accumulate regardless
                                  // of which candidate is chosen once already moving fast (reversing
                                  // can't fully arrest hundreds of m/s within the same window a
                                  // continued push would have moved it further), which let the
                                  // standoff-drift cost's sheer scale swamp the direction-change
                                  // reward and made it look "safer" (in a single 1-shot lookahead) to
                                  // just keep going. A shorter horizon keeps each decision's predicted
                                  // drift small enough that the direction-change reward can actually
                                  // compete, and the receding-horizon replanning (mpcReplanSec below)
                                  // is what provides the longer-term correction, not any one horizon.
  mpcStepSec: 0.08,                // physics step size used for that simulation (5 steps/horizon)
  mpcReplanSec: 0.25,             // baseline cadence for re-running the candidate evaluation — a
                                   // receding horizon, not a one-shot plan committed to indefinitely
  mpcThreatReplanSec: 0.08,      // much faster re-evaluation cadence while a candidate's own outcome
                                 // is judged risky (see the hit-risk cost term) — a fast, urgent
                                 // reconsideration instead of the calmer baseline cadence
  mpcStandoffWeight: 9.0,        // cost weight — keep the jink from drifting far off the standoff
                                 // POINT (forward distance AND lateral/vertical position both, meters
                                 // — see scoreJinkCandidate's doc comment for why this is linear, not squared)
  jinkMagnitude: 55,              // m/s — how much EXTRA lateral/vertical velocity (beyond just
                                  // tracking the standoff point's own motion) the jink bias adds —
                                  // see jinkVelocityServo's doc comment
  lateralCenteringGain: 0.6,     // 1/s — continuous proportional pull back toward zero lateral/
                                 // vertical offset from the player's nose-line, blended into the
                                 // baseline BEFORE the jink bias is added — the forward axis already
                                 // has this (forwardShortfall * positionCorrectionGain); lateral/
                                 // vertical didn't, relying only on MPC's periodic drift-cost
                                 // judgment, which wasn't enough on its own to prevent runaway drift
                                 // once the standoff point itself was moving fast (see evasiveThink's
                                 // targetVel doc comment for the scenario that exposed this)
  downStrafePenalty: 70,          // cost weight (see scoreJinkCandidate's doc comment) — biases the
                                  // planner away from a full straight-down jink by roughly as much as
                                  // a moderate standoff-drift or a partial direction-change would cost,
                                  // enough to usually lose to a comparable non-down option without
                                  // making "down" literally unreachable when it's genuinely the best
                                  // available move (e.g. the only direction that avoids a predicted hit)
  mpcHitRiskWeight: 2.0,          // cost weight — strongly avoid predicted-hit outcomes
  mpcUnpredictabilityWeight: 150, // reward weight (0..2 scale — see this section's doc comment) —
                                  // favor candidates that push in a DIFFERENT direction than the
                                  // currently-committed one. This is the dominant term whenever no
                                  // candidate is under real hit-risk, which is what keeps it actively
                                  // reversing direction instead of settling into one sustained push
  shootbackChancePerSec: 0.15,  // 'block' -> 'shootback' trigger rate once its cooldown has cleared
  shootbackDurationSec: 1.2,    // how long it holds a firing window
  shootbackCooldownSec: 1.5,    // minimum gap between shootback windows
  fireRange: 300,
  fireLateralTolerance: 6
};

// 8 compass directions in the (player's) right/up plane, plus holding still — evaluated both with and
// without boost each replan. Full deflection only: MPC already picks WHICH direction is best, so there's
// no need to also search partial magnitudes — a hard, complete break is what actually produces jerk.
const MPC_JINK_DIRECTIONS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
  { x: 0.7071, y: 0.7071 }, { x: 0.7071, y: -0.7071 }, { x: -0.7071, y: 0.7071 }, { x: -0.7071, y: -0.7071 }
];

export function spawnEvasiveState(): EvasiveAIMemory {
  return {
    jinkStrafeX: 0,
    jinkStrafeY: 0,
    jinkBoost: false,
    jinkReplanTimer: 0,
    mode: 'block',
    modeTimer: 0,
    wasThreatened: false,
    chasing: false,
    chaseStruggleTimer: 0,
    chaseCooldownTimer: 0
  };
}

// Lightweight clone of just what integrateFlight needs — a full EnemyShip carries combat/AI state
// (health, behavior, etc.) that has no bearing on flight and would be wasteful to clone every
// candidate, every replan.
interface PlanningBody {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: AngularState;
  boosting: boolean;
  throttleSpoolTime: number;
  verticalSpoolTime: number;
}

// Converts a jink bias direction (PLAYER-frame) into actual body-relative strafeX/strafeY via a
// velocity-servo: desired = baseline + dir*jinkMagnitude, error = desired - actual (computed in
// world space), then that error is projected onto whichever axes are CURRENTLY available. `baseline`
// is the standoff point's own current velocity along the player's right/up axes — critically, this
// includes the ROTATIONAL contribution (see evasiveThink's targetVel doc comment), not just the
// player's translational velocity. A committed jink direction can persist across many replans while
// the nose keeps slowly re-aiming and the player keeps rotating, so recomputing this from scratch
// every call (not just once when the direction was chosen) is what keeps it tracking a genuinely
// moving reference frame instead of a fixed command that quietly goes stale.
function jinkVelocityServo(
  dirX: number, dirY: number, baselineLateralVel: number, baselineVerticalVel: number,
  actualVel: Vec3, playerRight: Vec3, playerUp: Vec3, bodyRight: Vec3, bodyUp: Vec3
): { strafeX: number; strafeY: number } {
  const desiredLateralVel = baselineLateralVel + dirX * EVASIVE_TUNING.jinkMagnitude;
  const desiredVerticalVel = baselineVerticalVel + dirY * EVASIVE_TUNING.jinkMagnitude;
  const actualLateralVel = actualVel.x * playerRight.x + actualVel.y * playerRight.y + actualVel.z * playerRight.z;
  const actualVerticalVel = actualVel.x * playerUp.x + actualVel.y * playerUp.y + actualVel.z * playerUp.z;
  const lateralError = desiredLateralVel - actualLateralVel;
  const verticalError = desiredVerticalVel - actualVerticalVel;
  const errorWorld: Vec3 = {
    x: playerRight.x * lateralError + playerUp.x * verticalError,
    y: playerRight.y * lateralError + playerUp.y * verticalError,
    z: playerRight.z * lateralError + playerUp.z * verticalError
  };
  return {
    strafeX: clamp((errorWorld.x * bodyRight.x + errorWorld.y * bodyRight.y + errorWorld.z * bodyRight.z) / EVASIVE_TUNING.velocityBand, -1, 1),
    strafeY: clamp((errorWorld.x * bodyUp.x + errorWorld.y * bodyUp.y + errorWorld.z * bodyUp.z) / EVASIVE_TUNING.velocityBand, -1, 1)
  };
}

// Forward-simulates holding a fixed jink bias direction (PLAYER-frame)/throttle/boost for
// EVASIVE_TUNING.mpcHorizonSec, through the real flight model — re-running the velocity-servo above
// every substep (not just once at the start), so the simulation reacts to its own evolving velocity
// the same way the real per-tick application does. Orientation is frozen (zero angVel, zero
// pitch/yaw/roll input) for the duration — see this section's doc comment for why that's a reasonable
// approximation over a horizon this short.
function simulateJinkCandidate(
  enemy: EnemyShip, throttle: number, dirX: number, dirY: number, boost: boolean,
  playerRight: Vec3, playerUp: Vec3, baselineLateralVel: number, baselineVerticalVel: number
): { pos: Vec3; vel: Vec3 } {
  const body: PlanningBody = {
    type: enemy.type,
    pos: { x: enemy.pos.x, y: enemy.pos.y, z: enemy.pos.z },
    vel: { x: enemy.vel.x, y: enemy.vel.y, z: enemy.vel.z },
    quat: { x: enemy.quat.x, y: enemy.quat.y, z: enemy.quat.z, w: enemy.quat.w },
    angVel: { pitch: 0, yaw: 0, roll: 0 },
    boosting: boost,
    throttleSpoolTime: boost ? 0 : enemy.throttleSpoolTime,
    verticalSpoolTime: enemy.verticalSpoolTime
  };
  const { right: bodyRight, up: bodyUp } = computeAxes(body.quat);
  const steps = Math.round(EVASIVE_TUNING.mpcHorizonSec / EVASIVE_TUNING.mpcStepSec);
  for (let i = 0; i < steps; i++) {
    const { strafeX, strafeY } = jinkVelocityServo(dirX, dirY, baselineLateralVel, baselineVerticalVel, body.vel, playerRight, playerUp, bodyRight, bodyUp);
    const inputs: FlightInputs = { throttle, pitch: 0, yaw: 0, roll: 0, strafeX, strafeY, brake: false, decoupled: false };
    integrateFlight(body, inputs, EVASIVE_TUNING.mpcStepSec);
  }
  return { pos: body.pos, vel: body.vel };
}

// Lower is better. Combines: staying near the standoff point (both the forward distance AND the
// lateral/vertical drift off the player's nose-line — the latter is what strafeX/strafeY actually
// control, and an earlier version of this only penalized the forward axis, leaving nothing at all to
// bound how far sideways a "maximize unpredictability" candidate could run), avoiding a predicted hit
// against the player's CURRENT aim/velocity (frozen for the horizon — the player's own future intent
// isn't known, but "would my predicted position still be where you're aimed" is still a meaningful,
// real signal), and rewarding a candidate whose PUSH DIRECTION differs from the currently-committed
// one. That last term is deliberately a direction comparison, not a comparison of resulting
// velocities: an earlier version rewarded "how much did the predicted velocity change from right
// now", which a candidate that just KEEPS ACCELERATING the same way already in progress satisfies
// perfectly (velocity keeps growing every horizon as long as there's room left before some natural
// ceiling) — sustained one-directional acceleration is zero jerk, not high jerk, even though the
// velocity itself is changing a lot. Jerk is specifically the ACCELERATION vector changing direction,
// so rewarding "this candidate pushes a different way than what I'm currently committed to" is the
// direct, correct signal, and it's what actually made the MPC-driven jink alternate hard instead of
// picking one direction and coasting on it for seconds at a time (a real, observed failure mode of
// the velocity-comparison version).
function scoreJinkCandidate(
  finalPos: Vec3, finalVel: Vec3, dirX: number, dirY: number, prevDirX: number, prevDirY: number,
  player: Ship, playerForward: Vec3, playerRight: Vec3, playerUp: Vec3, hullRadius: number
): number {
  const toFinal: Vec3 = { x: finalPos.x - player.pos.x, y: finalPos.y - player.pos.y, z: finalPos.z - player.pos.z };
  const forwardSepFinal = toFinal.x * playerForward.x + toFinal.y * playerForward.y + toFinal.z * playerForward.z;
  const lateralFinal = toFinal.x * playerRight.x + toFinal.y * playerRight.y + toFinal.z * playerRight.z;
  const verticalFinal = toFinal.x * playerUp.x + toFinal.y * playerUp.y + toFinal.z * playerUp.z;
  // LINEAR (not squared) in the drift distance — deliberately so. A squared cost lets a large
  // existing drift dominate every other consideration (its own doc comment used to explain a hard
  // clamp here to prevent that), but clamping introduces a worse problem: once past the clamp, EVERY
  // candidate reads as the same saturated cost, so the term stops discriminating "getting better"
  // from "getting worse" at exactly the drift levels where a restoring pull matters most. Linear cost
  // never explodes (100m of extra drift always costs the same fixed amount more, not a quadratically
  // larger one) but also never fully saturates — it keeps pulling toward the standoff point at every
  // distance, proportionally, without ever swamping the direction-change reward on its own.
  const standoffError = forwardSepFinal - EVASIVE_TUNING.standoffDistance;
  const standoffCost = Math.abs(standoffError) + Math.abs(lateralFinal) + Math.abs(verticalFinal);

  const missDistance = closestApproachIfFiredNow(
    player.pos, player.vel, playerForward, finalPos, finalVel, WEAPON.muzzleSpeed, WEAPON.lifetime
  );
  const margin = hullRadius * EVASIVE_TUNING.threatMarginMultiplier;
  const hitRiskShortfall = Math.max(0, margin - missDistance);
  const hitRiskCost = hitRiskShortfall * hitRiskShortfall;

  // 0 (same push direction as currently committed) .. 2 (fully reversed); both dir vectors are
  // already unit length (or zero for "hold"), so this is a plain cosine-similarity comparison
  const directionChangeReward = 1 - (dirX * prevDirX + dirY * prevDirY);

  // Down (-Y) jinks only ever get HALF the real thrust of every other direction on this ship
  // (ShipType.linearThrust.verticalDown is exactly half verticalUp) — bias the planner away from
  // routinely relying on "down" as just another equally-good option, even though the roll-to-align
  // trick in evasiveThink lets the real per-tick execution mostly route around that weakness when
  // "down" does get chosen. Scaled by how much of the candidate is actually downward, so a mild
  // down-left diagonal isn't penalized as hard as a pure straight-down push.
  const downStrafePenalty = dirY < 0 ? -dirY * EVASIVE_TUNING.downStrafePenalty : 0;

  return EVASIVE_TUNING.mpcStandoffWeight * standoffCost
    + EVASIVE_TUNING.mpcHitRiskWeight * hitRiskCost
    + downStrafePenalty
    - EVASIVE_TUNING.mpcUnpredictabilityWeight * directionChangeReward;
}

export function evasiveThink(
  enemy: EnemyShip,
  ai: EvasiveAIMemory,
  player: Ship,
  dt: number,
  returnFireEnabled: boolean
): FighterDecision {
  const { forward: playerForward, right: playerRight, up: playerUp } = computeAxes(player.quat);
  const toEnemy: Vec3 = {
    x: enemy.pos.x - player.pos.x,
    y: enemy.pos.y - player.pos.y,
    z: enemy.pos.z - player.pos.z
  };
  const aimDir = normalize({ x: -toEnemy.x, y: -toEnemy.y, z: -toEnemy.z });

  // how close would the player's shot, fired right now with their current facing/velocity, actually
  // pass RIGHT NOW (not the predictive per-candidate version MPC uses below) — drives replan urgency
  // and the shootback/boost "panic" triggers, same as the player's own PIP color logic.
  const missDistanceNow = closestApproachIfFiredNow(
    player.pos, player.vel, playerForward, enemy.pos, enemy.vel, WEAPON.muzzleSpeed, WEAPON.lifetime
  );
  const threatened = missDistanceNow <= enemy.type.hullRadius * EVASIVE_TUNING.threatMarginMultiplier;
  const justThreatened = threatened && !ai.wasThreatened;
  ai.wasThreatened = threatened;
  if (justThreatened) ai.jinkReplanTimer = 0; // break immediately instead of waiting out the current window

  // The standoff point isn't carried along by the player's TRANSLATIONAL velocity alone — it also
  // sweeps through an arc purely from the player's own ROTATION (holding a pitch/yaw input while
  // barely moving forward spins the point 50m ahead around the player just as fast as a real orbit
  // at that radius would). Using only player.vel as feed-forward is blind to that entirely: measured,
  // holding pitch at near-zero throttle let the drone fall from 39m up past 600m away over ~9
  // seconds, since neither the forward-axis servo nor the jink had any idea the target point was
  // moving at all. The fix is the standard rigid-body point-velocity formula: velocity of a point
  // rigidly attached to the player at its current offset = player.vel + (player's world-space
  // angular velocity) x (offset). This feeds BOTH the forward axis below and the jink's baseline —
  // the rotational term is often nearly perpendicular to the forward axis (since the drone sits
  // roughly along it), meaning most of its effect actually shows up as lateral/vertical motion, not
  // forward/back, so both need it.
  const playerWorldAngVel = rotateVecByQuat({ x: player.angVel.pitch, y: player.angVel.yaw, z: player.angVel.roll }, player.quat);
  const rotationalVel = cross(playerWorldAngVel, toEnemy);
  const targetVel: Vec3 = {
    x: player.vel.x + rotationalVel.x,
    y: player.vel.y + rotationalVel.y,
    z: player.vel.z + rotationalVel.z
  };
  // lateral/vertical also get a continuous, proportional pull back toward zero offset from the
  // player's nose-line, same idea as the forward axis's forwardShortfall below — without this, the
  // only thing bounding lateral/vertical drift was MPC's periodic (and, on its own, insufficient —
  // see the doc comment above) per-replan drift-cost judgment.
  const lateralNow = toEnemy.x * playerRight.x + toEnemy.y * playerRight.y + toEnemy.z * playerRight.z;
  const verticalNow = toEnemy.x * playerUp.x + toEnemy.y * playerUp.y + toEnemy.z * playerUp.z;
  const playerLateralVel = (targetVel.x * playerRight.x + targetVel.y * playerRight.y + targetVel.z * playerRight.z) - lateralNow * EVASIVE_TUNING.lateralCenteringGain;
  const playerVerticalVel = (targetVel.x * playerUp.x + targetVel.y * playerUp.y + targetVel.z * playerUp.z) - verticalNow * EVASIVE_TUNING.lateralCenteringGain;

  // ---- forward axis: plain velocity-servo ----
  const forwardSep = toEnemy.x * playerForward.x + toEnemy.y * playerForward.y + toEnemy.z * playerForward.z;
  const forwardShortfall = EVASIVE_TUNING.standoffDistance - forwardSep;
  const playerForwardVel = targetVel.x * playerForward.x + targetVel.y * playerForward.y + targetVel.z * playerForward.z;
  const desiredTrackingVel = (playerForwardVel + forwardShortfall * EVASIVE_TUNING.positionCorrectionGain);

  // Full 3D tracking need (forward correction + lateral/vertical baseline+centering, NOT including
  // the jink bias — that's a separate, smaller wobble layered on top via jinkVelocityServo below),
  // combined into one world-space vector. Its DIRECTION drives 'chase' facing (see below) instead of
  // always assuming the need is along playerForward specifically — when the player is mostly
  // ROTATING rather than translating, the actual dominant correction can point almost anywhere, and
  // pointing main thrust at a hardcoded axis that isn't where the need actually is wastes it.
  const desiredVelFull: Vec3 = {
    x: playerForward.x * desiredTrackingVel + playerRight.x * playerLateralVel + playerUp.x * playerVerticalVel,
    y: playerForward.y * desiredTrackingVel + playerRight.y * playerLateralVel + playerUp.y * playerVerticalVel,
    z: playerForward.z * desiredTrackingVel + playerRight.z * playerLateralVel + playerUp.z * playerVerticalVel
  };
  const velDeficitFull: Vec3 = {
    x: desiredVelFull.x - enemy.vel.x,
    y: desiredVelFull.y - enemy.vel.y,
    z: desiredVelFull.z - enemy.vel.z
  };
  const velDeficitMag = Math.hypot(velDeficitFull.x, velDeficitFull.y, velDeficitFull.z);
  const chaseDir = velDeficitMag > 1e-3
    ? { x: velDeficitFull.x / velDeficitMag, y: velDeficitFull.y / velDeficitMag, z: velDeficitFull.z / velDeficitMag }
    : playerForward;

  // ---- chase/watch facing hysteresis (see the doc comment above) ----
  if (ai.chaseCooldownTimer > 0) ai.chaseCooldownTimer -= dt;
  if (ai.chasing) {
    if (velDeficitMag < EVASIVE_TUNING.chaseExitVelDeficit) {
      ai.chasing = false;
      ai.chaseStruggleTimer = 0;
    } else if (velDeficitMag > EVASIVE_TUNING.chaseEnterVelDeficit * EVASIVE_TUNING.chaseStruggleTolerance) {
      // chasing hasn't meaningfully closed the gap — accumulate struggle time. This is exactly what
      // happens when the player holds a sustained turn/rotation at (or near) the drone's own max
      // rate: both fly the same ship, so nose-chasing a continuously-moving target direction can
      // never actually catch up — it's not a tuning problem, it's a real physical tie at best. See
      // the doc comment below on giving up rather than grinding at a battle that can't be won.
      ai.chaseStruggleTimer += dt;
      if (ai.chaseStruggleTimer > EVASIVE_TUNING.chaseStruggleLimitSec) {
        // Give up trying to out-turn the player and force an immediate break instead. Real evasive
        // pilots don't try to physically match an opponent's sustained turn rate at a fixed
        // range — once out-rotated, the winning move is a sudden, unpredictable direction change
        // (or bailing for the opponent's six), not grinding out a turn you can't win. Reverting to
        // 'watch' stops main thrust fighting a losing reorientation, and forcing the jink planner to
        // replan NOW (rather than waiting out its normal cadence) is the "suddenly change direction"
        // half of that response — the MPC planner, now unburdened by a hopeless chase, is free to
        // pick whatever break actually helps.
        ai.chasing = false;
        ai.chaseStruggleTimer = 0;
        ai.chaseCooldownTimer = EVASIVE_TUNING.chaseCooldownSec;
        ai.jinkReplanTimer = 0;
      }
    } else {
      ai.chaseStruggleTimer = 0; // genuinely closing the gap — no struggle, keep chasing normally
    }
  } else if (velDeficitMag > EVASIVE_TUNING.chaseEnterVelDeficit && ai.chaseCooldownTimer <= 0) {
    ai.chasing = true;
  }

  // ---- shootback mini state machine (only ever leaves 'block' when the drill option is enabled) ----
  if (ai.modeTimer > 0) ai.modeTimer -= dt;
  if (!returnFireEnabled) {
    ai.mode = 'block';
  } else if (ai.mode === 'shootback') {
    if (ai.modeTimer <= 0) {
      ai.mode = 'block';
      ai.modeTimer = EVASIVE_TUNING.shootbackCooldownSec;
    }
  } else if (ai.modeTimer <= 0 && Math.random() < EVASIVE_TUNING.shootbackChancePerSec * dt) {
    ai.mode = 'shootback';
    ai.modeTimer = EVASIVE_TUNING.shootbackDurationSec;
  }

  // Bank normally matches the player's own (real pilots don't roll independently for no reason), but
  // a committed jink that leans meaningfully DOWNWARD is instead executed by rolling until the
  // drone's OWN "up" axis points toward the jink's full direction — letting jinkVelocityServo route
  // the correction through the strong up-thruster instead of eating half thrust on a literal
  // down-strafe (ShipType.linearThrust.verticalDown is exactly half verticalUp). This is the same
  // "roll 45-90 degrees and push up" technique a real pilot would use rather than relying on the
  // weak thruster — see downStrafePenalty's doc comment for the other half of this (biasing the
  // planner away from picking "down" routinely in the first place).
  const jinkWorldDir: Vec3 = {
    x: playerRight.x * ai.jinkStrafeX + playerUp.x * ai.jinkStrafeY,
    y: playerRight.y * ai.jinkStrafeX + playerUp.y * ai.jinkStrafeY,
    z: playerRight.z * ai.jinkStrafeX + playerUp.z * ai.jinkStrafeY
  };
  const jinkWorldDirMag = Math.hypot(jinkWorldDir.x, jinkWorldDir.y, jinkWorldDir.z);
  const usesWeakDownThrust = ai.jinkStrafeY < -0.3 && jinkWorldDirMag > 1e-3;
  const bankHint = usesWeakDownThrust
    ? { x: jinkWorldDir.x / jinkWorldDirMag, y: jinkWorldDir.y / jinkWorldDirMag, z: jinkWorldDir.z / jinkWorldDirMag }
    : playerUp;

  // nose faces the player by default, swings to face the ACTUAL direction of the combined tracking
  // need while genuinely catching up (see chase/watch doc comment and chaseDir above — not a
  // hardcoded axis), snaps to face the player for a shootback window regardless of chase state (a
  // shot is more useful than a marginal thrust-efficiency gain)
  const steerDir = (ai.mode === 'shootback' || !ai.chasing) ? aimDir : chaseDir;
  const steer = steeringToward(enemy.quat, steerDir, EVASIVE_TUNING.steerGain, bankHint);

  // main thrust projected onto the drone's OWN current nose — this still works correctly regardless
  // of which way the nose points (watch vs. chase), same reasoning jinkVelocityServo below needs for
  // the jink: whatever axis is CURRENTLY available gets whatever fraction of the FULL tracking need
  // it can actually deliver. Using the full 3D deficit (not just its forward-axis component) means
  // main thrust pulls its actual weight even while chase is still turning to fully align.
  const { forward: enemyForward, right: enemyRight, up: enemyUp } = computeAxes(enemy.quat);
  const throttle = clamp((velDeficitFull.x * enemyForward.x + velDeficitFull.y * enemyForward.y + velDeficitFull.z * enemyForward.z) / EVASIVE_TUNING.velocityBand, -1, 1);

  // ---- MPC jink replan (see this section's doc comment) ----
  ai.jinkReplanTimer -= dt;
  if (ai.jinkReplanTimer <= 0) {
    let bestCost = Infinity, bestX = 0, bestY = 0, bestBoost = false;
    for (const dir of MPC_JINK_DIRECTIONS) {
      for (const boost of [false, true]) {
        const outcome = simulateJinkCandidate(enemy, throttle, dir.x, dir.y, boost, playerRight, playerUp, playerLateralVel, playerVerticalVel);
        const cost = scoreJinkCandidate(outcome.pos, outcome.vel, dir.x, dir.y, ai.jinkStrafeX, ai.jinkStrafeY, player, playerForward, playerRight, playerUp, enemy.type.hullRadius);
        if (cost < bestCost) {
          bestCost = cost;
          bestX = dir.x;
          bestY = dir.y;
          bestBoost = boost;
        }
      }
    }
    ai.jinkStrafeX = bestX;
    ai.jinkStrafeY = bestY;
    ai.jinkBoost = bestBoost;
    ai.jinkReplanTimer = threatened ? EVASIVE_TUNING.mpcThreatReplanSec : EVASIVE_TUNING.mpcReplanSec;
  }

  // ai.jinkStrafeX/jinkStrafeY are the committed PLAYER-frame jink bias direction (see
  // jinkVelocityServo's doc comment) — recomputed into actual strafeX/strafeY every tick, not just at
  // the moment they were chosen, since a committed direction can persist across many replans while
  // both the nose keeps slowly re-aiming and the player keeps moving/rotating in the meantime.
  const jink = jinkVelocityServo(ai.jinkStrafeX, ai.jinkStrafeY, playerLateralVel, playerVerticalVel, enemy.vel, playerRight, playerUp, enemyRight, enemyUp);

  const boostRequested = velDeficitMag > EVASIVE_TUNING.boostVelocityThreshold || justThreatened || ai.jinkBoost;

  return {
    inputs: {
      throttle,
      pitch: steer.pitch,
      yaw: steer.yaw,
      roll: steer.roll,
      strafeX: clamp(jink.strafeX, -1, 1),
      strafeY: clamp(jink.strafeY, -1, 1),
      brake: false,
      decoupled: false
    },
    boostRequested,
    wantsToFire: ai.mode === 'shootback',
    aimDir
  };
}

// ===========================================================================
// CruiserAI — the 'cruiser' EnemyShip behavior, used by merge/closure drills (see
// scenarios/definitions.ts). No steering, no firing, no death handling beyond the generic
// scenarios/runtime.ts skip-if-dead check: it just holds the velocity it spawned with and flies a
// dead-straight line forever, so a drill built around chasing it down isn't fighting an AI as well.
// ===========================================================================
export function cruiseThink(enemy: EnemyShip, dt: number): void {
  enemy.pos.x += enemy.vel.x * dt;
  enemy.pos.y += enemy.vel.y * dt;
  enemy.pos.z += enemy.vel.z * dt;
}

// ===========================================================================
// OrbiterAI / DrifterAI — harmless practice targets for the Aim Training drill (see
// scenarios/definitions.ts). Neither ever fires; scenarios/runtime.ts's dispatch for these two
// behaviors has no firing logic at all. Both respawn a short while after being shot down so the
// target pool stays full for the whole drill instead of thinning out.
// ===========================================================================
export const ORBITER_TUNING = {
  minRadius: 150, maxRadius: 400,     // meters from the player
  minAngularSpeed: 0.15, maxAngularSpeed: 0.35, // rad/s
  respawnDelaySec: 1.5,
  // The orbit's center is fixed at spawn (see orbiterThink's doc comment) so the player can close
  // or open distance within a pass, but if the player wanders off it needs to catch up or the ring
  // is left behind arbitrarily far away — centerFollowRate eases the center toward the player's
  // live position (fraction/sec, exponential) whenever the drone strays past leashDistance, so it
  // keeps trying to stay within roughly 500m instead of drifting off forever.
  leashDistance: 500,
  centerFollowRate: 0.5
};

export const DRIFTER_TUNING = {
  minSpawnDist: 350, maxSpawnDist: 500,  // meters from the player at spawn — kept inside the ~500m
                                          // practice range instead of streaking in from far off
  minSpeed: 90, maxSpeed: 160,           // m/s, constant for the whole pass
  minMissDistance: 40, maxMissDistance: 150, // meters — how far off-center the flight line passes the player
  turnDist: 500,                         // meters — triggers a turn-around (see TURN_TUNING) instead
                                          // of letting it fly off and get recycled out of sight
  respawnDelaySec: 1.0
};

// A drifter that's flown turnDist away doesn't despawn — it banks into a long, multi-rotation
// barrel roll that curves its heading back around toward the player, then resumes straight-line
// flight on the new heading. Keeps the same drone visibly in play instead of teleporting a fresh
// one in, while still reading as a deliberate "reversal" maneuver rather than a snap-turn.
const TURN_TUNING = {
  duration: 3.2,          // seconds for the whole reversal
  minRollTurns: 1.5, maxRollTurns: 2.2 // full rotations about its own axis during the reversal
};

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Occasional barrel roll, purely cosmetic — a real barrel roll isn't just spinning in place, it's
// holding a constant "up-strafe" while rolling, so as the roll turns that thrust through a full
// circle the flight path corkscrews sideways around the original line of travel before rejoining
// it. We reproduce that kinematically: `offset` traces a circle in the plane perpendicular to the
// direction of travel *at roll-start* (fixed for the whole maneuver, not re-rotated with the
// drone's own spin — re-rotating it would just cancel back out to spinning in place), parameterized
// by the same roll angle used to spin the model, so the corkscrew and the visual roll stay in sync.
// The circle starts and ends at zero offset (cos(0)-1=0, sin(0)=0 ... same at 2π), so it blends
// into and out of the base flight path with no positional pop. Shared by orbiterThink/driftThink
// via their respective (structurally identical) roll fields.
const BARREL_ROLL_DURATION = 1.1;              // seconds for a full 360
const BARREL_ROLL_TRIGGER_CHANCE_PER_SEC = 0.08; // ~once every dozen-ish seconds of eligible flight
const BARREL_ROLL_COOLDOWN = 4;                // seconds before another roll may trigger
const BARREL_ROLL_RADIUS = 15;                 // meters — lateral sweep of the corkscrew

interface BarrelRollState {
  rollTimer?: number;
  rollCooldown?: number;
  rollAxisRight?: Vec3;
  rollAxisUp?: Vec3;
}

interface BarrelRollResult {
  angle: number;  // radians about the local forward axis to apply this tick — 0 while not rolling
  offset: Vec3;   // world-space corkscrew displacement to apply this tick, on top of the base flight path
}

// Advances a drone's roll state by dt. Mutates `state` in place. `axes` should be the drone's
// current (un-rolled) forward-facing orientation, i.e. computeAxes(lookAtQuat(vel)) — its
// right/up are captured as the corkscrew's fixed reference frame the moment a new roll triggers.
function advanceBarrelRoll(state: BarrelRollState, axes: { right: Vec3; up: Vec3 }, dt: number): BarrelRollResult {
  let rollTimer = state.rollTimer ?? 0;
  let rollCooldown = state.rollCooldown ?? 0;

  if (rollTimer > 0) {
    rollTimer = Math.max(0, rollTimer - dt);
  } else {
    rollCooldown -= dt;
    if (rollCooldown <= 0 && Math.random() < BARREL_ROLL_TRIGGER_CHANCE_PER_SEC * dt) {
      rollTimer = BARREL_ROLL_DURATION;
      rollCooldown = BARREL_ROLL_COOLDOWN;
      state.rollAxisRight = axes.right;
      state.rollAxisUp = axes.up;
    }
  }
  state.rollTimer = rollTimer;
  state.rollCooldown = rollCooldown;

  if (rollTimer <= 0 || !state.rollAxisRight || !state.rollAxisUp) {
    return { angle: 0, offset: { x: 0, y: 0, z: 0 } };
  }
  const angle = (1 - rollTimer / BARREL_ROLL_DURATION) * Math.PI * 2;
  const { rollAxisRight: right, rollAxisUp: up } = state;
  const cosTerm = BARREL_ROLL_RADIUS * (Math.cos(angle) - 1);
  const sinTerm = BARREL_ROLL_RADIUS * Math.sin(angle);
  return {
    angle,
    offset: {
      x: cosTerm * up.x + sinTerm * right.x,
      y: cosTerm * up.y + sinTerm * right.y,
      z: cosTerm * up.z + sinTerm * right.z
    }
  };
}

// Rotation-only quaternion about the local forward axis (+Z in computeAxes' base convention) — the
// same body-frame roll axis integrateOrientation uses for angVel.roll.
function rollQuat(angleRad: number): Quat {
  return { w: Math.cos(angleRad / 2), x: 0, y: 0, z: Math.sin(angleRad / 2) };
}

// A random axis perpendicular pair, used as the fixed orbit plane — kept stable in world space
// (not tied to the player's facing) so the ring doesn't swing around when the player looks away.
function randomPerpendicularPair(): { right: Vec3; up: Vec3 } {
  const axis = normalize({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 });
  let right = cross(axis, { x: 0, y: 1, z: 0 });
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) right = cross(axis, { x: 1, y: 0, z: 0 });
  right = normalize(right);
  const up = normalize(cross(axis, right));
  return { right, up };
}

// aggressiveness (0..1, see ScenarioConfig.droneAggressiveness) scales flight speed from 0.6x at 0
// to 1.8x at 1 — the Aim Training drill's difficulty knob.
function droneSpeedMult(aggressiveness: number): number {
  return 0.6 + aggressiveness * 1.2;
}

export function spawnOrbitState(center: Vec3, aggressiveness: number = 0.5): OrbitState {
  const { right, up } = randomPerpendicularPair();
  return {
    center: { x: center.x, y: center.y, z: center.z },
    radius: randRange(ORBITER_TUNING.minRadius, ORBITER_TUNING.maxRadius),
    angularSpeed: randRange(ORBITER_TUNING.minAngularSpeed, ORBITER_TUNING.maxAngularSpeed)
      * droneSpeedMult(aggressiveness) * (Math.random() < 0.5 ? -1 : 1),
    phase: Math.random() * Math.PI * 2,
    planeRight: right,
    planeUp: up,
    respawnTimer: 0
  };
}

// Advances the orbit and re-derives pos/vel/quat from it around the (mostly) fixed `orbit.center`
// (set at spawn/respawn — see spawnOrbitState) — NOT the player's live position every tick, so
// flying toward or away from the ring still changes the distance to it within a pass instead of
// the orbit re-centering underneath you and holding you at `radius` forever. The center does ease
// toward the player (see ORBITER_TUNING.centerFollowRate) once the drone strays past leashDistance,
// so a player who wanders off doesn't leave the ring behind arbitrarily far away. vel is the
// analytic derivative of the position formula (the tangential orbit term), not a finite difference,
// so computeLeadPoint gets a real velocity to lead against instead of one frame of jitter.
export function orbiterThink(enemy: EnemyShip, player: Ship, dt: number): void {
  const orbit = enemy.orbit;
  if (!orbit) return;

  const distToPlayer = Math.hypot(
    enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z
  );
  if (distToPlayer > ORBITER_TUNING.leashDistance) {
    const t = 1 - Math.exp(-ORBITER_TUNING.centerFollowRate * dt);
    orbit.center.x += (player.pos.x - orbit.center.x) * t;
    orbit.center.y += (player.pos.y - orbit.center.y) * t;
    orbit.center.z += (player.pos.z - orbit.center.z) * t;
  }

  orbit.phase += orbit.angularSpeed * dt;

  const cosP = Math.cos(orbit.phase), sinP = Math.sin(orbit.phase);
  const { center, planeRight: r, planeUp: u, radius, angularSpeed } = orbit;
  enemy.pos = {
    x: center.x + radius * (cosP * r.x + sinP * u.x),
    y: center.y + radius * (cosP * r.y + sinP * u.y),
    z: center.z + radius * (cosP * r.z + sinP * u.z)
  };
  const tangential = radius * angularSpeed;
  enemy.vel = {
    x: tangential * (-sinP * r.x + cosP * u.x),
    y: tangential * (-sinP * r.y + cosP * u.y),
    z: tangential * (-sinP * r.z + cosP * u.z)
  };
  enemy.quat = lookAtQuat(enemy.vel);
  // pos/vel above are fully recomputed from the orbit formula every tick (not integrated), so the
  // corkscrew offset can just be added on top here with no delta-tracking against last tick's value
  const roll = advanceBarrelRoll(orbit, computeAxes(enemy.quat), dt);
  if (roll.angle > 0) {
    enemy.quat = quatMultiply(enemy.quat, rollQuat(roll.angle));
    enemy.pos.x += roll.offset.x;
    enemy.pos.y += roll.offset.y;
    enemy.pos.z += roll.offset.z;
  }
}

// Aims roughly back at the player from `fromPos`, offset sideways by a random miss distance so the
// flight line streaks past rather than colliding — more aggressive drills pass closer (tighter
// tracking window). Shared by spawnDriftState (a fresh pass) and driftThink's turn-around (the same
// drone looping back for another pass).
function pickMissAimedFlightDir(fromPos: Vec3, player: Ship, aggressiveness: number): Vec3 {
  const towardPlayer = normalize({ x: player.pos.x - fromPos.x, y: player.pos.y - fromPos.y, z: player.pos.z - fromPos.z });
  let side = cross(towardPlayer, { x: 0, y: 1, z: 0 });
  if (Math.hypot(side.x, side.y, side.z) < 1e-6) side = cross(towardPlayer, { x: 1, y: 0, z: 0 });
  side = normalize(side);
  const missDistanceMult = 1.3 - aggressiveness * 0.7; // 0 -> 1.3x (wider), 1 -> 0.6x (tighter)
  const missDistance = randRange(DRIFTER_TUNING.minMissDistance, DRIFTER_TUNING.maxMissDistance)
    * missDistanceMult * (Math.random() < 0.5 ? -1 : 1);
  const aimPoint: Vec3 = {
    x: player.pos.x + side.x * missDistance,
    y: player.pos.y + side.y * missDistance,
    z: player.pos.z + side.z * missDistance
  };
  return normalize({ x: aimPoint.x - fromPos.x, y: aimPoint.y - fromPos.y, z: aimPoint.z - fromPos.z });
}

export function spawnDriftState(player: Ship, aggressiveness: number = 0.5): { pos: Vec3; vel: Vec3 } {
  const dir = normalize({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 });
  const spawnDist = randRange(DRIFTER_TUNING.minSpawnDist, DRIFTER_TUNING.maxSpawnDist);
  const pos: Vec3 = {
    x: player.pos.x + dir.x * spawnDist,
    y: player.pos.y + dir.y * spawnDist,
    z: player.pos.z + dir.z * spawnDist
  };

  const flightDir = pickMissAimedFlightDir(pos, player, aggressiveness);
  const speed = randRange(DRIFTER_TUNING.minSpeed, DRIFTER_TUNING.maxSpeed) * droneSpeedMult(aggressiveness);

  return { pos, vel: { x: flightDir.x * speed, y: flightDir.y * speed, z: flightDir.z * speed } };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Rotates vector v about the given unit axis by angle (radians), right-hand rule — Rodrigues'
// rotation formula. Used to sweep a flight direction smoothly from one heading to another along a
// great-circle arc (proper spherical interpolation for unit vectors, unlike lerp+renormalize which
// degenerates when the two directions are near-opposite, exactly the case for a ~180 turn-around).
function rotateAboutAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cosA = Math.cos(angle), sinA = Math.sin(angle);
  const k = cross(axis, v);
  const d = dot(axis, v);
  return {
    x: v.x * cosA + k.x * sinA + axis.x * d * (1 - cosA),
    y: v.y * cosA + k.y * sinA + axis.y * d * (1 - cosA),
    z: v.z * cosA + k.z * sinA + axis.z * d * (1 - cosA)
  };
}

// Ease-in/ease-out for the heading sweep, so the reversal accelerates into and decelerates out of
// the turn instead of sweeping at a constant angular rate.
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Kicks off a drifter's turn-around: picks a new aim-back-at-the-player heading from its current
// position (same targeting logic as a fresh spawn — see pickMissAimedFlightDir) and records the
// great-circle arc from its current heading to that new one, to be swept over TURN_TUNING.duration.
function startDriftTurn(enemy: EnemyShip, drift: NonNullable<EnemyShip['drift']>, player: Ship, aggressiveness: number): void {
  const speed = Math.hypot(enemy.vel.x, enemy.vel.y, enemy.vel.z) || 1;
  const fromDir = { x: enemy.vel.x / speed, y: enemy.vel.y / speed, z: enemy.vel.z / speed };
  const toDir = pickMissAimedFlightDir(enemy.pos, player, aggressiveness);

  const angleTotal = Math.acos(clamp(dot(fromDir, toDir), -1, 1));
  if (angleTotal < 1e-3) return; // already heading roughly the right way — nothing to animate

  let axis = cross(fromDir, toDir);
  if (Math.hypot(axis.x, axis.y, axis.z) < 1e-6) {
    // fromDir/toDir are (near-)opposite, so their cross product is degenerate — fall back to any
    // axis perpendicular to fromDir, same fallback pattern as pickMissAimedFlightDir's side vector.
    axis = cross(fromDir, { x: 0, y: 1, z: 0 });
    if (Math.hypot(axis.x, axis.y, axis.z) < 1e-6) axis = cross(fromDir, { x: 1, y: 0, z: 0 });
  }
  axis = normalize(axis);

  drift.turn = {
    axis, angleTotal, fromDir, speed,
    elapsed: 0,
    duration: TURN_TUNING.duration,
    rollTurns: randRange(TURN_TUNING.minRollTurns, TURN_TUNING.maxRollTurns)
  };
  // the incidental cosmetic roll (advanceBarrelRoll) is superseded by the turn's own continuous
  // roll below — clear it so the two don't stack once the turn finishes.
  drift.rollTimer = 0;
  drift.rollOffsetPrev = undefined;
}

// Advances an in-progress turn-around by dt: sweeps the heading along its recorded great-circle arc
// (eased) while continuously spinning the hull (linear in time, for a steady roll rate) — then
// integrates position along the current (curving) heading, same as normal ballistic flight.
function advanceDriftTurn(enemy: EnemyShip, drift: NonNullable<EnemyShip['drift']>, dt: number): void {
  const turn = drift.turn;
  if (!turn) return;
  turn.elapsed = Math.min(turn.duration, turn.elapsed + dt);
  const t = turn.elapsed / turn.duration;

  const heading = rotateAboutAxis(turn.fromDir, turn.axis, turn.angleTotal * smoothstep(t));
  enemy.vel = { x: heading.x * turn.speed, y: heading.y * turn.speed, z: heading.z * turn.speed };
  enemy.pos.x += enemy.vel.x * dt;
  enemy.pos.y += enemy.vel.y * dt;
  enemy.pos.z += enemy.vel.z * dt;

  const rollAngle = turn.rollTurns * Math.PI * 2 * t;
  enemy.quat = quatMultiply(lookAtQuat(heading), rollQuat(rollAngle));

  if (turn.elapsed >= turn.duration) {
    drift.turn = undefined;
    drift.rollCooldown = BARREL_ROLL_COOLDOWN; // pause the incidental roll right after this big one
  }
}

// Ballistic straight-line flight, no steering — orientation just faces the direction of travel.
// Once it's flown turnDist past the player it banks into a long reversal (see startDriftTurn)
// instead of despawning, so the same drone keeps making passes rather than popping in and out.
export function driftThink(enemy: EnemyShip, player: Ship, dt: number, aggressiveness: number = 0.5): void {
  const drift = enemy.drift;
  if (drift?.turn) {
    advanceDriftTurn(enemy, drift, dt);
    return;
  }

  enemy.pos = {
    x: enemy.pos.x + enemy.vel.x * dt,
    y: enemy.pos.y + enemy.vel.y * dt,
    z: enemy.pos.z + enemy.vel.z * dt
  };
  enemy.quat = lookAtQuat(enemy.vel);
  if (drift) {
    const roll = advanceBarrelRoll(drift, computeAxes(enemy.quat), dt);
    if (roll.angle > 0) {
      // pos here is integrated incrementally tick-to-tick (unlike the orbiter's from-scratch
      // recompute), so last tick's offset is already baked in — apply only the delta so the
      // corkscrew doesn't compound on top of itself
      const prev = drift.rollOffsetPrev ?? { x: 0, y: 0, z: 0 };
      enemy.pos.x += roll.offset.x - prev.x;
      enemy.pos.y += roll.offset.y - prev.y;
      enemy.pos.z += roll.offset.z - prev.z;
      drift.rollOffsetPrev = roll.offset;
      enemy.quat = quatMultiply(enemy.quat, rollQuat(roll.angle));
    } else {
      drift.rollOffsetPrev = undefined;
    }
  }

  const toDrone = { x: enemy.pos.x - player.pos.x, y: enemy.pos.y - player.pos.y, z: enemy.pos.z - player.pos.z };
  const dist = Math.hypot(toDrone.x, toDrone.y, toDrone.z);
  // only trigger while actually flying away from the player — otherwise a drone that just finished
  // a turn-around (now heading back in, but still farther than turnDist) would immediately bank
  // into another one every tick until it closes the distance.
  const movingAway = dot(enemy.vel, toDrone) > 0;
  if (dist > DRIFTER_TUNING.turnDist && movingAway && drift) {
    startDriftTurn(enemy, drift, player, aggressiveness);
  }
}
