import type { Ship } from '../types';
import { clamp, addScaled } from '../math/vec';
import { computeAxes, integrateOrientation } from '../math/quaternion';
import * as ControlsModule from '../input/controlsModule';
import * as GamepadModule from '../input/gamepadModule';
import * as JoystickAxes from '../input/joystickAxes';
import * as JoystickButtons from '../input/joystickButtons';
import * as MouseLook from '../input/mouseLook';
import { STATION, isStationActive } from '../world/station';
import { updateProjectiles } from '../world/weapons';
import { resetShip } from '../ship/shipState';

// ---------- Physics step ----------
export function step(ship: Ship, dt: number): void {
  // read the current mouse-look deflection (persists until moved back — see MouseLook)
  const mouseInput = MouseLook.consume();

  // fresh gamepad values every physics tick — not just while the controls panel is
  // open — since actual flight needs current-frame axis data, not a 100ms-stale sample
  GamepadModule.poll();
  const stick = JoystickAxes.read();

  // decouple is a real toggle (edge-detected, fires once per press); space brake and boost are
  // hold-based, not toggles — active for exactly as long as the key/button is held
  if (JoystickButtons.justPressed('decoupleToggle')) ship.decoupled = !ship.decoupled;
  ship.spaceBrakeOn = ControlsModule.isActive('spaceBrake') || JoystickButtons.isPressed('spaceBrake');

  // boost meter: drains while boosting, recharges while not — clamped so it can't go
  // negative or over capacity. Actual boost only takes effect while there's charge left.
  const boostRequested = ControlsModule.isActive('boost') || JoystickButtons.isPressed('boost');
  ship.boosting = boostRequested && ship.boostMeter > 0;
  ship.boostMeter = clamp(
    ship.boostMeter + (ship.boosting ? -dt : dt * ship.type.boostRechargeRate),
    0,
    ship.type.boostCapacity
  );

  // if we just crashed, freeze controls and count down the explosion before respawning
  if (ship.exploding) {
    ship.explosionTimer -= dt;
    if (ship.explosionTimer <= 0) resetShip(ship);
    return;
  }

  const t = ship.type;

  // --- Forward/back thrust — direct hold-to-thrust (like the other strafe axes).
  // Keyboard and a bound joystick axis are additive, not either/or, so the joystick
  // stays fully optional: unplugged or unbound, keyboard alone still drives everything. ---
  let throttleInput = 0;
  if (ControlsModule.isActive('strafeForward')) throttleInput += 1;
  if (ControlsModule.isActive('strafeBack')) throttleInput -= 1;
  if (stick.longitudinal !== null) throttleInput += stick.longitudinal;
  ship.throttle = clamp(throttleInput, -1, 1);

  // --- Angular input (rotation thrusters) ---
  let pitchInput = 0, yawInput = 0, rollInput = 0;
  if (ControlsModule.isActive('pitchUp')) pitchInput -= 1;
  if (ControlsModule.isActive('pitchDown')) pitchInput += 1;
  if (ControlsModule.isActive('yawLeft')) yawInput -= 1;
  if (ControlsModule.isActive('yawRight')) yawInput += 1;
  if (ControlsModule.isActive('rollLeft')) rollInput -= 1;
  if (ControlsModule.isActive('rollRight')) rollInput += 1;

  // joystick axes (if bound in the imported actionmaps.xml and currently detected) add
  // on top of keyboard input rather than replacing it — keyboard, mouse, and joystick
  // all work simultaneously; the joystick is purely optional.
  if (stick.pitch !== null) pitchInput += stick.pitch;
  if (stick.yaw !== null) yawInput += stick.yaw;
  if (stick.roll !== null) rollInput += stick.roll;

  // mouse look adds smoothly on top of any keyboard/joystick input
  pitchInput += mouseInput.pitch;
  yawInput += mouseInput.yaw;

  pitchInput = clamp(pitchInput, -1, 1);
  yawInput = clamp(yawInput, -1, 1);
  rollInput = clamp(rollInput, -1, 1);

  // boosting raises RCS authority (angularThrust) and the rotation-rate ceiling (maxAngVel)
  // together — angularThrust is still derived as maxAngVel * angularDrag either way (see
  // shipTypes.ts), so full input converges to the boosted rate instead of the normal one.
  const angularThrust = ship.boosting ? t.boostAngularThrust : t.angularThrust;
  const maxAngVel = ship.boosting ? t.boostMaxAngVel : t.maxAngVel;

  // angularThrust is a torque, not a direct acceleration — dividing by mass (acting here as
  // rotational inertia) means a heavier ship spins up and slows down more sluggishly. This
  // doesn't change the ship's documented max rotation rate: dividing both this term and the
  // angular drag term below by the same mass cancels out in their steady-state ratio
  // (angularThrust/angularDrag, still == maxAngVel — see shipTypes.ts), only the time to get
  // there changes.
  ship.angVel.pitch += (pitchInput * angularThrust.pitch / t.mass) * dt;
  ship.angVel.yaw   += (yawInput   * angularThrust.yaw   / t.mass) * dt;
  ship.angVel.roll  += (rollInput  * angularThrust.roll  / t.mass) * dt;

  // angular drag (dampening — simulates RCS auto-dampening like SC's flight computer)
  ship.angVel.pitch -= (ship.angVel.pitch * t.angularDrag / t.mass) * dt;
  ship.angVel.yaw   -= (ship.angVel.yaw   * t.angularDrag / t.mass) * dt;
  ship.angVel.roll  -= (ship.angVel.roll  * t.angularDrag / t.mass) * dt;

  // clamp angular velocity
  ship.angVel.pitch = clamp(ship.angVel.pitch, -maxAngVel.pitch, maxAngVel.pitch);
  ship.angVel.yaw   = clamp(ship.angVel.yaw,   -maxAngVel.yaw,   maxAngVel.yaw);
  ship.angVel.roll  = clamp(ship.angVel.roll,  -maxAngVel.roll,  maxAngVel.roll);

  ship.quat = integrateOrientation(ship.quat, ship.angVel, dt);

  // --- Build local axes from current orientation — full body frame, including roll,
  // so strafe thrust is truly hull-relative (matches real RCS thrusters fixed to the ship) ---
  const { forward, right, up } = computeAxes(ship.quat);

  // --- Linear thrust — strafe left/right/up/down ---
  const strafeInput = { x: 0, y: 0 }; // x = right/left, y = up/down
  if (ControlsModule.isActive('strafeLeft')) strafeInput.x -= 1;
  if (ControlsModule.isActive('strafeRight')) strafeInput.x += 1;
  if (ControlsModule.isActive('strafeUp')) strafeInput.y += 1;
  if (ControlsModule.isActive('strafeDown')) strafeInput.y -= 1;
  // additive with keyboard, same reasoning as pitch/yaw/roll/throttle above
  if (stick.lateral !== null) strafeInput.x += stick.lateral;
  if (stick.vertical !== null) strafeInput.y += stick.vertical;
  strafeInput.x = clamp(strafeInput.x, -1, 1);
  strafeInput.y = clamp(strafeInput.y, -1, 1);

  const mainThrustMag = ship.throttle >= 0 ? ship.throttle * t.linearThrust.main : ship.throttle * t.linearThrust.retro;
  const accel = { x: 0, y: 0, z: 0 };
  addScaled(accel, forward, mainThrustMag / t.mass);
  addScaled(accel, right, (strafeInput.x * t.linearThrust.strafe) / t.mass);
  addScaled(accel, up, (strafeInput.y * t.linearThrust.vertical) / t.mass);

  if (ship.spaceBrakeOn) {
    // Space brake: counter-thrust in whichever direction the ship is actually moving, using
    // that axis's own real thrust rating (divided by mass, same as normal flight thrust) —
    // not an arbitrary fixed decay constant. Works in either flight mode (in coupled mode this
    // stacks with the normal drag below; in decoupled mode there's no passive drag, so this is
    // the only way to stop).
    //
    // Decompose velocity into the ship's local frame so each axis brakes against its own
    // thrust rating (main forward-decel vs retro backward-decel are asymmetric, like real RCS).
    const localVel = {
      x: ship.vel.x * right.x + ship.vel.y * right.y + ship.vel.z * right.z,          // lateral
      y: ship.vel.x * up.x + ship.vel.y * up.y + ship.vel.z * up.z,                   // vertical
      z: ship.vel.x * forward.x + ship.vel.y * forward.y + ship.vel.z * forward.z     // longitudinal
    };
    const longitudinalThrust = localVel.z > 0 ? t.linearThrust.retro : t.linearThrust.main;

    // decelerate at the ship's max available rate for this axis, but never overshoot past
    // zero into the opposite direction within a single frame
    const decelerate = (v: number, thrust: number): number => {
      const maxDelta = (thrust / t.mass) * dt;
      return Math.abs(v) <= maxDelta ? 0 : v - Math.sign(v) * maxDelta;
    };
    localVel.x = decelerate(localVel.x, t.linearThrust.strafe);
    localVel.y = decelerate(localVel.y, t.linearThrust.vertical);
    localVel.z = decelerate(localVel.z, longitudinalThrust);

    // recompose back into world space (right/up/forward form an orthonormal basis)
    ship.vel.x = right.x * localVel.x + up.x * localVel.y + forward.x * localVel.z;
    ship.vel.y = right.y * localVel.x + up.y * localVel.y + forward.y * localVel.z;
    ship.vel.z = right.z * localVel.x + up.z * localVel.y + forward.z * localVel.z;
  }

  ship.vel.x += accel.x * dt;
  ship.vel.y += accel.y * dt;
  ship.vel.z += accel.z * dt;

  // --- Coupled mode: flight computer bleeds off velocity not aligned with input / auto-brakes ---
  if (!ship.decoupled) {
    const drag = t.linearDrag;
    ship.vel.x -= ship.vel.x * drag * dt;
    ship.vel.y -= ship.vel.y * drag * dt;
    ship.vel.z -= ship.vel.z * drag * dt;

    // flight computer speed limiter: hard-caps velocity at SCM speed (or the ship's separate,
    // lower reverse-speed cap when actually flying backward relative to its own nose), raised
    // to the ship's (directional) boost speed while boosting
    const forwardSpeed = ship.vel.x * forward.x + ship.vel.y * forward.y + ship.vel.z * forward.z;
    const speedCap = ship.boosting
      ? (forwardSpeed >= 0 ? t.boostSpeedForward : t.boostSpeedBack)
      : (forwardSpeed >= 0 ? t.scmSpeed : t.scmSpeedBack);
    const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    if (speed > speedCap) {
      const scale = speedCap / speed;
      ship.vel.x *= scale;
      ship.vel.y *= scale;
      ship.vel.z *= scale;
    }
  }
  // in decoupled mode, no drag and no speed cap — pure Newtonian coasting, like SC's decoupled flight

  ship.pos.x += ship.vel.x * dt;
  ship.pos.y += ship.vel.y * dt;
  ship.pos.z += ship.vel.z * dt;

  // --- Collision check against the station (skipped when a scenario hides it) ---
  if (isStationActive()) {
    const dStation = Math.hypot(
      ship.pos.x - STATION.pos.x,
      ship.pos.y - STATION.pos.y,
      ship.pos.z - STATION.pos.z
    );
    if (dStation < STATION.collisionRadius) {
      ship.exploding = true;
      ship.explosionTimer = 1.0;
      ship.vel = { x: 0, y: 0, z: 0 };
      ship.angVel = { pitch: 0, yaw: 0, roll: 0 };
    }
  }

  updateProjectiles(dt, ship);
}
