import type { ActionName } from '../types';
import { getButtonMap } from './deviceState';
import { findByVidPid } from './gamepadModule';

// =====================================================================
// JoystickButtons — two read modes for a bound joystick button: `justPressed`
// edge-detects it the same way keyboard presses are (chordJustPressed), for
// real toggle actions like decoupleToggle; `isPressed` is a plain hold check,
// for actions like spaceBrake that should only be active while held down.
// =====================================================================

const prevPressed: Partial<Record<ActionName, boolean>> = {}; // last frame's state (for justPressed only)

export function isPressed(action: ActionName): boolean {
  const binding = getButtonMap()[action];
  if (!binding) return false;
  const pad = findByVidPid(binding.vid, binding.pid);
  if (!pad || binding.buttonIndex >= pad.buttonsPressed.length) return false;
  return pad.buttonsPressed[binding.buttonIndex];
}

export function justPressed(action: ActionName): boolean {
  const pressed = isPressed(action);
  const wasPressed = !!prevPressed[action];
  prevPressed[action] = pressed;
  return pressed && !wasPressed;
}
