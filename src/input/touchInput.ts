// TouchInput — analog axis channel for the on-screen touch sticks and device-gyro roll.
//
// Written only by ui/touchControls.ts, read once per physics tick by physics/step.ts.
// Mirrors the JoystickAxes.read() / MouseLook.consume() pattern so touch input sums
// *additively* with keyboard/mouse/joystick rather than overriding any of them — the
// same invariant that keeps the joystick fully optional keeps touch fully optional too.
//
// Signs are chosen so each value can be added straight onto its physics accumulator with
// the same polarity the keyboard actions use (see physics/step.ts):
//   pitch  += (pitchUp = -1)  -> stick pushed up gives a negative pitch
//   yaw    += (yawRight = +1) -> stick pushed right gives a positive yaw
//   strafeX+= (strafeRight=+1)-> stick pushed right gives a positive x
//   strafeY+= (strafeUp = +1) -> stick pushed up gives a positive y
//   roll   += (rollRight=+1)  -> device tilted right (clockwise) gives a positive roll

export interface TouchAxes {
  pitch: number;
  yaw: number;
  roll: number;
  strafeX: number;
  strafeY: number;
}

const axes: TouchAxes = { pitch: 0, yaw: 0, roll: 0, strafeX: 0, strafeY: 0 };

export function read(): TouchAxes {
  return axes;
}

// Right stick — aim (pitch/yaw).
export function setAim(pitch: number, yaw: number): void {
  axes.pitch = pitch;
  axes.yaw = yaw;
}

// Left stick — lateral/vertical strafe translation.
export function setStrafe(x: number, y: number): void {
  axes.strafeX = x;
  axes.strafeY = y;
}

// Device gyro (opt-in) — roll only.
export function setRoll(roll: number): void {
  axes.roll = roll;
}
