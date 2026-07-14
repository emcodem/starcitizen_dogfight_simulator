import type { AxisConcept, StickAxes } from '../types';
import { getAxisMap, getScDevices } from './deviceState';
import { findByVidPid, findDevice } from './gamepadModule';
import { registerConfig } from './configRegistry';

// =====================================================================
// JoystickAxes — resolves the parsed actionmaps.xml axis bindings (or a
// manually-captured binding) against whatever the browser currently sees,
// and returns live analog values.
//
// Known unknown: which array index in gamepad.axes corresponds to which
// physical axis (X, Y, twist/Z, etc.) is NOT guaranteed by any spec — it
// depends on the device's HID descriptor and OS driver. AXIS_INDEX below is
// a reasonable default guess (the common DirectInput ordering) used only for
// XML-imported bindings; manually-captured bindings (see bindingsTableUI)
// observe the exact index live and don't need this guess at all.
// =====================================================================

const DEADZONE = 0.08;
const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2, rotx: 3, roty: 4, rotz: 5, slider1: 6, slider2: 7 };
const invert: Record<AxisConcept, boolean> = {
  strafeLateral: false, strafeVertical: true, strafeLongitudinal: false,
  pitch: false, yaw: false, roll: false
};

function readAxisFor(concept: AxisConcept): number | null {
  const binding = getAxisMap()[concept];
  if (!binding) return null; // not bound to any joystick

  let pad: ReturnType<typeof findByVidPid>, idx: number | undefined;
  if (binding.manual) {
    // manually captured via live axis-wiggle detection — exact vid/pid/index,
    // no letter-to-index guessing involved (see completeAxisRebind). Resolve via the
    // device discriminator so two physically-identical sticks (same vid/pid) don't collide.
    pad = findDevice(binding);
    idx = binding.axisIndex;
  } else {
    // resolved from an imported actionmaps.xml: instance -> device -> best-effort
    // letter-to-index guess (AXIS_INDEX above). No per-device discriminator here (the XML
    // only carries a vid/pid via ScDevice), so identical devices can't be told apart on this path.
    const dev = getScDevices().find(d => d.instance === binding.instance);
    if (!dev || !dev.vid) return null;
    pad = findByVidPid(dev.vid, dev.pid);
    idx = AXIS_INDEX[binding.axis];
  }

  if (!pad) return null; // device known, but not currently seen by the browser
  if (idx === undefined || idx >= pad.axesValues.length) return null;
  let v = pad.axesValues[idx];
  if (Math.abs(v) < DEADZONE) v = 0;
  if (invert[concept]) v = -v;
  return v;
}

export function read(): StickAxes {
  return {
    lateral: readAxisFor('strafeLateral'),
    vertical: readAxisFor('strafeVertical'),
    longitudinal: readAxisFor('strafeLongitudinal'),
    pitch: readAxisFor('pitch'),
    yaw: readAxisFor('yaw'),
    roll: readAxisFor('roll')
  };
}

export function setInvert(concept: AxisConcept, val: boolean): void {
  invert[concept] = val;
}
export function getInvert(): Record<AxisConcept, boolean> {
  return invert;
}

// Was previously local-only state, silently lost on reload/preset-switch even though the UI made
// it look like a saved setting — join the same config-registry backbone keybinds/axisMap/etc. use.
registerConfig({
  key: 'axisInvert',
  serialize: () => invert,
  deserialize: data => {
    if (data) Object.assign(invert, data as Partial<Record<AxisConcept, boolean>>);
  }
});
