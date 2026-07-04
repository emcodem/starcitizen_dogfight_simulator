import type { Ship } from '../types';
import { clamp, addScaled } from '../math/vec';
import { computeAxes, integrateOrientation } from '../math/quaternion';
import * as ControlsModule from '../input/controlsModule';
import * as GamepadModule from '../input/gamepadModule';
import * as JoystickAxes from '../input/joystickAxes';
import * as JoystickButtons from '../input/joystickButtons';
import * as MouseLook from '../input/mouseLook';
import { STATION } from '../world/station';
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

  // decouple is a real toggle (edge-detected, fires once per press); space brake is
  // hold-to-brake, not a toggle — active for exactly as long as the key/button is held
  if (JoystickButtons.justPressed('decoupleToggle')) ship.decoupled = !ship.decoupled;
  ship.spaceBrakeOn = ControlsModule.isActive('spaceBrake') || JoystickButtons.isPressed('spaceBrake');

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

  ship.angVel.pitch += pitchInput * t.angularThrust.pitch * dt;
  ship.angVel.yaw   += yawInput   * t.angularThrust.yaw   * dt;
  ship.angVel.roll  += rollInput  * t.angularThrust.roll  * dt;

  // angular drag (dampening — simulates RCS auto-dampening like SC's flight computer)
  ship.angVel.pitch -= ship.angVel.pitch * t.angularDrag * dt;
  ship.angVel.yaw   -= ship.angVel.yaw   * t.angularDrag * dt;
  ship.angVel.roll  -= ship.angVel.roll  * t.angularDrag * dt;

  // clamp angular velocity
  ship.angVel.pitch = clamp(ship.angVel.pitch, -t.maxAngVel.pitch, t.maxAngVel.pitch);
  ship.angVel.yaw   = clamp(ship.angVel.yaw,   -t.maxAngVel.yaw,   t.maxAngVel.yaw);
  ship.angVel.roll  = clamp(ship.angVel.roll,  -t.maxAngVel.roll,  t.maxAngVel.roll);

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
    // space brake: actively kill velocity, works in either flight mode
    // (in coupled mode this just adds to the normal drag; in decoupled
    // mode there's no passive drag, so this is the only way to stop)
    ship.vel.x -= ship.vel.x * 3 * dt;
    ship.vel.y -= ship.vel.y * 3 * dt;
    ship.vel.z -= ship.vel.z * 3 * dt;
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

    // flight computer speed limiter: hard-caps velocity at SCM speed, same as in-game coupled flight
    const speed = Math.hypot(ship.vel.x, ship.vel.y, ship.vel.z);
    if (speed > t.scmSpeed) {
      const scale = t.scmSpeed / speed;
      ship.vel.x *= scale;
      ship.vel.y *= scale;
      ship.vel.z *= scale;
    }
  }
  // in decoupled mode, no drag and no speed cap — pure Newtonian coasting, like SC's decoupled flight

  ship.pos.x += ship.vel.x * dt;
  ship.pos.y += ship.vel.y * dt;
  ship.pos.z += ship.vel.z * dt;

  // --- Collision check against the station ---
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

  updateProjectiles(dt, ship);
}
