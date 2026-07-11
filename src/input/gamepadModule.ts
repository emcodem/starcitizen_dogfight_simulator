import type { GamepadSnapshot } from '../types';

// =====================================================================
// GamepadModule — thin wrapper around the browser's Gamepad API, used to match
// physical sticks against an imported actionmaps.xml by USB vendor/product ID,
// and to resolve live axis/button values for flight control.
//
// Caveats worth knowing:
//  - Chrome/Edge only reveal a gamepad to the page after it receives
//    input from that device (a privacy protection) — a stick plugged in
//    but untouched won't appear in navigator.getGamepads() yet.
//  - The Gamepad API's `id` string is not standardized. On Chromium,
//    non-XInput devices (which flight sticks/pedals are) typically come
//    through as "<name> (Vendor: xxxx Product: yyyy)" with raw USB hex
//    IDs. Firefox instead prefixes the id with the hex IDs directly,
//    e.g. "231d-0201- VKBsim Gladiator EVO L" — both formats are parsed
//    below since they land in the same vid/pid fields downstream.
//  - navigator.getGamepads() must be polled; there's no reliable
//    per-frame change event, so we poll on an interval instead.
// =====================================================================

let snapshot: GamepadSnapshot[] = [];
const VID_PID_RE_CHROMIUM = /Vendor:\s*([0-9a-fA-F]{2,4}).*?Product:\s*([0-9a-fA-F]{2,4})/i;
const VID_PID_RE_FIREFOX = /^([0-9a-fA-F]{4})-([0-9a-fA-F]{4})-/;

export function parseVidPid(id: string): { vid: string | null; pid: string | null } {
  const m = id.match(VID_PID_RE_CHROMIUM) || id.match(VID_PID_RE_FIREFOX);
  return {
    vid: m ? m[1].padStart(4, '0').toUpperCase() : null,
    pid: m ? m[2].padStart(4, '0').toUpperCase() : null
  };
}

export function isSupported(): boolean {
  return !!navigator.getGamepads;
}

export function poll(): void {
  if (!isSupported()) { snapshot = []; return; }
  const pads = navigator.getGamepads();
  snapshot = Array.from(pads)
    .filter((p): p is Gamepad => !!p)
    .map(p => ({
      index: p.index,
      id: p.id,
      axesValues: Array.from(p.axes),
      buttonsPressed: Array.from(p.buttons).map(b => b.pressed || b.value > 0.5),
      ...parseVidPid(p.id)
    }));
}

export function getSnapshot(): GamepadSnapshot[] {
  return snapshot;
}

// A stored reference to one physical device. vid/pid alone are NOT unique when two
// same-model devices are connected (e.g. two vJoy virtual sticks, both VID 1234 PID BEAD),
// so a binding also records a capability "fingerprint" — the device's axis and button counts.
//
// This is the same identity signal Joystick Gremlin uses: give each vJoy a different number
// of axes/buttons in the vJoy config, and (vid, pid, axisCount, buttonCount) uniquely names it.
// It's the only reasonably-stable per-device signal the browser Gamepad API exposes — there is
// no GUID or serial number — and unlike the connection index it survives a reload/replug.
//
// Limitation: two devices configured with the SAME axis/button count are indistinguishable here.
// To bind two vJoy devices to different controls, configure them with different axis/button counts.
export interface DeviceRef {
  vid: string | null;
  pid: string | null;
  axisCount?: number;
  buttonCount?: number;
}

// True when `pad` matches `ref`'s identity — same vid/pid and same capability fingerprint. The
// count checks are skipped when the ref didn't record them (a preset saved before fingerprinting
// existed), so old bindings still resolve by vid/pid alone.
function inDeviceGroup(pad: GamepadSnapshot, ref: DeviceRef): boolean {
  if (pad.vid !== ref.vid || pad.pid !== ref.pid) return false;
  if (ref.axisCount !== undefined && pad.axesValues.length !== ref.axisCount) return false;
  if (ref.buttonCount !== undefined && pad.buttonsPressed.length !== ref.buttonCount) return false;
  return true;
}

// Resolve a stored device reference to a live gamepad snapshot by its capability fingerprint.
// Returns null if no matching device is currently seen. If two connected devices share the same
// fingerprint (identically-configured — see DeviceRef) they can't be told apart; the first is
// returned as a best effort.
export function findDevice(ref: DeviceRef): GamepadSnapshot | null {
  return snapshot.find(p => inDeviceGroup(p, ref)) || null;
}

// Back-compat convenience for callers that only have a vid/pid and don't need to distinguish
// same-model devices (there's only ever one system mouse, one XML-imported device per instance).
export function findByVidPid(vid: string | null, pid: string | null): GamepadSnapshot | null {
  return findDevice({ vid, pid });
}
