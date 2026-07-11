import type { Ship } from '../types';
import { keys } from '../input/controlsModule';
import { setFiring } from '../world/weapons';
import { toggleDecoupled } from '../ship/decoupledPersist';
import { clamp } from '../math/vec';
import * as TouchInput from '../input/touchInput';
import { isTouchPrimary } from './deviceDetect';

// ---------- Touch controls: twin analog sticks + minimal buttons ----------
// Left stick  -> lateral/vertical strafe (translation)
// Right stick -> pitch / yaw (aim)
// Roll        -> device gyro, opt-in via the ROLL: GYRO toggle
// FWD/BACK/STOP/FIRE stay as hold buttons; DE-CPL is a press toggle.
// All axis output goes through TouchInput (analog), which physics/step.ts sums
// additively alongside keyboard/mouse/joystick — see input/touchInput.ts.
export function initTouchControls(ship: Ship): void {
  if (!isTouchPrimary()) return;

  document.body.classList.add('touch');

  // Left stick: x = strafe right(+)/left(-), y (screen-up) = strafe up(+)/down(-).
  makeAnalogStick('joy-zone', (nx, ny) => TouchInput.setStrafe(nx, -ny));
  // Right stick: screen-up y = pitch up (matches keyboard pitchUp = -1), x = yaw right(+).
  makeAnalogStick('joy-zone-right', (nx, ny) => TouchInput.setAim(ny, nx));

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

// An on-screen analog stick living inside a `.joy-zone` element that holds a `.joy-stick` knob.
// Reports its deflection as (nx, ny) in [-1,1], screen-space (x right, y down), with a radial
// deadzone. Each stick tracks its own touch identifier so both sticks work simultaneously
// (touchmove/touchend for a touch fire on the element the touch STARTED on, so per-zone
// listeners never cross-talk).
function makeAnalogStick(zoneId: string, onChange: (nx: number, ny: number) => void): void {
  const zone = document.getElementById(zoneId) as HTMLElement;
  const knob = zone.querySelector('.joy-stick') as HTMLElement;
  const RADIUS = 45;     // px the knob can travel from center (keeps the 40px knob inside the 130px zone)
  const BASE = 45;       // knob's centered left/top offset within the zone
  const DEADZONE = 0.15; // ignore tiny jitter near center, then rescale so travel still spans full range
  let activeId: number | null = null;
  let center = { x: 0, y: 0 };

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
  function reset(): void {
    knob.style.left = BASE + 'px';
    knob.style.top = BASE + 'px';
    onChange(0, 0);
  }

  zone.addEventListener('touchstart', e => {
    if (activeId !== null) return; // already tracking a touch on this stick
    const t = e.changedTouches[0];
    activeId = t.identifier;
    const rect = zone.getBoundingClientRect();
    center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    apply(t.clientX - center.x, t.clientY - center.y);
    e.preventDefault();
  });
  zone.addEventListener('touchmove', e => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== activeId) continue;
      apply(t.clientX - center.x, t.clientY - center.y);
      e.preventDefault();
    }
  });
  function end(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== activeId) continue;
      activeId = null;
      reset();
    }
  }
  zone.addEventListener('touchend', end);
  zone.addEventListener('touchcancel', end);
}

// Device-gyro roll (opt-in). Uses DeviceMotionEvent's gravity vector rather than
// DeviceOrientationEvent angles: the direction of gravity within the screen plane
// (atan2(gx, gy)) tracks a "steering-wheel" rotation of the phone regardless of whether
// it's held portrait or landscape, and calibration absorbs whatever the base tilt is.
// Hidden entirely if the device can't report motion. iOS 13+ needs an explicit
// permission request from a user gesture, so we do it on the button tap.
function initGyroRoll(): void {
  const btn = document.getElementById('tb-gyro') as HTMLButtonElement | null;
  if (!btn || typeof DeviceMotionEvent === 'undefined') return;
  btn.hidden = false;

  const MAX_TILT = Math.PI / 4; // 45° of steering-wheel rotation = full roll deflection
  let on = false;
  let neutral = 0;
  let calibrated = false;

  function onMotion(e: DeviceMotionEvent): void {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    const angle = Math.atan2(g.x, g.y);
    if (!calibrated) { neutral = angle; calibrated = true; TouchInput.setRoll(0); return; }
    let diff = angle - neutral;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    TouchInput.setRoll(clamp(diff / MAX_TILT, -1, 1));
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
    TouchInput.setRoll(0);
    btn!.classList.remove('on');
  }
  // click (not touchstart) so the tap counts as the user gesture iOS requires for requestPermission
  btn.addEventListener('click', () => { if (on) disable(); else void enable(); });
}
