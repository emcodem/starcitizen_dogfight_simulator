import type { ActionName } from '../types';
import { getMouseButtonMap } from './deviceState';

// =====================================================================
// MouseButtons — same isPressed/justPressed shape as joystickButtons.ts, but
// resolved against native MouseEvent.button state instead of the Gamepad API
// (there's only ever one system mouse, so no vid/pid device lookup needed).
// =====================================================================

const pressed: Record<number, boolean> = {};
window.addEventListener('mousedown', e => { pressed[e.button] = true; });
window.addEventListener('mouseup', e => { pressed[e.button] = false; });

const prevPressed: Partial<Record<ActionName, boolean>> = {}; // last frame's state (for justPressed only)

export function isPressed(action: ActionName): boolean {
  const binding = getMouseButtonMap()[action];
  if (!binding) return false;
  return !!pressed[binding.button];
}

export function justPressed(action: ActionName): boolean {
  const isNowPressed = isPressed(action);
  const wasPressed = !!prevPressed[action];
  prevPressed[action] = isNowPressed;
  return isNowPressed && !wasPressed;
}
