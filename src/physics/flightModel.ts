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

  // angular drag (dampening — simulates RCS auto-dampening like SC's flight computer)
  body.angVel.pitch -= (body.angVel.pitch * t.angularDrag / t.mass) * dt;
  body.angVel.yaw   -= (body.angVel.yaw   * t.angularDrag / t.mass) * dt;
  body.angVel.roll  -= (body.angVel.roll  * t.angularDrag / t.mass) * dt;

  body.angVel.pitch = clamp(body.angVel.pitch, -maxAngVel.pitch, maxAngVel.pitch);
  body.angVel.yaw   = clamp(body.angVel.yaw,   -maxAngVel.yaw,   maxAngVel.yaw);
  body.angVel.roll  = clamp(body.angVel.roll,  -maxAngVel.roll,  maxAngVel.roll);

  body.quat = integrateOrientation(body.quat, body.angVel, dt);

  const { forward, right, up } = computeAxes(body.quat);

  const strafeX = clamp(input.strafeX, -1, 1);
  const strafeY = clamp(input.strafeY, -1, 1);
  const throttle = clamp(input.throttle, -1, 1);

  const mainThrustMag = throttle >= 0 ? throttle * t.linearThrust.main : throttle * t.linearThrust.retro;
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
  // axis is moving — stacking the passive coupled-mode drag on top of that let full brake
  // decelerate harder than the ship's strongest thruster could ever accelerate it (retro/main
  // thrust decel plus drag-at-speed together exceeded either alone). Skip the passive drag while
  // actively braking so total deceleration stays bounded by real thrust, same as normal thrust.
  // Also skipped entirely in decoupled mode — no auto-damping, so you coast freely on whatever
  // velocity you have, same as SC's decoupled flight.
  if (!input.decoupled && !input.brake) {
    const drag = t.linearDrag;
    body.vel.x -= body.vel.x * drag * dt;
    body.vel.y -= body.vel.y * drag * dt;
    body.vel.z -= body.vel.z * drag * dt;
  }

  // Flight computer speed limiter: hard-caps velocity at SCM speed (or the ship's separate, lower
  // reverse-speed cap when actually flying backward relative to its own nose), raised to the
  // ship's (directional) boost speed while boosting. Enforced regardless of decoupled — in SC,
  // decoupling removes the auto-damping that kills your drift when you let go of the stick, but
  // it does NOT let you exceed SCM/boost speed; the instant a boost ends, speed still snaps back
  // down to the normal (non-boosted) cap even while decoupled.
  const forwardSpeed = body.vel.x * forward.x + body.vel.y * forward.y + body.vel.z * forward.z;
  const speedCap = body.boosting
    ? (forwardSpeed >= 0 ? t.boostSpeedForward : t.boostSpeedBack)
    : (forwardSpeed >= 0 ? t.scmSpeed : t.scmSpeedBack);
  const speed = Math.hypot(body.vel.x, body.vel.y, body.vel.z);
  if (speed > speedCap) {
    const scale = speedCap / speed;
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
