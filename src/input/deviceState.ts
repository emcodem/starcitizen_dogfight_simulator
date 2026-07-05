import type { ActionName, AxisBinding, AxisConcept, ButtonBinding, MouseButtonBinding, MouseButtonMap, ScDevice } from '../types';
import { registerConfig } from './configRegistry';

// Shared mutable joystick state: which physical devices the last-imported actionmaps.xml
// referenced, and which axis/button is bound to which sim concept/action. Owned here (not by
// the modules that read it) so every reassignment goes through one place — importers call
// these functions rather than assigning the underlying bindings directly.

let scDevices: ScDevice[] = []; // devices parsed from the user's actionmaps.xml
let axisMap: Partial<Record<AxisConcept, AxisBinding>> = {};
let buttonMap: Partial<Record<ActionName, ButtonBinding>> = {};

// Unlike axisMap/buttonMap (device-specific, so there's no sane universal default), a mouse
// binding is universal like a keyboard default — so primaryFire ships bound to left-click.
const DEFAULT_MOUSE_BUTTON_MAP: MouseButtonMap = { primaryFire: { button: 0, label: 'Left Click' } };
let mouseButtonMap: MouseButtonMap = { ...DEFAULT_MOUSE_BUTTON_MAP };

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
export function setButtonMap(map: Partial<Record<ActionName, ButtonBinding>>): void {
  buttonMap = map;
}
export function bindButton(action: ActionName, binding: ButtonBinding): void {
  buttonMap[action] = binding;
}
export function unbindButton(action: ActionName): void {
  delete buttonMap[action];
}

export function getMouseButtonMap(): MouseButtonMap {
  return mouseButtonMap;
}
export function setMouseButtonMap(map: MouseButtonMap): void {
  mouseButtonMap = map;
}
export function bindMouseButton(action: ActionName, binding: MouseButtonBinding): void {
  mouseButtonMap[action] = binding;
}
export function unbindMouseButton(action: ActionName): void {
  delete mouseButtonMap[action];
}

registerConfig({
  key: 'axisMap',
  serialize: () => axisMap,
  deserialize: data => { axisMap = (data as typeof axisMap) || {}; }
});
registerConfig({
  key: 'buttonMap',
  serialize: () => buttonMap,
  deserialize: data => { buttonMap = (data as typeof buttonMap) || {}; }
});
// A preset saved before this feature existed has no 'mouseButtonMap' key at all, so `data`
// comes through as undefined here — fall back to the default rather than leaving fire unbound.
registerConfig({
  key: 'mouseButtonMap',
  serialize: () => mouseButtonMap,
  deserialize: data => { mouseButtonMap = (data as MouseButtonMap) || { ...DEFAULT_MOUSE_BUTTON_MAP }; }
});
// scDevices looks like session-detected metadata, but it's load-bearing: an
// XML-derived axis binding only stores an actionmaps.xml `instance` number,
// and joystickAxes.ts resolves that to a vid/pid via this list. Without it
// surviving a reload, every non-manually-captured axis binding silently goes
// dead (getScDevices().find(...) fails, readAxisFor returns null) even
// though the binding itself is still shown as "bound" in the panel.
registerConfig({
  key: 'scDevices',
  serialize: () => scDevices,
  deserialize: data => { scDevices = (data as typeof scDevices) || []; }
});
