import type { ShipType } from '../types';

// Gladius — derived from real SCM data: 226 m/s SCM speed, 68/52/200 deg/s pitch/yaw/roll,
// 520/268 m/s forward/back boost speed, 82/62/240 deg/s boosted pitch/yaw/roll, 48,552 kg real
// mass, later refined against frame-counted real-game acceleration traces for main/retro/strafe/
// vertical thrust and scmSpeedBack (see below). The boost meter's capacity/recharge rate (no real
// data available for those) is still estimated.
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
//   - Forward thrust (not boosted), SUPERSEDES an earlier, wrong reading of coarser data (see git
//     history if curious) — this is the full dense trace, every 40ms from a dead stop with no boost:
//     0, 1, 3, 8, 12, 17, 21, 26, 35, 39, 44, 48, 53, 62, 66, 71, 75, 79, 88, 93, 97, 102, 106, 115,
//     120, 124, 129, 133, 142, 147, 151, 156, 160, 169, 173, 178, 182, 187, 196, 200, 205, 209, 214,
//     223, 226 — hits scmSpeed (226) at 1.76s. Earlier passes at this (using only a single "180 m/s
//     at 1.40s" checkpoint, no earlier data) wrongly inferred a ~1.09s dead zone before thrust
//     engages; this full trace shows there's no such thing — it's climbing steadily from the very
//     first frame. Per-40ms-segment average acceleration: ~110 m/s^2 for the first ~0.3s (rising
//     from a slower first couple of frames — a short real spool, or possibly still some human-input
//     ramp, indistinguishable without device-level data), then a strikingly *constant* ~133 m/s^2
//     for the entire rest of the climb (segment averages 132.5, 135, 135, 131 m/s^2 across
//     0.4s-wide windows) all the way from 44 m/s to 214 m/s, before an abrupt stop exactly at
//     scmSpeed. A constant rate across nearly the whole speed range rules out proportional
//     (velocity-scaled) drag as the dominant force here — drag would show a *shrinking* rate as
//     speed climbs, not a flat one — so this isn't "thrust settling against drag" the way the
//     angular axes and coastDecel are; it's closer to "thrust applies almost unopposed, and the
//     existing flight-computer speed limiter below (the `speed > speedCap` block) is what stops it
//     right at scmSpeed", i.e. a governor/cap, not a natural equilibrium. Grid-search fitting
//     dv/dt = thrust/mass - drag*v (plus a short startup delay, plus the same hard governor clamp
//     used by the speed limiter) against all 45 points landed on thrust ~= 201, drag ~= 0 (fit
//     was insensitive to any value below ~0.005 — genuinely negligible, not just small), and
//     mainSpoolDelay ~= 0.07s — reproduces the whole trace to within ~3 m/s. linearDrag is kept
//     at a small nonzero placeholder (not exactly 0) only to avoid a literal zero constant; it does
//     essentially nothing across the whole flight envelope. The same "does the rate stay constant
//     instead of decaying" check applied to the boosted curve below suggests boost may have the
//     same governor-not-drag character (and a bigger startup delay than its ~0.2s pedal-ramp) —
//     not yet modeled or re-verified with a dense trace, flagged for whoever picks this up next.
//   - Reverse thrust: same governor-not-drag character as forward, confirmed with its own full
//     dense trace (40ms steps, dead stop, holding fly-back, no boost) — 0, 2, 4, 4, 6, 7, 10, 11,
//     13, 14, 16, 19, 19, 21, 22, 24, 26, 28, 29, 31, 33, 35, 37, 38, 40, 40, 43, 45, 46, 48, 49,
//     52, 53, 55, 55, 57, 60, 62, 63, 64, 66, 69, 69, 71, 72, 74, 77, 78, 79, 81, 82, 85, 86, 88,
//     89, 90, 93, 95, 96, 98, 98, 101, 103, 104, 106, 107, 110, 111, 112, 114, 115, 119, 119, 121,
//     122, 124, 127, 128, 129, 131, 132, 134, 136, 137, 139, 140, 143, 145, 146, 146, 148, 151,
//     153, 154, 157, 160, [131 — one clear transcription outlier, sandwiched between 160 and 163,
//     excluded from the fit], 163, 163, 165, 168, 169, 170, 172, 174, 177, 178, 179, 181, 182, 184,
//     186, 187, 189, 190, 193, 194, 196, 197, 199, 201, 203, 204, 205, 207, 210, 211, 213, 213, 215,
//     218, 219, 221, 221, 222, 223, 223, 224, 224, 225 — reaches scmSpeedBack (225, not the 100 m/s
//     previously assumed — see below) at 5.56s, much slower than forward's 1.76s despite an almost
//     identical top speed. Same fitting approach: thrust ~= 63, drag ~= 0 again, retroSpoolDelay ~=
//     0.024s (shorter than main's 0.07s — different thruster, timed separately) — within ~2.3 m/s
//     of every point except the excluded outlier.
//   - Strafe left/right: also given its own dense trace (40ms steps, dead stop, no boost) —
//     supersedes the earlier assumption that it'd match main thrust exactly — 0, 5, 8, 12, 14, 17,
//     24, 27, 31, 33, 36, 43, 47, 50, 52, 56, 64, 67, 69, 73, 76, 81, 85, 88, 92, 95, 101, 104, 108,
//     112, 113, 121, 125, 127, 131, 134, 140, 143, 147, 151, 152, 160, 163, 165, 169, 172, 178, 182,
//     186, 190, 194, 199, 203, 206, 208, 211, 216, 217, 219, 220, 221, 223, 223, 224 — still
//     climbing (not yet capped) at 224 m/s by the last sample (2.52s). Same governor-not-drag
//     character (negligible drag fits just as well as any nonzero value tried). Fit: thrust ~= 145,
//     spool negligible (~0, unlike main/retro's small-but-real delays) — within ~2.5 m/s of every
//     point except the last ~6 frames, where the sim (using the overall scmSpeed cap, same governor
//     used for every direction) reaches 226 slightly before the real trace's slower approach to 224
//     would suggest (up to ~6 m/s off there).
//   - Vertical strafe (up): dense trace (40ms steps, dead stop, no boost) — 0, 2, 5, 5, 11, 11, 17,
//     24, 27, 30, 30, 37, 43, 43, 50, 50, 56, 63, 63, 69, 69, 76, 82, 82, 89, 89, 95, 102, 102, 108,
//     108, 115, 121, 121, 128, 128, 134, 141, 141, 147, 147, 154, 160, 160, 167, 167, 173, 180, 180,
//     186, [183 — one clear glitch, dips below the prior 186, excluded from the fit], 193, 199, 199,
//     206, 213, 219, 219, 225 — reaches close to scmSpeed by 2.32s. Same governor-not-drag
//     character. Unlike lateral strafe, this one *does* show a real startup lag similar in size to
//     main's: fit landed on thrust ~= 147, verticalSpoolDelay ~= 0.066s (forcing spool to 0 nearly
//     triples the fit error) — within ~5.5 m/s of every point except the excluded glitch. Down was
//     not traced in the same detail, but confirmed by spot-check to run at exactly half of up's
//     speed at matching times => verticalDown = verticalUp / 2. Both directions share one
//     verticalSpoolDelay (no data distinguishing them, unlike main vs. retro).
//   - scmSpeedBack: separately confirmed by just holding the fly-back key from a dead stop and
//     reading the top speed reached, 225 m/s — not the 100 m/s previously assumed (that spec was
//     for a different/stale patch, or conflated with a different stat) — raised to nearly match
//     forward's scmSpeed.
//   - Coasting deceleration: releasing forward thrust at cruise speed loses ~8 m/s every 5 frames
//     (25fps) = a flat 40 m/s^2 the whole way to a stop, not a decaying rate => coastDecel = 40
//   - Space brake (forward): dense trace holding brake ONLY, no other input, from 225 m/s to a dead
//     stop (40ms steps, 25fps) — 225, 222, 220, 217, 214, 212, 209, 206, 204, 201, 198, 196, ...
//     down through the 100s and 10s to a very long tail of 1 m/s frames before finally 0, ~8.3s
//     total (a few obvious transcription spikes cleaned out). Per-speed-bin average decel is a
//     strikingly *flat* ~40 m/s^2 from 226 all the way down to ~40 m/s, then it tapers off hard:
//     ~2.4s to bleed the last 10 m/s to zero. That flat-then-creep shape is NOT a constant decel
//     (the old brake model — it stopped ~3x too fast near zero) and NOT plain proportional drag
//     (which would taper across the *whole* range, never showing the flat top). It's a velocity
//     controller targeting zero: decel = min(brakeGain*speed, thruster capacity). Grid-search fit
//     over the whole trace: brakeGain ~= 1.04/s, saturation ~= 40 m/s^2, crossover ~38.5 m/s —
//     reproduces every point to within ~1 m/s mean (0.62). Note the ~40 m/s^2 saturation sits just
//     under the retro thruster's own ~42 m/s^2 (retro=63, itself confirmed by the reverse-accel
//     trace above at 63.6/0.94-err — so retro is NOT wrong); the brake simply doesn't command the
//     full retro rating. We keep the saturation tied to the (direction-dependent) thruster capacity
//     in flightModel.ts rather than hard-coding 40, so forward braking caps at 42 (~5% above the
//     measured 40 over the >40 m/s stretch) while the tail — the part that was actually wrong — is
//     reproduced exactly. See flightModel.ts's brake block.
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
    linearThrust: { main: 201, retro: 63, strafe: 145, verticalUp: 147, verticalDown: 73.5 },
    angularThrust: { pitch: 12.2261, yaw: 14.0721, roll: 18.6963 },
    mainSpoolDelay: 0.07,
    retroSpoolDelay: 0.024,
    verticalSpoolDelay: 0.066,
    linearDrag: 0.001,
    boostLinearDrag: 0.909,
    coastDecel: 40,
    brakeGain: 1.04,
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
