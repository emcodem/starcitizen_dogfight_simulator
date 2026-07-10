import type { Ship } from '../types';
import { keys } from '../input/controlsModule';
import { setFiring } from '../world/weapons';
import { toggleDecoupled } from '../ship/decoupledPersist';
import { isTouchPrimary } from './deviceDetect';

// ---------- Touch controls (minimal, testing only) ----------
export function initTouchControls(ship: Ship): void {
  if (!isTouchPrimary()) return;

  document.body.classList.add('touch');

  const joyZone = document.getElementById('joy-zone') as HTMLElement;
  const joyStick = document.getElementById('joy-stick') as HTMLElement;
  let joyActive = false, joyId: number | null = null, joyCenter = { x: 0, y: 0 };
  const joyRadius = 65;

  function joyStart(e: TouchEvent): void {
    const t = e.changedTouches[0];
    joyId = t.identifier;
    const rect = joyZone.getBoundingClientRect();
    joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    joyActive = true;
    e.preventDefault();
  }
  function joyMove(e: TouchEvent): void {
    if (!joyActive) return;
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== joyId) continue;
      let dx = t.clientX - joyCenter.x;
      let dy = t.clientY - joyCenter.y;
      const dist = Math.min(joyRadius, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      dx = Math.cos(angle) * dist; dy = Math.sin(angle) * dist;
      joyStick.style.left = (45 + dx) + 'px';
      joyStick.style.top = (45 + dy) + 'px';
      const nx = dx / joyRadius, ny = dy / joyRadius; // -1..1
      // map joystick to pitch/yaw arrow keys (deadzone 0.15) — up = dive, down = climb
      keys['ArrowUp'] = ny < -0.15;
      keys['ArrowDown'] = ny > 0.15;
      keys['ArrowLeft'] = nx < -0.15;
      keys['ArrowRight'] = nx > 0.15;
      e.preventDefault();
    }
  }
  function joyEnd(e: TouchEvent): void {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier !== joyId) continue;
      joyActive = false;
      joyStick.style.left = '45px';
      joyStick.style.top = '45px';
      keys['ArrowUp'] = keys['ArrowDown'] = keys['ArrowLeft'] = keys['ArrowRight'] = false;
    }
  }
  joyZone.addEventListener('touchstart', joyStart);
  joyZone.addEventListener('touchmove', joyMove);
  joyZone.addEventListener('touchend', joyEnd);
  joyZone.addEventListener('touchcancel', joyEnd);

  function bindHold(id: string, keyCode: string): void {
    const el = document.getElementById(id) as HTMLElement;
    el.addEventListener('touchstart', e => { keys[keyCode] = true; e.preventDefault(); });
    el.addEventListener('touchend', e => { keys[keyCode] = false; e.preventDefault(); });
    el.addEventListener('touchcancel', () => { keys[keyCode] = false; });
  }
  bindHold('tb-fwd', 'KeyW');
  bindHold('tb-back', 'KeyS');
  bindHold('tb-up', 'Space');
  bindHold('tb-down', 'ControlLeft');
  bindHold('tb-roll-l', 'KeyE');
  bindHold('tb-roll-r', 'KeyQ');
  bindHold('tb-stop', 'KeyX'); // space brake is hold-to-brake, not a toggle — same as keyboard

  document.getElementById('tb-decouple')!.addEventListener('touchstart', e => {
    toggleDecoupled(ship);
    e.preventDefault();
  });

  const fireBtn = document.getElementById('tb-fire') as HTMLElement;
  fireBtn.addEventListener('touchstart', e => { setFiring(true); e.preventDefault(); });
  fireBtn.addEventListener('touchend', e => { setFiring(false); e.preventDefault(); });
  fireBtn.addEventListener('touchcancel', () => { setFiring(false); });
}
