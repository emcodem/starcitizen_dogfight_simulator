import type { Ship } from '../types';
import { keys } from '../input/controlsModule';
import { setFiring } from '../world/weapons';
import { toggleDecoupled } from '../ship/decoupledPersist';
import { clamp } from '../math/vec';
import * as TouchInput from '../input/touchInput';
import { isTouchPrimary } from './deviceDetect';

// ---------- Touch controls: dynamic dual thumbsticks + minimal buttons ----------
// The screen is split down the middle: a touch that lands anywhere in the LEFT half
// spawns the strafe stick under that thumb, the RIGHT half spawns the pitch/yaw stick.
// Each stick's center is wherever the thumb first touched down, so there's no fixed
// position to reach for (recomputed every touch, so device rotation just works — we
// read window.innerWidth live). Touches that land on an actual control (a button, the
// menu, a panel) are left alone so those keep working.
// The opt-in GYRO toggle adds device-tilt flight: bank -> roll, forward/back tilt -> pitch.
// All axis output goes through TouchInput (analog), which physics/step.ts sums additively
// alongside keyboard/mouse/joystick.
export function initTouchControls(ship: Ship): void {
  if (!isTouchPrimary()) return;

  document.body.classList.add('touch');

  initDynamicSticks();

  function bindHold(id: string, keyCode: string): void {
    const el = document.getElementById(id) as HTMLElement;
    el.addEventListener('touchstart', e => { keys[keyCode] = true; e.preventDefault(); });
    el.addEventListener('touchend', e => { keys[keyCode] = false; e.preventDefault(); });
    el.addEventListener('touchcancel', () => { keys[keyCode] = false; });
  }
  bindHold('tb-fwd', 'KeyW');
  bindHold('tb-back', 'KeyS');
  bindHold('tb-stop', 'KeyX'); // space brake is hold-to-brake, not a toggle — same as keyboard

  document.getElementById('tb-decouple')!.addEventListener('touchstart', e => {
    toggleDecoupled(ship);
    e.preventDefault();
  });

  const fireBtn = document.getElementById('tb-fire') as HTMLElement;
  fireBtn.addEventListener('touchstart', e => { setFiring(true); e.preventDefault(); });
  fireBtn.addEventListener('touchend', e => { setFiring(false); e.preventDefault(); });
  fireBtn.addEventListener('touchcancel', () => { setFiring(false); });

  initGyroRoll();
}

// A stick that materializes at a touch-down point. `.begin()` pins its center to the
// thumb and reveals the ring; `.move()` reports deflection relative to that center;
// `.end()` hides it and zeros the axis. Screen-space output (x right, y down), [-1,1],
// with a radial deadzone.
function makeFloatingStick(zoneId: string, onChange: (nx: number, ny: number) => void) {
  const zone = document.getElementById(zoneId) as HTMLElement;
  const knob = zone.querySelector('.joy-stick') as HTMLElement;
  const SIZE = 130;      // ring diameter (matches CSS) — used to center the ring on the thumb
  const RADIUS = 50;     // px of thumb travel from center for full deflection
  const BASE = 45;       // knob's centered offset within the ring ((130-40)/2)
  const DEADZONE = 0.15;

  let activeId: number | null = null;
  let origin = { x: 0, y: 0 };

  function apply(dx: number, dy: number): void {
    const dist = Math.min(RADIUS, Math.hypot(dx, dy));
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * dist, ky = Math.sin(angle) * dist;
    knob.style.left = (BASE + kx) + 'px';
    knob.style.top = (BASE + ky) + 'px';
    let nx = kx / RADIUS, ny = ky / RADIUS;
    const mag = Math.hypot(nx, ny);
    if (mag < DEADZONE) { nx = 0; ny = 0; }
    else {
      const scaled = (mag - DEADZONE) / (1 - DEADZONE);
      nx = (nx / mag) * scaled;
      ny = (ny / mag) * scaled;
    }
    onChange(nx, ny);
  }

  return {
    get activeId() { return activeId; },
    begin(id: number, x: number, y: number): void {
      activeId = id;
      origin = { x, y };
      zone.style.left = (x - SIZE / 2) + 'px';
      zone.style.top = (y - SIZE / 2) + 'px';
      zone.classList.add('active');
      apply(0, 0);
    },
    move(x: number, y: number): void {
      apply(x - origin.x, y - origin.y);
    },
    end(): void {
      activeId = null;
      zone.classList.remove('active');
      knob.style.left = BASE + 'px';
      knob.style.top = BASE + 'px';
      onChange(0, 0);
    }
  };
}

// True when a touch landed on something that should handle it itself rather than
// spawning a stick — any button, link, form control, or an open menu/modal/panel
// (those overlays cover the screen, so a touch on them means "interact with the UI").
function isUiTarget(el: EventTarget | null): boolean {
  const node = el as Element | null;
  return !!node && typeof node.closest === 'function' && !!node.closest(
    'button, a, input, select, label, #scenario-menu-overlay, #startup-modal-overlay, #ctrl-panel'
  );
}

function initDynamicSticks(): void {
  // left half -> x = lateral strafe (right +), screen-up = forward throttle (strafeForward +)
  const left = makeFloatingStick('joy-zone', (nx, ny) => TouchInput.setLeftStick(nx, -ny));
  // right half -> aim (screen-up = pitch up (keyboard pitchUp = -1), x = yaw right(+))
  const right = makeFloatingStick('joy-zone-right', (nx, ny) => TouchInput.setAim(ny, nx));

  window.addEventListener('touchstart', e => {
    let started = false;
    for (const t of Array.from(e.changedTouches)) {
      if (isUiTarget(t.target)) continue;
      const slot = t.clientX < window.innerWidth / 2 ? left : right;
      if (slot.activeId !== null) continue; // that half already owns a stick
      slot.begin(t.identifier, t.clientX, t.clientY);
      started = true;
    }
    if (started) e.preventDefault(); // suppress emulated mouse/scroll for a claimed touch only
  }, { passive: false });

  window.addEventListener('touchmove', e => {
    let moved = false;
    for (const t of Array.from(e.changedTouches)) {
      if (left.activeId === t.identifier) { left.move(t.clientX, t.clientY); moved = true; }
      else if (right.activeId === t.identifier) { right.move(t.clientX, t.clientY); moved = true; }
    }
    if (moved) e.preventDefault();
  }, { passive: false });

  function release(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (left.activeId === t.identifier) left.end();
      else if (right.activeId === t.identifier) right.end();
    }
  }
  window.addEventListener('touchend', release);
  window.addEventListener('touchcancel', release);

  // a rotate/resize mid-drag would leave a stick pinned to a now-wrong point — drop both
  window.addEventListener('resize', () => {
    if (left.activeId !== null) left.end();
    if (right.activeId !== null) right.end();
  });
}

// Device-gyro flight (opt-in): bank the phone left/right for roll, tilt it forward/back
// for pitch. Uses DeviceMotionEvent's gravity vector rather than DeviceOrientationEvent
// angles, and reads two independent quantities from it:
//   roll  = atan2(gx, gy)          -> the in-screen-plane "bank" angle (rotation about
//                                     the screen normal); unaffected by forward/back tilt.
//   pitch = atan2(gz, |g in-plane|)-> how far the screen is reclined from vertical
//                                     (rotation about a screen-plane axis); unaffected by bank.
// Both work the same in portrait or landscape, and calibration on enable absorbs whatever
// the resting hold angle is. Hidden entirely if the device can't report motion. iOS 13+
// needs an explicit permission request from a user gesture, so we do it on the button tap.
function initGyroRoll(): void {
  const btn = document.getElementById('tb-gyro') as HTMLButtonElement | null;
  if (!btn || typeof DeviceMotionEvent === 'undefined') return;
  btn.hidden = false;

  const MAX_ROLL_TILT = Math.PI / 4;  // 45° of bank = full roll deflection
  const MAX_PITCH_TILT = Math.PI / 4; // 45° of forward/back tilt = full pitch
  const PITCH_SIGN = -1;              // inverted: tilt nose-down pitches the ship up (flight-yoke feel)
  const DEADZONE = 0.1;               // normalized; ignore small tilts so a steady hold doesn't drift
  let on = false;
  let neutralRoll = 0, neutralPitch = 0;
  let calibrated = false;

  // normalize a tilt delta to [-1,1] with a small center deadzone
  function shape(diff: number, maxTilt: number): number {
    let v = clamp(diff / maxTilt, -1, 1);
    if (Math.abs(v) < DEADZONE) return 0;
    return (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
  }

  function onMotion(e: DeviceMotionEvent): void {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null || g.z == null) return;
    const bank = Math.atan2(g.x, g.y);                       // roll axis
    const recline = Math.atan2(g.z, Math.hypot(g.x, g.y));   // forward/back pitch axis
    if (!calibrated) {
      neutralRoll = bank; neutralPitch = recline; calibrated = true;
      TouchInput.setGyro(0, 0);
      return;
    }
    let dRoll = bank - neutralRoll;
    while (dRoll > Math.PI) dRoll -= 2 * Math.PI;
    while (dRoll < -Math.PI) dRoll += 2 * Math.PI;
    const dPitch = recline - neutralPitch; // recline stays within ±π/2, no wrap needed
    TouchInput.setGyro(shape(dRoll, MAX_ROLL_TILT), PITCH_SIGN * shape(dPitch, MAX_PITCH_TILT));
  }

  async function enable(): Promise<void> {
    const req = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<PermissionState> }).requestPermission;
    if (typeof req === 'function') {
      try {
        if ((await req()) !== 'granted') return;
      } catch {
        return; // permission dialog rejected/unavailable — leave gyro off
      }
    }
    on = true;
    calibrated = false; // first sample after enabling becomes the neutral reference
    window.addEventListener('devicemotion', onMotion);
    btn!.classList.add('on');
  }
  function disable(): void {
    on = false;
    window.removeEventListener('devicemotion', onMotion);
    TouchInput.setGyro(0, 0);
    btn!.classList.remove('on');
  }
  // click (not touchstart) so the tap counts as the user gesture iOS requires for requestPermission
  btn.addEventListener('click', () => { if (on) disable(); else void enable(); });
}
