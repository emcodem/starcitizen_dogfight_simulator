import type { EnemyShip, FighterAIMemory, FighterTuning, OrbitState, Quat, Ship, Vec3 } from '../types';
import type { FlightInputs } from '../physics/flightModel';
import { computeAxes, lookAtQuat, quatMultiply } from '../math/quaternion';
import { clamp, cross, normalize } from '../math/vec';
import { computeLeadPoint } from './leadIndicator';
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
function steeringToward(current: Quat, dir: Vec3, gain: number): { pitch: number; yaw: number; roll: number } {
  const target = lookAtQuat(dir);
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
  respawnDelaySec: 1.5
};

export const DRIFTER_TUNING = {
  minSpawnDist: 500, maxSpawnDist: 900,  // meters from the player at spawn
  minSpeed: 90, maxSpeed: 160,           // m/s, constant for the whole pass
  minMissDistance: 40, maxMissDistance: 150, // meters — how far off-center the flight line passes the player
  despawnDist: 1400,                     // meters — recycles once it's flown this far past the player
  respawnDelaySec: 1.0
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

// Advances the orbit and re-derives pos/vel/quat from it around the fixed `orbit.center` (set at
// spawn/respawn — see spawnOrbitState) — NOT the player's live position, so flying toward or away
// from the ring actually changes the distance to it instead of the orbit re-centering underneath
// you every tick and holding you at `radius` forever. vel is the analytic derivative of the
// position formula (the tangential orbit term), not a finite difference, so computeLeadPoint gets
// a real velocity to lead against instead of one frame of jitter.
export function orbiterThink(enemy: EnemyShip, dt: number): void {
  const orbit = enemy.orbit;
  if (!orbit) return;
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

export function spawnDriftState(player: Ship, aggressiveness: number = 0.5): { pos: Vec3; vel: Vec3 } {
  const dir = normalize({ x: Math.random() - 0.5, y: Math.random() - 0.5, z: Math.random() - 0.5 });
  const spawnDist = randRange(DRIFTER_TUNING.minSpawnDist, DRIFTER_TUNING.maxSpawnDist);
  const pos: Vec3 = {
    x: player.pos.x + dir.x * spawnDist,
    y: player.pos.y + dir.y * spawnDist,
    z: player.pos.z + dir.z * spawnDist
  };

  // aim roughly back at the player, offset sideways by a random miss distance so it streaks past
  // rather than colliding — more aggressive drills pass closer (tighter tracking window)
  const towardPlayer = normalize({ x: player.pos.x - pos.x, y: player.pos.y - pos.y, z: player.pos.z - pos.z });
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
  const flightDir = normalize({ x: aimPoint.x - pos.x, y: aimPoint.y - pos.y, z: aimPoint.z - pos.z });
  const speed = randRange(DRIFTER_TUNING.minSpeed, DRIFTER_TUNING.maxSpeed) * droneSpeedMult(aggressiveness);

  return { pos, vel: { x: flightDir.x * speed, y: flightDir.y * speed, z: flightDir.z * speed } };
}

// Ballistic straight-line flight, no steering — orientation just faces the direction of travel.
// Returns true once it's flown far enough past the player that it should be recycled.
export function driftThink(enemy: EnemyShip, player: Ship, dt: number): boolean {
  enemy.pos = {
    x: enemy.pos.x + enemy.vel.x * dt,
    y: enemy.pos.y + enemy.vel.y * dt,
    z: enemy.pos.z + enemy.vel.z * dt
  };
  enemy.quat = lookAtQuat(enemy.vel);
  if (enemy.drift) {
    const roll = advanceBarrelRoll(enemy.drift, computeAxes(enemy.quat), dt);
    if (roll.angle > 0) {
      // pos here is integrated incrementally tick-to-tick (unlike the orbiter's from-scratch
      // recompute), so last tick's offset is already baked in — apply only the delta so the
      // corkscrew doesn't compound on top of itself
      const prev = enemy.drift.rollOffsetPrev ?? { x: 0, y: 0, z: 0 };
      enemy.pos.x += roll.offset.x - prev.x;
      enemy.pos.y += roll.offset.y - prev.y;
      enemy.pos.z += roll.offset.z - prev.z;
      enemy.drift.rollOffsetPrev = roll.offset;
      enemy.quat = quatMultiply(enemy.quat, rollQuat(roll.angle));
    } else {
      enemy.drift.rollOffsetPrev = undefined;
    }
  }
  const dist = Math.hypot(enemy.pos.x - player.pos.x, enemy.pos.y - player.pos.y, enemy.pos.z - player.pos.z);
  return dist > DRIFTER_TUNING.despawnDist;
}
