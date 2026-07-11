// TouchInput — analog axis channel for the on-screen touch sticks and device-gyro roll.
//
// Written only by ui/touchControls.ts, read once per physics tick by physics/step.ts.
// Mirrors the JoystickAxes.read() / MouseLook.consume() pattern so touch input sums
// *additively* with keyboard/mouse/joystick rather than overriding any of them — the
// same invariant that keeps the joystick fully optional keeps touch fully optional too.
//
// Signs are chosen so each value can be added straight onto its physics accumulator with
// the same polarity the keyboard actions use (see physics/step.ts):
//   pitch   += (pitchUp = -1)     -> right stick up gives a negative pitch
//   yaw     += (yawRight = +1)    -> right stick right gives a positive yaw
//   strafeX += (strafeRight = +1) -> left stick right gives a positive x
//   throttle+= (strafeForward=+1) -> left stick up gives a positive throttle
//   roll    += (rollRight = +1)   -> device banked right (clockwise) gives a positive roll
//   pitch   += (from gyro)        -> device tilted nose-down adds a positive pitch
//
// Current control layout:
//   right stick -> pitch + yaw       left stick -> lateral strafe + forward/back throttle
//   gyro (opt-in) -> roll + pitch
// Pitch has two independent sources (right stick and gyro), so they're tracked separately
// here and summed in read() rather than overwriting one another — same additive rule the
// rest of the input pipeline follows.

export interface TouchAxes {
  pitch: number;
  yaw: number;
  roll: number;
  strafeX: number;
  strafeY: number;
  throttle: number;
}

// component state, split by source so the two pitch contributors don't clobber each other
const stickInput = { pitch: 0, yaw: 0, strafeX: 0, throttle: 0 };
const gyroInput = { roll: 0, pitch: 0 };

export function read(): TouchAxes {
  return {
    pitch: stickInput.pitch + gyroInput.pitch,
    yaw: stickInput.yaw,
    roll: gyroInput.roll,
    strafeX: stickInput.strafeX,
    strafeY: 0, // vertical strafe is currently unmapped on touch
    throttle: stickInput.throttle
  };
}

// Right stick — aim (pitch/yaw).
export function setAim(pitch: number, yaw: number): void {
  stickInput.pitch = pitch;
  stickInput.yaw = yaw;
}

// Left stick — x = lateral strafe, y = forward/back throttle.
export function setLeftStick(strafeX: number, throttle: number): void {
  stickInput.strafeX = strafeX;
  stickInput.throttle = throttle;
}

// Device gyro (opt-in) — bank -> roll, forward/back tilt -> pitch. The two are physically
// decoupled (bank rotates about the screen normal, tilt about a screen-plane axis), so
// they're set together from one motion sample.
export function setGyro(roll: number, pitch: number): void {
  gyroInput.roll = roll;
  gyroInput.pitch = pitch;
}
