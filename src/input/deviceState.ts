import type { ActionName, AxisBinding, AxisConcept, ButtonBinding, ScDevice } from '../types';

// Shared mutable joystick state: which physical devices the last-imported actionmaps.xml
// referenced, and which axis/button is bound to which sim concept/action. Owned here (not by
// the modules that read it) so every reassignment goes through one place — importers call
// these functions rather than assigning the underlying bindings directly.

let scDevices: ScDevice[] = []; // devices parsed from the user's actionmaps.xml
let axisMap: Partial<Record<AxisConcept, AxisBinding>> = {};
let buttonMap: Partial<Record<ActionName, ButtonBinding>> = {};

export function getScDevices(): ScDevice[] {
  return scDevices;
}
export function setScDevices(devices: ScDevice[]): void {
  scDevices = devices;
}

export function getAxisMap(): Partial<Record<AxisConcept, AxisBinding>> {
  return axisMap;
}
export function setAxisMap(map: Partial<Record<AxisConcept, AxisBinding>>): void {
  axisMap = map;
}
export function bindAxis(concept: AxisConcept, binding: AxisBinding): void {
  axisMap[concept] = binding;
}
export function unbindAxis(concept: AxisConcept): void {
  delete axisMap[concept];
}

export function getButtonMap(): Partial<Record<ActionName, ButtonBinding>> {
  return buttonMap;
}
export function bindButton(action: ActionName, binding: ButtonBinding): void {
  buttonMap[action] = binding;
}
export function unbindButton(action: ActionName): void {
  delete buttonMap[action];
}
