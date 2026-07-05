// =====================================================================
// MouseLook — standalone module wrapping the Pointer Lock API.
// Models Star Citizen's default ABSOLUTE mouse-flight mode: the mouse
// acts like a virtual joystick that stays deflected once moved, driving
// a continuous pitch/yaw rate until you move it back toward center —
// it does NOT reset every frame like FPS-style relative look.
// Release (Escape / alt-tab) is handled by the browser's own pointer
// lock lifecycle; we just react to it via 'pointerlockchange'.
// =====================================================================

import { registerConfig } from './configRegistry';

export interface MouseLookInput {
  pitch: number;
  yaw: number;
}

let captured = false;
let offsetX = 0, offsetY = 0; // persistent virtual-stick deflection, in pixels
const MAX_OFFSET = 220; // pixels of mouse travel for full deflection
let sensitivity = 1.5; // multiplier applied on top of the offset ratio
let invertY = true;
let deadzone = 0.05; // fraction of MAX_OFFSET ignored near center, to absorb sensor/hand jitter
const listeners: Array<(captured: boolean) => void> = [];

const canvas = document.getElementById('c') as HTMLCanvasElement;

function notify(): void {
  listeners.forEach(fn => fn(captured));
}

document.addEventListener('pointerlockchange', () => {
  captured = document.pointerLockElement === canvas;
  offsetX = 0; offsetY = 0; // recenter whenever capture state changes
  notify();
});
document.addEventListener('pointerlockerror', () => {
  captured = false;
  notify();
});
document.addEventListener('mousemove', e => {
  if (!captured) return;
  offsetX = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offsetX + (e.movementX || 0)));
  offsetY = Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, offsetY + (e.movementY || 0)));
});
// belt-and-suspenders: explicitly release on losing focus, in case a
// browser doesn't auto-exit pointer lock on alt-tab
window.addEventListener('blur', () => {
  try { if (document.pointerLockElement) document.exitPointerLock(); }
  catch { /* ignore */ }
});

export function requestCapture(): void {
  try { canvas.requestPointerLock(); }
  catch (err) { console.warn('Pointer lock unavailable in this context:', err); }
}
export function releaseCapture(): void {
  try { if (document.pointerLockElement) document.exitPointerLock(); }
  catch { /* ignore */ }
}
export function recenter(): void {
  offsetX = 0; offsetY = 0;
}

export function consume(): MouseLookInput {
  // reads the CURRENT stick deflection — does not reset it, since the
  // deflection should keep driving rotation until manually recentered
  let xRatio = offsetX / MAX_OFFSET;
  let yRatio = offsetY / MAX_OFFSET;
  if (Math.abs(xRatio) < deadzone) xRatio = 0;
  if (Math.abs(yRatio) < deadzone) yRatio = 0;
  const yaw = Math.max(-1, Math.min(1, xRatio * sensitivity));
  let pitch = Math.max(-1, Math.min(1, yRatio * sensitivity));
  if (invertY) pitch = -pitch;
  return { pitch, yaw };
}

export function isCaptured(): boolean {
  return captured;
}
export function getOffset(): { x: number; y: number; max: number } {
  return { x: offsetX, y: offsetY, max: MAX_OFFSET };
}
export function onChange(fn: (captured: boolean) => void): void {
  listeners.push(fn);
}
export function getSensitivity(): number {
  return sensitivity;
}
export function setSensitivity(v: number): void {
  sensitivity = v;
}
export function getInvertY(): boolean {
  return invertY;
}
export function setInvertY(v: boolean): void {
  invertY = v;
}
export function getDeadzone(): number {
  return deadzone;
}
export function setDeadzone(v: number): void {
  deadzone = v;
}

interface MouseLookConfig {
  sensitivity: number;
  invertY: boolean;
  deadzone: number;
}
registerConfig({
  key: 'mouseLook',
  serialize: (): MouseLookConfig => ({ sensitivity, invertY, deadzone }),
  deserialize: data => {
    const d = data as Partial<MouseLookConfig> | null | undefined;
    if (!d) return;
    if (typeof d.sensitivity === 'number') sensitivity = d.sensitivity;
    if (typeof d.invertY === 'boolean') invertY = d.invertY;
    if (typeof d.deadzone === 'number') deadzone = d.deadzone;
  }
});
