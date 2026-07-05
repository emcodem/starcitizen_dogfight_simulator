import type { AngularState, Quat, ShipType, Vec3 } from '../types';
import { clamp, addScaled } from '../math/vec';
import { computeAxes, integrateOrientation } from '../math/quaternion';

// Ship-shaped state this model reads/mutates — a subset both the player Ship and an AI-flown
// EnemyShip satisfy, so the exact same Newtonian flight model drives both (see combat/enemyAI.ts).
export interface FlightBody {
  type: ShipType;
  pos: Vec3;
  vel: Vec3;
  quat: Quat;
  angVel: AngularState;
  boosting: boolean;
}

// One tick's worth of control intent — everything the model needs to move `body`, however it was
// produced (player input in physics/step.ts, AI decisions in combat/enemyAI.ts).
export interface FlightInputs {
  throttle: number;                          // -1..1, main/retro thrust intent
  pitch: number; yaw: number; roll: number;  // rotation thruster intent (clamped internally)
  strafeX: number; strafeY: number;          // lateral/vertical thruster intent (clamped internally)
  brake: boolean;
  decoupled: boolean;
}

// Applies one physics tick of rotation, thrust, drag, and speed-capping to `body`. Pulled out of
// physics/step.ts so both the player ship and any AI-flown EnemyShip fly on the same rules.
// `body.boosting` is expected to already be resolved by the caller (see resolveBoost below) —
// boost-meter bookkeeping happens on the caller's own schedule (e.g. the player's meter still
// ticks while exploding, see physics/step.ts), so it isn't folded into this function.
export function integrateFlight(body: FlightBody, input: FlightInputs, dt: number): void {
  const t = body.type;

  const pitchInput = clamp(input.pitch, -1, 1);
  const yawInput = clamp(input.yaw, -1, 1);
  const rollInput = clamp(input.roll, -1, 1);

  // boosting raises RCS authority (angularThrust) and the rotation-rate ceiling (maxAngVel)
  // together — angularThrust is still derived as maxAngVel * angularDrag either way (see
  // shipTypes.ts), so full input converges to the boosted rate instead of the normal one.
  const angularThrust = body.boosting ? t.boostAngularThrust : t.angularThrust;
  const maxAngVel = body.boosting ? t.boostMaxAngVel : t.maxAngVel;

  body.angVel.pitch += (pitchInput * angularThrust.pitch / t.mass) * dt;
  body.angVel.yaw   += (yawInput   * angularThrust.yaw   / t.mass) * dt;
  body.angVel.roll  += (rollInput  * angularThrust.roll  / t.mass) * dt;

  // angular drag (dampening — simulates RCS auto-dampening like SC's flight computer) — per axis,
  // since the real ship spins down at a different rate per axis (see shipTypes.ts)
  body.angVel.pitch -= (body.angVel.pitch * t.angularDrag.pitch / t.mass) * dt;
  body.angVel.yaw   -= (body.angVel.yaw   * t.angularDrag.yaw   / t.mass) * dt;
  body.angVel.roll  -= (body.angVel.roll  * t.angularDrag.roll  / t.mass) * dt;

  body.angVel.pitch = clamp(body.angVel.pitch, -maxAngVel.pitch, maxAngVel.pitch);
  body.angVel.yaw   = clamp(body.angVel.yaw,   -maxAngVel.yaw,   maxAngVel.yaw);
  body.angVel.roll  = clamp(body.angVel.roll,  -maxAngVel.roll,  maxAngVel.roll);

  body.quat = integrateOrientation(body.quat, body.angVel, dt);

  const { forward, right, up } = computeAxes(body.quat);

  const strafeX = clamp(input.strafeX, -1, 1);
  const strafeY = clamp(input.strafeY, -1, 1);
  const throttle = clamp(input.throttle, -1, 1);

  // boosting raises main/retro thrust the same way it raises angular thrust above — without this,
  // boosting only lifted the speed *cap* while leaving thrust unchanged, and since linearDrag
  // makes unboosted thrust settle at exactly scmSpeed by construction, the ship could never
  // actually climb to a speed where the higher cap mattered.
  const mainThrust = body.boosting ? t.boostLinearThrust.main : t.linearThrust.main;
  const retroThrust = body.boosting ? t.boostLinearThrust.retro : t.linearThrust.retro;
  const mainThrustMag = throttle >= 0 ? throttle * mainThrust : throttle * retroThrust;
  const accel: Vec3 = { x: 0, y: 0, z: 0 };
  addScaled(accel, forward, mainThrustMag / t.mass);
  addScaled(accel, right, (strafeX * t.linearThrust.strafe) / t.mass);
  addScaled(accel, up, (strafeY * t.linearThrust.vertical) / t.mass);

  if (input.brake) {
    // Space brake: counter-thrust in whichever direction body is actually moving, using that
    // axis's own real thrust rating — decompose velocity into the ship's local frame so each axis
    // brakes against its own thrust rating (main forward-decel vs retro backward-decel differ).
    const localVel = {
      x: body.vel.x * right.x + body.vel.y * right.y + body.vel.z * right.z,          // lateral
      y: body.vel.x * up.x + body.vel.y * up.y + body.vel.z * up.z,                   // vertical
      z: body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z     // longitudinal
    };
    const longitudinalThrust = localVel.z > 0 ? t.linearThrust.retro : t.linearThrust.main;

    const decelerate = (v: number, thrust: number): number => {
      const maxDelta = (thrust / t.mass) * dt;
      return Math.abs(v) <= maxDelta ? 0 : v - Math.sign(v) * maxDelta;
    };
    localVel.x = decelerate(localVel.x, t.linearThrust.strafe);
    localVel.y = decelerate(localVel.y, t.linearThrust.vertical);
    localVel.z = decelerate(localVel.z, longitudinalThrust);

    body.vel.x = right.x * localVel.x + up.x * localVel.y + forward.x * localVel.z;
    body.vel.y = right.y * localVel.x + up.y * localVel.y + forward.y * localVel.z;
    body.vel.z = right.z * localVel.x + up.z * localVel.y + forward.z * localVel.z;
  }

  body.vel.x += accel.x * dt;
  body.vel.y += accel.y * dt;
  body.vel.z += accel.z * dt;

  // brake's decelerate() above already counter-thrusts at the ship's own max rate for whichever
  // axis is moving — stacking any of the below on top of that let full brake decelerate harder
  // than the ship's strongest thruster could ever accelerate it. Skip all of it while actively
  // braking so total deceleration stays bounded by real thrust, same as normal thrust. Also
  // skipped entirely in decoupled mode — no auto-damping, so you coast freely on whatever velocity
  // you have, same as SC's decoupled flight.
  if (!input.decoupled && !input.brake) {
    if (throttle !== 0 || strafeX !== 0 || strafeY !== 0) {
      // proportional drag while actively thrusting on any linear axis — this is what makes thrust
      // settle at exactly scmSpeed/boostSpeedForward instead of accelerating forever (see
      // shipTypes.ts). Boosting uses its own (much lower) boostLinearDrag, not this one.
      const drag = body.boosting ? t.boostLinearDrag : t.linearDrag;
      body.vel.x -= body.vel.x * drag * dt;
      body.vel.y -= body.vel.y * drag * dt;
      body.vel.z -= body.vel.z * drag * dt;
    } else {
      // No input at all: real Gladius sheds speed at a flat rate, not a decaying one (measured —
      // see shipTypes.ts), so this can't be the same proportional drag used above (which would
      // taper off approaching zero). Same bounded-delta shape as the space brake's decelerate()
      // above, just a much gentler constant — and, like it, clamped so it can't overshoot past zero.
      const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
      if (speed > 0) {
        const newSpeed = Math.max(0, speed - t.coastDecel * dt);
        const scale = newSpeed / speed;
        body.vel.x *= scale;
        body.vel.y *= scale;
        body.vel.z *= scale;
      }
    }
  }

  // Flight computer speed limiter: caps velocity at SCM speed (or the ship's separate, lower
  // reverse-speed cap when actually flying backward relative to its own nose), raised to the
  // ship's (directional) boost speed while boosting. Enforced regardless of decoupled — in SC,
  // decoupling removes the auto-damping that kills your drift when you let go of the stick, but
  // it does NOT let you exceed SCM/boost speed. When over cap, speed bleeds down at a bounded
  // rate rather than snapping to the cap in a single frame — a boost wearing off should feel like
  // a deceleration, not a teleport — but that bound must be at least as strong as whatever thrust
  // is actively still feeding the overspeed (e.g. continuing to hold boost right at boostSpeedForward),
  // or thrust stronger than the natural bleed rate would just outrun it and blow through the cap
  // every tick instead of being governed by it. Falls back to the ship's natural thrust-based decel
  // (same mechanism as the space brake above) once nothing is actively pushing against it, e.g.
  // right after a boost ends with no throttle held.
  const forwardSpeed = body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z;
  const speedCap = body.boosting
    ? (forwardSpeed >= 0 ? t.boostSpeedForward : t.boostSpeedBack)
    : (forwardSpeed >= 0 ? t.scmSpeed : t.scmSpeedBack);
  const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
  if (speed > speedCap) {
    const velUnit = { x: body.vel.x / speed, y: body.vel.y / speed, z: body.vel.z / speed };
    const accelAlongVel = accel.x * velUnit.x + accel.y * velUnit.y + accel.z * velUnit.z;
    const naturalBleedRate = (forwardSpeed >= 0 ? t.linearThrust.retro : t.linearThrust.main) / t.mass;
    const decelRate = Math.max(naturalBleedRate, accelAlongVel);
    const maxDelta = decelRate * dt;
    const newSpeed = Math.max(speedCap, speed - maxDelta);
    const scale = newSpeed / speed;
    body.vel.x *= scale;
    body.vel.y *= scale;
    body.vel.z *= scale;
  }

  body.pos.x += body.vel.x * dt;
  body.pos.y += body.vel.y * dt;
  body.pos.z += body.vel.z * dt;
}

// Shared boost-meter bookkeeping: drains while boosting, recharges while not, clamped to
// [0, boostCapacity]. Boost only actually engages if there's meter left, even if requested.
export function resolveBoost(
  type: ShipType,
  boostMeter: number,
  requested: boolean,
  dt: number
): { boostMeter: number; boosting: boolean } {
  const boosting = requested && boostMeter > 0;
  const next = clamp(boostMeter + (boosting ? -dt : dt * type.boostRechargeRate), 0, type.boostCapacity);
  return { boostMeter: next, boosting };
}
