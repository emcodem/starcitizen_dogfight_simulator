import type { ActionName, AxisConcept, KeyBindings, KeyChord, ScDevice, XmlAxisBinding } from '../types';

// =====================================================================
// ControlsModule — standalone unit for keybind management.
//
// Responsibilities:
//   1. Hold the current key bindings (KEYBINDS) and answer "is this
//      sim action currently active?" for the physics step to consult.
//   2. Parse a Star Citizen actionmaps.xml export and translate any
//      keyboard (kb1_) rebinds it finds into sim bindings.
//   3. Save/load named keybind presets (via the artifact storage API
//      when available, otherwise via file export/import).
//
// Caveat on XML import: Star Citizen only writes REBOUND actions into
// actionmaps.xml, not defaults — so a file where the player never
// touched keyboard flight controls may have nothing to import for some
// actions. The action-name-to-sim-control table below is also a
// best-effort mapping based on commonly known SC action identifiers;
// it isn't guaranteed to match every game version. Anything not found
// is reported plainly rather than silently guessed at.
// =====================================================================

declare global {
  interface Window {
    // Present only when running as a Claude artifact; used for preset persistence there.
    storage?: {
      get(key: string, opts: boolean): Promise<{ value: string } | null>;
      set(key: string, value: string, opts: boolean): Promise<void>;
      delete(key: string, opts: boolean): Promise<void>;
      list(prefix: string, opts: boolean): Promise<{ keys: string[] } | null>;
    };
  }
}

export interface ParsedActionMaps {
  actionsRaw: Record<string, string[]>;
}

export type AxisRaw = Record<string, { instance: string; axis: string }[]>;

export interface MatchedOverride {
  simAction: ActionName;
  scName: string;
  chords: KeyChord[];
}
export interface NotFoundOverride {
  simAction: ActionName;
  candidates: string[];
}
export interface BuiltOverrides {
  overrides: Partial<Record<ActionName, KeyChord[]>>;
  matched: MatchedOverride[];
  notFound: NotFoundOverride[];
}

const keys: Record<string, boolean> = {}; // live key-state map, exclusively owned by this module

function defaultBindings(): KeyBindings {
  return {
    pitchUp:        [['ArrowUp']],
    pitchDown:      [['ArrowDown']],
    yawLeft:        [['ArrowLeft']],
    yawRight:       [['ArrowRight']],
    rollLeft:       [['KeyQ']],
    rollRight:      [['KeyE']],
    strafeForward:  [['KeyW']],
    strafeBack:     [['KeyS']],
    strafeLeft:     [['KeyA']],
    strafeRight:    [['KeyD']],
    strafeUp:       [['Space'], ['KeyR']],
    strafeDown:     [['ControlLeft'], ['KeyF']],
    decoupleToggle: [['KeyC']],
    spaceBrake:     [['KeyX']],
    boost:          [['ShiftLeft']]
  };
}

let KEYBINDS: KeyBindings = defaultBindings();

// Human-readable labels for the UI
const ACTION_LABELS: Record<ActionName, string> = {
  pitchUp: 'Pitch up', pitchDown: 'Pitch down',
  yawLeft: 'Yaw left', yawRight: 'Yaw right',
  rollLeft: 'Roll left', rollRight: 'Roll right',
  strafeForward: 'Strafe forward', strafeBack: 'Strafe back',
  strafeLeft: 'Strafe left', strafeRight: 'Strafe right',
  strafeUp: 'Strafe up', strafeDown: 'Strafe down',
  decoupleToggle: 'Decouple toggle', spaceBrake: 'Space brake', boost: 'Boost'
};

// Best-effort mapping from our sim actions to real SC action identifiers.
// Ordered lists — first one found in the uploaded file wins.
const ACTION_NAME_CANDIDATES: Record<ActionName, string[]> = {
  pitchUp:        ['v_pitch_up'],
  pitchDown:      ['v_pitch_down'],
  yawLeft:        ['v_yaw_left'],
  yawRight:       ['v_yaw_right'],
  rollLeft:       ['v_roll_left'],
  rollRight:      ['v_roll_right'],
  strafeForward:  ['v_strafe_forward', 'v_throttle_up'],
  strafeBack:     ['v_strafe_back', 'v_throttle_down'],
  strafeLeft:     ['v_strafe_left'],
  strafeRight:    ['v_strafe_right'],
  strafeUp:       ['v_strafe_up'],
  strafeDown:     ['v_strafe_down'],
  decoupleToggle: ['v_ifcs_vector_decoupling_toggle'],
  spaceBrake:     ['v_space_brake'],
  boost:          ['v_afterburner']
};

const TOKEN_TO_CODE: Record<string, string> = {
  lshift: 'ShiftLeft', rshift: 'ShiftRight',
  lctrl: 'ControlLeft', rctrl: 'ControlRight',
  lalt: 'AltLeft', ralt: 'AltRight',
  space: 'Space',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  equals: 'Equal', minus: 'Minus',
  period: 'Period', comma: 'Comma',
  backslash: 'Backslash', slash: 'Slash',
  lbracket: 'BracketLeft', rbracket: 'BracketRight',
  semicolon: 'Semicolon', apostrophe: 'Quote',
  tab: 'Tab', capslock: 'CapsLock', backspace: 'Backspace',
  enter: 'Enter', escape: 'Escape', grave: 'Backquote'
};

export function tokenToCode(tok: string | null | undefined): string | null {
  if (!tok) return null;
  tok = tok.trim().toLowerCase();
  if (!tok) return null;
  if (TOKEN_TO_CODE[tok]) return TOKEN_TO_CODE[tok];
  if (/^[a-z]$/.test(tok)) return 'Key' + tok.toUpperCase();
  if (/^[0-9]$/.test(tok)) return 'Digit' + tok;
  const fMatch = tok.match(/^f([1-9]|1[0-9]|2[0-4])$/);
  if (fMatch) return 'F' + fMatch[1];
  return null; // mouse buttons / unsupported tokens — not usable as a keyboard chord
}

export function inputStringToChord(inputStr: string): KeyChord | null {
  // e.g. "kb1_lshift+right" -> ['ShiftLeft','ArrowRight']
  const parts = inputStr.replace(/^kb1_/, '').split('+');
  const codes = parts.map(tokenToCode);
  if (codes.some(c => !c)) return null; // unsupported token in this chord — skip it
  return codes as string[];
}

function parseXmlDoc(xmlText: string): Document {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const perr = doc.querySelector('parsererror');
  if (perr) throw new Error('Could not parse XML file.');
  return doc;
}

export function parseActionMapsXML(xmlText: string): ParsedActionMaps {
  const doc = parseXmlDoc(xmlText);
  const actionsRaw: Record<string, string[]> = {}; // scActionName -> array of raw "kb1_..." input strings
  doc.querySelectorAll('actionmap > action').forEach(actionEl => {
    const name = actionEl.getAttribute('name');
    if (!name) return;
    const kbInputs = Array.from(actionEl.querySelectorAll('rebind'))
      .map(r => r.getAttribute('input'))
      .filter((s): s is string => !!s && s.startsWith('kb1_'));
    if (kbInputs.length) {
      actionsRaw[name] = (actionsRaw[name] || []).concat(kbInputs);
    }
  });
  return { actionsRaw };
}

// Extracts the joystick devices SC knows about from <options type="joystick" .../>.
// The Product attribute looks like " VKBsim Gladiator EVO L    {0201231D-0000-0000-0000-504944564944}".
// That GUID is Windows' DirectInput device-instance GUID: the first 8 hex digits are
// ProductID+VendorID back to back (both as 4-hex little bits), and the trailing
// "504944564944" is literally the ASCII bytes for "PIDVID" — a fixed DirectInput suffix,
// not device-specific. We split the first 8 chars in half to recover PID and VID.
export function parseJoystickDevices(xmlText: string): ScDevice[] {
  const doc = parseXmlDoc(xmlText);
  const devices: ScDevice[] = [];
  doc.querySelectorAll('options[type="joystick"]').forEach(el => {
    const instance = el.getAttribute('instance') ?? '';
    const product = (el.getAttribute('Product') || '').trim();
    if (!product) return; // empty slot, e.g. instance="3" with no Product attribute at all
    const m = product.match(/^(.*?)\s*\{([0-9A-Fa-f]{8})-0000-0000-0000-504944564944\}$/);
    if (!m) { devices.push({ instance, name: product, guid: null, vid: null, pid: null }); return; }
    const name = m[1].trim();
    const hex8 = m[2].toUpperCase();
    const pid = hex8.slice(0, 4);
    const vid = hex8.slice(4, 8);
    devices.push({ instance, name, guid: m[2], vid, pid });
  });
  return devices;
}

// Extracts joystick AXIS bindings (as opposed to keyboard chords) for the handful
// of sim concepts that can plausibly be analog: strafe lateral/vertical/longitudinal,
// plus pitch/yaw/roll in case a future profile binds those to a stick too. Real SC
// axis tokens look like "js1_x", "js2_rotz" etc — a blank placeholder like "js1_ "
// (no letter) means the action exists but was never actually bound, and won't match.
const AXIS_TOKEN_RE = /^js(\d+)_(x|y|z|rotx|roty|rotz|slider1|slider2)$/i;
const AXIS_ACTION_CANDIDATES: Record<AxisConcept, string[]> = {
  strafeLateral:      ['v_strafe_lateral'],
  strafeVertical:     ['v_strafe_vertical'],
  strafeLongitudinal: ['v_strafe_longitudinal'],
  pitch:              ['v_pitch'],
  yaw:                ['v_yaw'],
  roll:               ['v_roll']
};

export function parseJoystickAxisBindings(xmlText: string): AxisRaw {
  const doc = parseXmlDoc(xmlText);
  const axisRaw: AxisRaw = {}; // scActionName -> [{instance, axis}, ...]
  doc.querySelectorAll('actionmap > action').forEach(actionEl => {
    const name = actionEl.getAttribute('name');
    if (!name) return;
    Array.from(actionEl.querySelectorAll('rebind')).forEach(r => {
      const input = (r.getAttribute('input') || '').trim();
      const m = input.match(AXIS_TOKEN_RE);
      if (m) (axisRaw[name] = axisRaw[name] || []).push({ instance: m[1], axis: m[2].toLowerCase() });
    });
  });
  return axisRaw;
}

export function buildAxisMap(axisRaw: AxisRaw): Partial<Record<AxisConcept, XmlAxisBinding>> {
  const map: Partial<Record<AxisConcept, XmlAxisBinding>> = {};
  for (const concept of Object.keys(AXIS_ACTION_CANDIDATES) as AxisConcept[]) {
    for (const cand of AXIS_ACTION_CANDIDATES[concept]) {
      if (axisRaw[cand] && axisRaw[cand].length) {
        map[concept] = { instance: axisRaw[cand][0].instance, axis: axisRaw[cand][0].axis, scName: cand };
        break;
      }
    }
  }
  return map;
}

export function buildOverridesFromParsed(parsed: ParsedActionMaps): BuiltOverrides {
  // Automatically matches file actions to sim actions via the best-effort
  // name table above. Returns what matched (and will be applied) plus
  // what wasn't found, so the import result is transparent even though
  // it's applied automatically.
  const overrides: Partial<Record<ActionName, KeyChord[]>> = {};
  const matched: MatchedOverride[] = [];
  const notFound: NotFoundOverride[] = [];
  for (const simAction of Object.keys(ACTION_NAME_CANDIDATES) as ActionName[]) {
    const candidates = ACTION_NAME_CANDIDATES[simAction];
    let scName: string | null = null;
    let rawInputs: string[] | null = null;
    for (const cand of candidates) {
      if (parsed.actionsRaw[cand]) { scName = cand; rawInputs = parsed.actionsRaw[cand]; break; }
    }
    if (rawInputs) {
      const chords = rawInputs.map(inputStringToChord).filter((c): c is KeyChord => !!c);
      if (chords.length) {
        overrides[simAction] = chords;
        matched.push({ simAction, scName: scName as string, chords });
        continue;
      }
    }
    notFound.push({ simAction, candidates });
  }
  return { overrides, matched, notFound };
}

export function applyOverrides(overrides: Partial<Record<ActionName, KeyChord[]>>): void {
  for (const [action, chords] of Object.entries(overrides) as [ActionName, KeyChord[]][]) {
    KEYBINDS[action] = chords;
  }
}

export function setBinding(simAction: ActionName, chords: KeyChord[]): void {
  KEYBINDS[simAction] = chords;
}

export function resetToDefault(): void {
  KEYBINDS = defaultBindings();
}

export function isActive(action: ActionName): boolean {
  const chords = KEYBINDS[action];
  if (!chords) return false;
  return chords.some(chord => chord.every(code => !!keys[code]));
}

export function chordJustPressed(action: ActionName, justPressedCode: string): boolean {
  const chords = KEYBINDS[action];
  if (!chords) return false;
  return chords.some(chord => chord.includes(justPressedCode) && chord.every(code => !!keys[code]));
}

function codeToLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5);
  return ({ ShiftLeft: 'Shift', ShiftRight: 'RShift', ControlLeft: 'Ctrl', ControlRight: 'RCtrl',
    AltLeft: 'Alt', AltRight: 'RAlt', Space: 'Space' } as Record<string, string>)[code] || code;
}
export function chordToLabel(chord: KeyChord): string {
  return chord.map(codeToLabel).join('+');
}

// ---- Persistence: artifact storage when available, file export/import otherwise ----
export const hasArtifactStorage = typeof window !== 'undefined' && typeof window.storage === 'object' && window.storage !== null;
const PRESET_PREFIX = 'control-preset:';

export async function savePreset(name: string): Promise<void> {
  if (!hasArtifactStorage) throw new Error('no-storage');
  await window.storage!.set(PRESET_PREFIX + name, JSON.stringify(KEYBINDS), false);
}
export async function loadPreset(name: string): Promise<void> {
  if (!hasArtifactStorage) throw new Error('no-storage');
  const res = await window.storage!.get(PRESET_PREFIX + name, false);
  if (!res) throw new Error('Preset not found.');
  KEYBINDS = JSON.parse(res.value);
}
export async function deletePreset(name: string): Promise<void> {
  if (!hasArtifactStorage) throw new Error('no-storage');
  await window.storage!.delete(PRESET_PREFIX + name, false);
}
export async function listPresets(): Promise<string[]> {
  if (!hasArtifactStorage) throw new Error('no-storage');
  const res = await window.storage!.list(PRESET_PREFIX, false);
  return (res && res.keys ? res.keys : []).map(k => k.slice(PRESET_PREFIX.length));
}

export function exportToFile(name: string): void {
  const blob = new Blob([JSON.stringify(KEYBINDS, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (name || 'control-preset') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}
export function importFromFileText(text: string): void {
  KEYBINDS = JSON.parse(text);
}

export function getBindings(): KeyBindings {
  return KEYBINDS;
}
export function getActionLabels(): Record<ActionName, string> {
  return ACTION_LABELS;
}

export { keys };
