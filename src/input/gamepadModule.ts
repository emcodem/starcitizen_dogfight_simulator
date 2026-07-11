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
  debugTick();
}

export function getSnapshot(): GamepadSnapshot[] {
  return snapshot;
}

// ---------------------------------------------------------------------------
// Debug logging for device-detection troubleshooting.
//
// Enabled by default so a user whose stick won't show up can just open the
// console. It answers the two questions that matter when a device seems to
// "not be detected" or a press "does nothing":
//   1. What does Chrome ACTUALLY enumerate? (full raw dump incl. empty slots)
//   2. When I press/move a physical control, WHICH browser pad reacts?
// (2) is how you catch a vJoy/Joystick-Gremlin mixup: if pressing a VKB button
// lights up activity on a vJoy pad — or on nothing — the input is being routed
// away from the raw VKB the browser sees. Toggle at runtime: window.__gpDebug(false).
// ---------------------------------------------------------------------------
let DEBUG = true;
export function setDebug(on: boolean): void {
  DEBUG = on;
  console.log(`[gamepad] debug logging ${on ? 'ON' : 'OFF'}`);
}
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__gpDebug = setDebug;

// Known devices worth calling out by name in the dump, so a vJoy hiding among real sticks is obvious.
function annotate(vid: string | null, pid: string | null, id: string): string {
  if ((vid === '1234' && pid === 'BEAD') || /vjoy/i.test(id)) return '  ⚠ vJoy (virtual)';
  if (vid === '231D') return '  ← VKB';
  return '';
}

let lastRawSig = '';
// Per-pad memory of the last-seen input, so we log only edges/movements, not every frame.
const lastButtons: Record<number, boolean[]> = {};
const lastAxes: Record<number, number[]> = {};

function dumpRaw(reason: string): void {
  const raw = isSupported() ? Array.from(navigator.getGamepads()) : [];
  const active = raw.filter(Boolean).length;
  console.groupCollapsed(`[gamepad] ${reason}: ${raw.length} slots, ${active} active` +
    ` | secure=${!!window.isSecureContext} focused=${document.hasFocus()}`);
  raw.forEach((p, slot) => {
    if (!p) { console.log(`  slot ${slot}: (empty)`); return; }
    const { vid, pid } = parseVidPid(p.id);
    console.log(
      `  slot ${slot}: index=${p.index} axes=${p.axes.length} buttons=${p.buttons.length}` +
      ` mapping="${p.mapping}" vid=${vid} pid=${pid}${annotate(vid, pid, p.id)}\n      id="${p.id}"`
    );
  });
  console.groupEnd();
}

// Called from poll(). Cheap when nothing changes (string compare); logs a full dump when the set of
// devices changes, and a one-liner for every button edge / significant axis move on any pad.
function debugTick(): void {
  if (!DEBUG || !isSupported()) return;
  const raw = Array.from(navigator.getGamepads());

  // (1) enumeration changes — devices appearing/disappearing or changing shape
  const sig = raw.map((p, slot) => p ? `${slot}:${p.id}:${p.axes.length}:${p.buttons.length}` : `${slot}:-`).join('|');
  if (sig !== lastRawSig) {
    lastRawSig = sig;
    dumpRaw('enumeration changed');
  }

  // (2) live input activity per pad — the key signal for "which device is this press coming from"
  for (const p of raw) {
    if (!p) continue;
    const prevB = lastButtons[p.index] ?? [];
    p.buttons.forEach((b, i) => {
      const down = b.pressed || b.value > 0.5;
      if (down !== (prevB[i] ?? false)) {
        console.log(`[gamepad] pad index=${p.index} (${p.id}) button ${i} ${down ? 'DOWN' : 'up'}`);
      }
    });
    lastButtons[p.index] = p.buttons.map(b => b.pressed || b.value > 0.5);

    const prevA = lastAxes[p.index] ?? [];
    p.axes.forEach((v, i) => {
      if (Math.abs(v - (prevA[i] ?? 0)) > 0.25) {
        console.log(`[gamepad] pad index=${p.index} (${p.id}) axis ${i} = ${v.toFixed(2)}`);
      }
    });
    lastAxes[p.index] = Array.from(p.axes);
  }
}

// One-shot full dump on demand (e.g. from the console: window.__gpDump()).
export function logDeviceDump(): void { dumpRaw('manual dump'); }
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__gpDump = logDeviceDump;

// Low-level picture of why a device may or may not be visible — surfaced in the detection panel so
// "connected but no input yet" is distinguishable from "not enumerated at all". Chrome is far
// stricter than Firefox here: it only exposes gamepads on a secure origin (HTTPS or localhost) and
// only delivers state to the focused document after a real button/axis press. rawSlotCount counts
// the whole navigator.getGamepads() array *including empty slots* — Chrome commonly returns e.g. 4
// null slots for a connected-but-not-yet-engaged stick, which poll() filters away.
export interface GamepadDiagnostics {
  supported: boolean;
  secureContext: boolean;
  focused: boolean;
  rawSlotCount: number;
  activeCount: number;
}
export function getDiagnostics(): GamepadDiagnostics {
  const supported = isSupported();
  const raw = supported ? Array.from(navigator.getGamepads()) : [];
  return {
    supported,
    secureContext: !!window.isSecureContext,
    focused: document.hasFocus(),
    rawSlotCount: raw.length,
    activeCount: raw.filter(Boolean).length
  };
}

// The app is otherwise poll-only (there's no reliable per-frame change event). Registering the
// connect/disconnect events additionally nudges Chrome into surfacing non-XInput HID sticks — with
// pure polling it can stay blind until a connect event is observed — and lets the panel refresh the
// instant a stick appears/vanishes instead of waiting for the next interval tick. onChange runs
// after a fresh poll so callers see the updated snapshot.
export function initConnectionListeners(onChange?: () => void): void {
  const handler = (): void => { poll(); onChange?.(); };
  window.addEventListener('gamepadconnected', handler);
  window.addEventListener('gamepaddisconnected', handler);
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
