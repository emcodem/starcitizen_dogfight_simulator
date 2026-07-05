import type { ShipType } from '../types';

// Gladius — derived from real SCM data: 226 m/s SCM speed, 100 m/s reverse speed, 68/52/200 deg/s
// pitch/yaw/roll, 520/268 m/s forward/back boost speed, 82/62/240 deg/s boosted pitch/yaw/roll,
// 48,552 kg real mass. Retro/strafe/vertical thrust, and the boost meter's capacity/recharge rate
// (no real data available for those), are estimated.
//
// angularThrust/boostAngularThrust are each set to their corresponding maxAngVel * angularDrag,
// per axis (angularDrag is itself per-axis — see the real-measurement note below; boost reuses the
// same angularDrag as non-boosted, since boost doesn't change RCS dampening, just authority).
// angularDrag is applied every frame proportional to the current angular velocity (see
// physics/flightModel.ts), so the ship settles at a steady state of angularThrust / angularDrag,
// NOT at maxAngVel — the clamp is a ceiling, not a target. Deriving angularThrust this way makes
// full input actually converge to the documented real rotation rate instead of stalling out at
// roughly half of it.
//
// boostLinearThrust is derived the same way as angularThrust above: == boostSpeedForward/Back *
// boostLinearDrag * mass, so the ship actually accelerates through drag up to the documented
// boosted top speed instead of just raising the cap without the thrust to ever reach it. Boost
// uses its own boostLinearDrag rather than reusing linearDrag — real-game measurement (see below)
// showed boosting is far less damped than plain thrust (lower drag, not just more thrust), so
// boostLinearThrust ends up *lower* than plain linearThrust despite the much higher top speed.
//
// coastDecel is a separate, constant (not velocity-proportional) deceleration applied only when
// there's no throttle/strafe input at all in coupled mode (see physics/flightModel.ts) — real
// Gladius sheds speed at a flat rate when you let go of the stick, not a decaying one, so this
// can't be modeled by just cranking up linearDrag (which would taper off approaching zero).
//
// massKg (real mass, 48,552 kg) isn't wired into the physics yet — `mass` below is a separately
// tuned gameplay value used for both linear thrust-to-accel and rotational inertia (see
// physics/step.ts). Recorded here so it's available once a real mass-to-`mass` conversion (or a
// switch to using massKg directly) is worked out.
//
// Real-game measurements (harald, stopwatch/frame-counted against the actual Gladius) behind the
// values below — kept here as the source of truth since the derived tau/drag numbers aren't
// otherwise traceable back to where they came from:
//   - Roll: standing-start 360° in 2.080s, already-spinning 360° in 1.840s (confirms the 200°/s
//     spec) => tau_roll ~= 0.28s => angularDrag.roll = mass/tau = 1.5/0.28 ~= 5.357
//   - Pitch: standing-start 360° in 5s+11 frames (25fps) = 5.44s, vs. 360/68°/s = 5.294s ideal at a
//     constant max rate => tau_pitch ~= 0.146s => angularDrag.pitch = 1.5/0.146 ~= 10.274
//   - Yaw: standing-start 360° in 175 frames (25fps) = 7.000s exactly, vs. 360/52°/s = 6.903s ideal
//     => tau_yaw ~= 0.097s => angularDrag.yaw = 1.5/0.097 ~= 15.464
//   - Forward thrust (not boosted): standing-start speed hits 180 m/s at 1.40s, then 190, 195, 200,
//     203, 208, 214, 216, 217, 218, 220, 222, 223, 223, 224, 224, 224, 224, 225 one frame apart —
//     asymptotes at the documented 226 m/s scmSpeed. Fit gives tau_linear ~= 0.19-0.20s =>
//     linearDrag = 1/tau ~= 5.18 (was 0.6, ~8x too slow to settle before this retune)
//   - Reverse thrust: holding the fly-back key from a dead stop reached 225 m/s (not the previously
//     assumed 100 m/s) => scmSpeedBack raised to 225, matching forward speed almost exactly
//   - Coasting deceleration: releasing forward thrust at cruise speed loses ~8 m/s every 5 frames
//     (25fps) = a flat 40 m/s^2 the whole way to a stop, not a decaying rate => coastDecel = 40
//   - Boosted forward thrust: standing-start with boost held the whole time, frame-by-frame to
//     402 m/s (0->98->200->305->402 over 17/13/12/15 frames) then coarser splits to 512 by 4.68s
//     total. The first ~0.2s undershoots the rest of the curve — traced to the user's own throttle
//     axis taking ~5 frames to reach 100% input, not an in-game spool delay (irrelevant here since
//     keyboard input is instant). Fitting the clean remainder against boostSpeedForward=520 gives
//     tau_boost ~= 1.0-1.2s => boostLinearDrag = 1/tau ~= 0.909 — notably *less* damped than plain
//     thrust (5.18), confirming boost trades agility for top speed rather than just adding thrust.
export const SHIP_TYPES: ShipType[] = [
  {
    name: 'Gladius',
    mass: 1.5,
    massKg: 48552,
    linearThrust: { main: 1756.02, retro: 1748.25, strafe: 120, vertical: 120 },
    angularThrust: { pitch: 12.2261, yaw: 14.0721, roll: 18.6963 },
    linearDrag: 5.18,
    boostLinearDrag: 0.909,
    coastDecel: 40,
    angularDrag: { pitch: 10.2740, yaw: 15.4639, roll: 5.3571 },
    maxAngVel: { pitch: 1.19, yaw: 0.91, roll: 3.49 },
    scmSpeed: 226,
    scmSpeedBack: 225,
    boostSpeedForward: 520,
    boostSpeedBack: 268,
    boostCapacity: 5,
    boostRechargeRate: 0.4,
    boostMaxAngVel: { pitch: 1.431, yaw: 1.082, roll: 4.189 },
    boostAngularThrust: { pitch: 14.7021, yaw: 16.7319, roll: 22.4409 },
    boostLinearThrust: { main: 709.02, retro: 365.42 },
    hullRadius: 10 // approx half-length of a real Gladius (~22m), used for hit detection/drawing
  }
];
