export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface AngularState {
  pitch: number;
  yaw: number;
  roll: number;
}

export interface ShipType {
  name: string;
  mass: number;    // gameplay-tuning mass, used as rotational inertia too — see physics/step.ts
  massKg: number;  // real-world reference mass in kg, informational only — not yet used by
                   // physics (no established conversion from this to the tuning `mass` above)
  linearThrust: { main: number; retro: number; strafe: number; verticalUp: number; verticalDown: number };
  angularThrust: AngularState;      // == maxAngVel * angularDrag per axis — see shipTypes.ts
  mainSpoolDelay: number;             // seconds of continuous forward throttle (non-boosted) before
  retroSpoolDelay: number;            // main/retro thrust actually starts applying — a short real
                                      // startup lag measured at the very start of a standing-start
                                      // throttle press, separately timed for each direction (they're
                                      // different thrusters). Only gates main/retro (throttle), not
                                      // strafe/vertical/boost — see physics/flightModel.ts and
                                      // shipTypes.ts
  verticalSpoolDelay: number;        // same idea as main/retroSpoolDelay, but for vertical
                                      // strafe (up/down share one delay — no data distinguishing
                                      // them) — see physics/flightModel.ts and shipTypes.ts
  linearDrag: number;                // proportional drag while actively thrusting (coupled, not
                                      // boosting) — for the Gladius this is measured to be
                                      // essentially negligible (thrust applies almost unopposed;
                                      // the flight-computer speed limiter below, not drag, is what
                                      // stops it at scmSpeed) — see shipTypes.ts. Don't assume this
                                      // is always true for other ships without measuring first.
  boostLinearDrag: number;           // same, but while boosting — measured much lower than linearDrag
                                      // (boost trades agility for top speed, not just "more thrust") —
                                      // see shipTypes.ts
  coastDecel: number;                // m/s^2, constant-force auto-brake applied in coupled mode when
                                      // there's no throttle/strafe input at all (and not actively
                                      // braking) — real Gladius sheds speed at a flat rate here, not
                                      // proportional drag (which would taper as speed drops) — see
                                      // physics/flightModel.ts and shipTypes.ts
  brakeGain: number;                 // 1/s — space-brake velocity-controller gain. The flight
                                      // computer commands a deceleration proportional to current
                                      // speed (brakeGain * speed), saturated at the combined-axis
                                      // thruster capacity, so braking eases off near zero instead of
                                      // stopping flat — measured, see flightModel.ts / shipTypes.ts.
  angularDrag: AngularState;         // per-axis — real Gladius spins down at a different rate per axis
  maxAngVel: AngularState;
  scmSpeed: number;                 // coupled-mode speed cap, forward (local +Z velocity)
  scmSpeedBack: number;             // coupled-mode speed cap, backward (local -Z velocity)
  boostSpeedForward: number;        // coupled-mode speed cap while boosting, forward
  boostSpeedBack: number;           // coupled-mode speed cap while boosting, backward
  // Boost meter — real-game measurement (see shipTypes.ts) shows it isn't a plain linear
  // drain/recharge: there's a "red zone" below which both rates change, plus a short delay before
  // recharge kicks back in after boost stops. boostCapacity is kept as a percent (0-100) so the
  // zone/rate fields below are directly in the same units as the meter itself.
  boostCapacity: number;             // full-scale value of the meter (100 == a full percent scale)
  boostRedZonePct: number;           // meter % at/below which the red-zone drain/recharge rates apply
  boostReactivatePct: number;        // meter % a NEW boost burn requires before it may START — an
                                      // ALREADY-ACTIVE burn is unaffected and may continue draining
                                      // straight through the red zone down to 0
  boostDrainRate: number;            // %/s drain while boosting, above boostRedZonePct
  boostDrainRateRedZone: number;     // %/s drain while boosting, at/below boostRedZonePct — measured
                                      // faster than the above-redline rate
  boostRechargeRate: number;         // %/s recovery while not boosting, at/above boostRedZonePct
  boostRechargeRateRedZone: number;  // %/s recovery while not boosting, below boostRedZonePct —
                                      // measured much faster than the above-redline recharge
  boostRechargeDelaySec: number;     // seconds after boost stops before recharge begins at all
  boostMaxAngVel: AngularState;     // rotation-rate cap while boosting
  boostAngularThrust: AngularState; // == boostMaxAngVel * angularDrag per axis — same derivation as angularThrust
  // main/retro thrust while boosting — == boostSpeedForward/Back * boostLinearDrag * mass, so continuous
  // boost thrust actually converges to the documented boosted top speed under drag instead of just
  // raising the speed cap without the thrust to ever reach it (same derivation as angularThrust).
  // No boosted strafe/vertical — real SC's afterburner only affects the main engine.
  boostLinearThrust: { main: number; retro: number };
  hullRadius: number;                // sphere radius (m) used for hit detection and hull silhouette drawing
}

export interface Ship {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: AngularState;
  throttle: number; // -1..1, main/retro thrust intent
  decoupled: boolean;
  spaceBrakeOn: boolean;
  boostMeter: number; // percent (0..type.boostCapacity) of boost remaining — see ShipType's boost
                       // meter fields for the zoned drain/recharge model this is driven by
  boosting: boolean;  // whether boost is actually in effect this frame (requested AND meter > 0)
  boostCooldownTimer: number; // seconds remaining before the meter is allowed to start recharging —
                               // see resolveBoost/ShipType.boostRechargeDelaySec
  exploding: boolean;
  explosionTimer: number;
  health?: Health; // present only while a combat scenario is active — absent in free flight
  hitFlash: number; // 0..1, set to 1 when the player takes a hit, decays over time (see physics/step.ts)
  throttleSpoolTime: number; // seconds of continuous non-zero throttle so far — see
                              // ShipType.mainSpoolDelay/retroSpoolDelay and physics/flightModel.ts
  verticalSpoolTime: number; // same idea, for vertical strafe — see ShipType.verticalSpoolDelay
}

// Generic points pool for combat scenarios. Currently every hit subtracts a flat 1 point (no
// weapon-damage model yet) — but `applyDamage` already takes an amount, so a future per-weapon
// damage value plugs in without changing this shape.
export interface Health {
  points: number;
  maxPoints: number;
}

export type EnemyBehavior =
  | 'turret'   // stationary, just rotates in place to track and fire — see scenarios/runtime.ts
  | 'fighter'  // full Newtonian flight, driven by combat/enemyAI.ts through physics/flightModel.ts
  | 'chaser'   // holds station behind the player and fires — see combat/enemyAI.ts chaserThink
  | 'orbiter'  // circles a fixed point near the player at a fixed radius, harmless — see combat/enemyAI.ts orbiterThink
  | 'drifter'  // straight-line pass-by, harmless, banks into a long reversal roll once out of range
               // instead of despawning — see combat/enemyAI.ts driftThink
  | 'cruiser'  // flies dead straight at its spawn velocity forever, no steering, harmless — see combat/enemyAI.ts cruiseThink
  | 'evasive'; // Evasive Pilot drill only — holds station just ahead of the player's nose, roll-matched,
               // juking hard and unpredictably to defeat lead/lag pip prediction — see combat/enemyAI.ts evasiveThink

// Per-enemy state for the 'orbiter' behavior — a fixed circular path around a world-space point
// fixed at spawn/respawn time (near the player, but not re-centered every tick — see
// combat/enemyAI.ts orbiterThink for why: continuously recentering on the player's live position
// pins the drone at exactly `radius` away forever, making it impossible to close or open distance
// by flying). `planeRight`/`planeUp` are a random orthonormal pair fixed at spawn, so the ring holds
// a stable orientation in world space rather than tracking the player's own facing.
export interface OrbitState {
  center: Vec3;
  radius: number;
  angularSpeed: number; // rad/s
  phase: number;         // current angle, radians — advanced each tick
  planeRight: Vec3;
  planeUp: Vec3;
  respawnTimer: number;  // elapsed seconds since death, 0 while alive — see scenarios/runtime.ts
  rollTimer?: number;      // seconds remaining in an active barrel-roll maneuver, undefined/0 = not rolling
  rollCooldown?: number;   // seconds until eligible to trigger another barrel roll — see enemyAI.ts
  rollAxisRight?: Vec3;    // corkscrew's fixed right/up basis, captured when a roll triggers — see
  rollAxisUp?: Vec3;       // enemyAI.ts's advanceBarrelRoll
}

// An in-progress turn-around maneuver — see combat/enemyAI.ts's startDriftTurn/advanceDriftTurn.
export interface DriftTurnState {
  fromDir: Vec3;      // heading at the moment the turn started (unit vector)
  axis: Vec3;         // unit rotation axis the heading sweeps around, fromDir -> the new heading
  angleTotal: number; // radians between fromDir and the new heading
  speed: number;      // m/s, held constant through the turn (same as the pass before it)
  elapsed: number;    // seconds into the turn so far
  duration: number;   // total seconds the turn takes
  rollTurns: number;  // full rotations about its own axis over the course of the turn
}

// Per-enemy state for the 'drifter' behavior — ballistic straight-line flight, no steering.
export interface DriftState {
  respawnTimer: number; // elapsed seconds since death, 0 while alive — see scenarios/runtime.ts
  rollTimer?: number;    // see OrbitState.rollTimer
  rollCooldown?: number; // see OrbitState.rollCooldown
  rollAxisRight?: Vec3;  // see OrbitState.rollAxisRight/rollAxisUp
  rollAxisUp?: Vec3;
  rollOffsetPrev?: Vec3; // last tick's applied corkscrew offset — pos here is integrated
                         // incrementally (unlike the orbiter's from-scratch recompute), so this is
                         // needed to apply only the delta each tick instead of compounding it
  turn?: DriftTurnState; // set while banking through a turn-around — see driftThink
}

// Difficulty knobs for the 'fighter' behavior (see combat/enemyAI.ts for how each is used, and its
// FIGHTER_TUNING_ACE / FIGHTER_TUNING_ROOKIE presets). Defined here rather than in enemyAI.ts so
// EnemySpawnConfig (scenarios/types.ts) can reference the type without importing combat code.
export interface FighterTuning {
  steerGain: number;             // proportional steering aggressiveness (quaternion-error -> stick)
  engageRange: number;           // ideal stand-off distance for gunnery, meters
  engageBand: number;            // tolerance around engageRange before throttle corrects
  closeRange: number;            // beyond this, burn straight at the player to close distance
  closeBoost: boolean;           // whether it burns boost while closing distance — a hesitant
                                  // pilot redlining the afterburner on approach isn't just
                                  // out-of-character, it also means a much higher merge speed to
                                  // recover from if the pass leaves it overshooting past the target
  fireRange: number;             // won't pull the trigger past this range
  fireLateralTolerance: number;  // meters of allowed miss at the target, implied by aim-error * range
  overshootAngleRad: number;     // aim error beyond which it gives up turning and extends instead
  repositionExtendBias: number;  // 0..1 weight on "keep extending" vs "turn back toward the player"
  repositionBoost: boolean;      // whether it burns boost while repositioning
  repositionMaxSeconds: number;  // hard cap on continuous time spent in 'reposition' — a high
                                  // repositionExtendBias combined with a slow turn rate can make the
                                  // aim-angle convergence that normally ends this mode take a very
                                  // long time in the worst-case merge geometry (nose pointed almost
                                  // exactly away from the target); this forces it back to 'close'
                                  // regardless of aim angle once it's clearly not converging in a
                                  // reasonable time, so the target can't run indefinitely
  threatRange: number;           // player must be this close to be treated as a real threat
  threatConeRad: number;         // how tightly the player must be boresighted on us to evade
  evadeMinSeconds: number;       // minimum time spent evading once triggered, avoids flicker
  modeCommitSeconds: number;     // minimum time spent in whatever mode evade hands off to, so a
                                  // player holding station on our six can't re-trigger evade before
                                  // we've had a real chance to turn and fight back — without this a
                                  // sustained tail-chase re-arms the evade timer every single frame
                                  // (the threat condition never actually goes away) and it flees forever
  weaveFreq: number;             // rad/s, engage/evade weave oscillation speed
}

// Persistent per-enemy AI memory for the 'fighter' behavior — a small state machine plus timers
// so its maneuvering has continuity frame to frame instead of re-deciding from scratch every tick.
export interface FighterAIMemory {
  mode: 'close' | 'engage' | 'evade' | 'reposition';
  modeTimer: number; // seconds remaining before the current mode may be involuntarily overridden
  clock: number;     // free-running elapsed seconds, used to phase weave/jink oscillations
  jinkSeed: number;  // randomized per spawn so multiple fighters don't jink in lockstep
  repositionElapsed: number; // continuous seconds spent in 'reposition' so far — see
                              // FighterTuning.repositionMaxSeconds; reset to 0 whenever the mode
                              // isn't 'reposition'
  tuning: FighterTuning;
}

// Persistent per-enemy AI memory for the 'evasive' behavior (Evasive Pilot drill) — see
// combat/enemyAI.ts's evasiveThink/spawnEvasiveState/EVASIVE_TUNING for how each field is used.
export interface EvasiveAIMemory {
  jinkStrafeX: number;        // currently-committed lateral/vertical strafe command, chosen by the
  jinkStrafeY: number;        // receding-horizon MPC planner (see combat/enemyAI.ts's evasiveThink) —
                               // held fixed until the next replan, not smoothly converged toward
  jinkBoost: boolean;         // whether the current MPC-chosen jink candidate also wants boost
  jinkReplanTimer: number;    // seconds remaining before the MPC planner re-evaluates candidates
  mode: 'block' | 'shootback'; // 'shootback' only ever entered when the drill's return-fire option is on
  modeTimer: number;
  wasThreatened: boolean;     // whether the player's shot would have landed as of last tick — see
                               // evasiveThink's rising-edge break-now reaction on this flag
  chasing: boolean;           // true while temporarily nose-forward (not nose-on-player) to use full
                               // main-engine thrust for a genuine forward-speed deficit — see
                               // evasiveThink's chase/watch facing hysteresis for why this exists
  chaseStruggleTimer: number; // seconds spent chasing without the tracking deficit meaningfully
                               // shrinking — once this crosses a limit, evasiveThink gives up
                               // physically out-turning the player (a losing battle once the player
                               // holds a sustained turn at a rate the drone can't out-rotate, since
                               // both fly the same ship) and forces an immediate break instead — see
                               // evasiveThink's "give up chasing, force a break" doc comment
  chaseCooldownTimer: number; // seconds remaining before 'chasing' is allowed to re-engage after a
                               // forced break, so it doesn't immediately re-enter the same losing
                               // chase it just gave up on
}

// A scenario-spawned opponent. Deliberately not a full `Ship` — no player-console concepts like
// spaceBrakeOn or exploding. `angVel`/`boostMeter`/`boosting` are only actually driven by physics
// for 'fighter' behavior, but kept non-optional since EnemyShip must satisfy FlightBody (see
// physics/flightModel.ts) to be integrated by the same flight model as the player ship.
export interface EnemyShip {
  type: ShipType;
  pos: Vec3;
  quat: Quat;
  vel: Vec3;
  angVel: AngularState;
  boostMeter: number;
  boosting: boolean;
  boostCooldownTimer: number; // see Ship.boostCooldownTimer
  throttleSpoolTime: number; // see Ship.throttleSpoolTime / ShipType.mainSpoolDelay/retroSpoolDelay
  verticalSpoolTime: number; // see Ship.verticalSpoolTime / ShipType.verticalSpoolDelay
  health: Health;
  behavior: EnemyBehavior;
  turnRateRadPerSec?: number; // 'turret' only — capped aim-turn rate used by rotateTowards
  ai?: FighterAIMemory;       // 'fighter' only
  fireCooldown: number;
  orbit?: OrbitState;       // 'orbiter' only
  drift?: DriftState;       // 'drifter' only
  evasive?: EvasiveAIMemory; // 'evasive' only
}

export type ActionName =
  | 'pitchUp' | 'pitchDown'
  | 'yawLeft' | 'yawRight'
  | 'rollLeft' | 'rollRight'
  | 'strafeForward' | 'strafeBack'
  | 'strafeLeft' | 'strafeRight'
  | 'strafeUp' | 'strafeDown'
  | 'decoupleToggle' | 'spaceBrake' | 'boost' | 'primaryFire' | 'interact';

export type KeyChord = string[]; // KeyboardEvent.code values, ANDed together
export type KeyBindings = Record<ActionName, KeyChord[]>;

export type AxisConcept =
  | 'pitch' | 'yaw' | 'roll'
  | 'strafeLateral' | 'strafeVertical' | 'strafeLongitudinal';

// Resolved from an imported actionmaps.xml: instance -> device -> best-effort letter-to-index guess
export interface XmlAxisBinding {
  instance: string;
  axis: string;
  scName: string;
  manual?: false;
}

// Captured live by wiggling a stick — exact vid/pid/array-index, no guessing
export interface ManualAxisBinding {
  vid: string;
  pid: string;
  axisIndex: number;
  label: string;
  manual: true;
  // Capability fingerprint, to tell apart two devices sharing a vid/pid (e.g. two vJoy sticks
  // configured with different axis/button counts). Optional so presets saved before this existed
  // still load — see gamepadModule.DeviceRef / findDevice.
  axisCount?: number;
  buttonCount?: number;
}

export type AxisBinding = XmlAxisBinding | ManualAxisBinding;
export type AxisMap = Partial<Record<AxisConcept, AxisBinding>>;

export interface ButtonBinding {
  vid: string;
  pid: string;
  buttonIndex: number;
  label: string;
  // Capability fingerprint for same-model devices — see ManualAxisBinding above.
  axisCount?: number;
  buttonCount?: number;
}
export type ButtonMap = Partial<Record<ActionName, ButtonBinding>>;

// Mouse-button binding — a separate concept from a joystick ButtonBinding (no vid/pid: there's
// only ever one system mouse), resolved via native MouseEvent.button rather than the Gamepad API.
export interface MouseButtonBinding {
  button: number; // MouseEvent.button: 0=left, 1=middle, 2=right, 3=back, 4=forward
  label: string;
}
export type MouseButtonMap = Partial<Record<ActionName, MouseButtonBinding>>;

export interface ScDevice {
  instance: string;
  name: string;
  guid: string | null;
  vid: string | null;
  pid: string | null;
}

export interface GamepadSnapshot {
  index: number;
  id: string;
  axesValues: number[];
  buttonsPressed: boolean[];
  vid: string | null;
  pid: string | null;
}

export interface Projectile {
  pos: Vec3;
  vel: Vec3;
  age: number;
  owner: 'player' | 'enemy';
}

export interface StickAxes {
  lateral: number | null;
  vertical: number | null;
  longitudinal: number | null;
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
}
