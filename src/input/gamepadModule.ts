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

export function findByVidPid(vid: string | null, pid: string | null): GamepadSnapshot | null {
  return snapshot.find(p => p.vid === vid && p.pid === pid) || null;
}
