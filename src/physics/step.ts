import type { Ship } from '../types';
import type { ScenarioRuntime } from '../scenarios/types';
import { clamp } from '../math/vec';
import { computeAxes } from '../math/quaternion';
import * as ControlsModule from '../input/controlsModule';
import * as GamepadModule from '../input/gamepadModule';
import * as JoystickAxes from '../input/joystickAxes';
import * as JoystickButtons from '../input/joystickButtons';
import * as MouseLook from '../input/mouseLook';
import { STATION, isStationActive } from '../world/station';
import { updateProjectiles } from '../world/weapons';
import { resetShip } from '../ship/shipState';
import { toggleDecoupled } from '../ship/decoupledPersist';
import { integrateFlight, resolveBoost } from './flightModel';
import * as EspAssist from '../combat/espAssist';
import { findActivePip } from '../combat/pipTargeting';

const HIT_FLASH_FADE_SECONDS = 0.4;

// ---------- Physics step ----------
export function step(ship: Ship, dt: number, activeRuntime: ScenarioRuntime | null = null): void {
  // hit-flash cue fades out on its own — combat/hitDetection.ts sets it back to 1 on a fresh hit
  ship.hitFlash = Math.max(0, ship.hitFlash - dt / HIT_FLASH_FADE_SECONDS);

  // read the current mouse-look deflection (persists until moved back — see MouseLook)
  const mouseInput = MouseLook.consume();

  // fresh gamepad values every physics tick — not just while the controls panel is
  // open — since actual flight needs current-frame axis data, not a 100ms-stale sample
  GamepadModule.poll();
  const stick = JoystickAxes.read();

  // decouple is a real toggle (edge-detected, fires once per press); space brake and boost are
  // hold-based, not toggles — active for exactly as long as the key/button is held
  if (JoystickButtons.justPressed('decoupleToggle')) toggleDecoupled(ship);
  ship.spaceBrakeOn = ControlsModule.isActive('spaceBrake') || JoystickButtons.isPressed('spaceBrake');

  const boostRequested = ControlsModule.isActive('boost') || JoystickButtons.isPressed('boost');
  const boost = resolveBoost(ship.type, ship.boostMeter, boostRequested, dt);
  ship.boostMeter = boost.boostMeter;
  ship.boosting = boost.boosting;

  // if we just crashed, freeze controls and count down the explosion before respawning
  if (ship.exploding) {
    ship.explosionTimer -= dt;
    if (ship.explosionTimer <= 0) resetShip(ship);
    return;
  }

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

  // --- ESP: dampen the already-combined pitch/yaw once the crosshair nears the active PIP, but
  // only while the stick itself is also near center — see espAssist.ts's dampingFactor doc ---
  if (activeRuntime) {
    const cam = { pos: ship.pos, axes: computeAxes(ship.quat) };
    const pip = findActivePip(ship.pos, ship.vel, cam, activeRuntime.enemies, window.innerWidth, window.innerHeight);
    if (pip) {
      const screenDist = Math.hypot(pip.screenX - window.innerWidth / 2, pip.screenY - window.innerHeight / 2);
      const stickOffset = MouseLook.getOffset();
      const stickDist = Math.hypot(stickOffset.x, stickOffset.y);
      const factor = EspAssist.dampingFactor(screenDist, stickDist);
      pitchInput *= factor;
      yawInput *= factor;
    }
  }

  // --- Linear thrust — strafe left/right/up/down ---
  const strafeInput = { x: 0, y: 0 }; // x = right/left, y = up/down
  if (ControlsModule.isActive('strafeLeft')) strafeInput.x -= 1;
  if (ControlsModule.isActive('strafeRight')) strafeInput.x += 1;
  if (ControlsModule.isActive('strafeUp')) strafeInput.y += 1;
  if (ControlsModule.isActive('strafeDown')) strafeInput.y -= 1;
  // additive with keyboard, same reasoning as pitch/yaw/roll/throttle above
  if (stick.lateral !== null) strafeInput.x += stick.lateral;
  if (stick.vertical !== null) strafeInput.y += stick.vertical;

  integrateFlight(ship, {
    throttle: ship.throttle,
    pitch: pitchInput,
    yaw: yawInput,
    roll: rollInput,
    strafeX: strafeInput.x,
    strafeY: strafeInput.y,
    brake: ship.spaceBrakeOn,
    decoupled: ship.decoupled
  }, dt);

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

  const fired = updateProjectiles(dt, ship);
  if (fired && activeRuntime) activeRuntime.stats.shotsFired++;
}
