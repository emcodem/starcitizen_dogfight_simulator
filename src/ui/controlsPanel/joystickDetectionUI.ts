import type { AxisConcept, GamepadSnapshot } from '../../types';
import * as GamepadModule from '../../input/gamepadModule';
import * as JoystickAxes from '../../input/joystickAxes';
import { getScDevices, getAxisMap } from '../../input/deviceState';
import { isChromium } from '../deviceDetect';

const panel = document.getElementById('ctrl-panel') as HTMLElement;
const scDevicesList = document.getElementById('ctrl-sc-devices-list') as HTMLElement;
const gamepadList = document.getElementById('ctrl-gamepad-list') as HTMLElement;
const gamepadSupportStatus = document.getElementById('ctrl-gamepad-support-status') as HTMLElement;
const vjoyChromeWarning = document.getElementById('ctrl-vjoy-chrome-warning') as HTMLElement;

// The single most important vJoy caveat, reused across the tooltip, the banner, and the help box so
// the message is identical everywhere: on Chrome/Edge, vJoy doesn't just read zero — its mere
// presence stops REAL sticks from being enumerated at all. Firefox is unaffected.
const VJOY_CHROME_TOOLTIP =
  'On Chrome/Edge, having vJoy installed can prevent some devices from being detected — and ' +
  'vJoy’s own axes read as zero. Use Firefox for vJoy, or uninstall/disable vJoy to use your real stick in Chrome.';

// vJoy shares one USB vendor/product ID (1234:BEAD) across all its virtual devices; the id string
// also contains "vJoy". Chromium doesn't report vJoy axis input, so we flag each detected vJoy.
const CHROMIUM = isChromium();
function isVjoy(p: GamepadSnapshot): boolean {
  return (p.vid === '1234' && p.pid === 'BEAD') || /vjoy/i.test(p.id);
}

function renderAxisMap(): void {
  const axisMapEl = document.getElementById('ctrl-axis-map-list') as HTMLElement;
  const axisMap = getAxisMap();
  const concepts = Object.keys(axisMap) as AxisConcept[];
  if (!concepts.length) { axisMapEl.innerHTML = '(no joystick axis bindings found in the loaded file)'; return; }
  const stick = JoystickAxes.read();
  const valueFor: Record<AxisConcept, number | null> = {
    strafeLateral: stick.lateral, strafeVertical: stick.vertical, strafeLongitudinal: stick.longitudinal,
    pitch: stick.pitch, yaw: stick.yaw, roll: stick.roll
  };
  axisMapEl.innerHTML = concepts.map(c => {
    const b = axisMap[c]!;
    const v = valueFor[c];
    const status = v === null ? 'device not currently detected' : v.toFixed(2);
    const label = b.manual ? b.label : `js${b.instance}_${b.axis} (${b.scName})`;
    return `<div class="${v === null ? 'ctrl-missing' : 'ctrl-found'}">${c} ← ${label}: ${status}</div>`;
  }).join('');
}

function renderScDevices(): void {
  const scDevices = getScDevices();
  if (!scDevices.length) { scDevicesList.innerHTML = '(load actionmaps.xml above)'; return; }
  const pads = GamepadModule.getSnapshot();
  scDevicesList.innerHTML = scDevices.map(d => {
    if (!d.vid) {
      return `<div class="ctrl-missing">js${d.instance}: ${d.name} — GUID format not recognized, can't auto-match</div>`;
    }
    const hit = pads.find(p => p.vid === d.vid && p.pid === d.pid);
    return hit
      ? `<div class="ctrl-found">✓ js${d.instance}: ${d.name} (VID ${d.vid} PID ${d.pid}) — seen as browser gamepad #${hit.index}</div>`
      : `<div class="ctrl-missing">js${d.instance}: ${d.name} (VID ${d.vid} PID ${d.pid}) — not detected yet</div>`;
  }).join('');
}

// A one-line health readout of the browser's gamepad access, so a user whose stick won't appear can
// see *why* at a glance instead of just an empty list. The common Chrome failure modes each show a
// distinct signature here: non-secure origin, unfocused tab, or enumerated-but-empty slots.
function renderDiagnostics(): void {
  const d = GamepadModule.getDiagnostics();
  if (!d.supported) {
    gamepadSupportStatus.innerHTML =
      '<span class="ctrl-missing">This browser does not expose the Gamepad API.</span> ' +
      'Chrome/Edge require a <b>secure origin</b> — use the HTTPS site or <code>http://localhost</code>, ' +
      'not a <code>file://</code> or LAN-IP address.';
    return;
  }
  const parts: string[] = [];
  parts.push(d.secureContext
    ? 'secure origin ✓'
    : '<span class="ctrl-missing">insecure origin ✗ — Chrome needs HTTPS or localhost</span>');
  parts.push(d.focused
    ? 'tab focused ✓'
    : '<span class="ctrl-missing">tab not focused — click this page, then press a stick button</span>');
  parts.push(`slots: ${d.rawSlotCount} (${d.activeCount} active)`);
  gamepadSupportStatus.innerHTML = 'Gamepad API: ' + parts.join(' · ');
}

export function renderGamepads(): void {
  renderDiagnostics();
  const pads = GamepadModule.getSnapshot();
  // Prominent banner when Chromium sees a vJoy at all: its presence suppresses real-device
  // enumeration, so a user hunting for a "missing" stick needs to know vJoy is the likely cause.
  const chromeVjoyPresent = CHROMIUM && pads.some(isVjoy);
  vjoyChromeWarning.style.display = chromeVjoyPresent ? 'block' : 'none';
  if (chromeVjoyPresent) {
    vjoyChromeWarning.innerHTML =
      '⚠ <b>vJoy detected in Chrome/Edge.</b> On Chromium, having vJoy installed can prevent ' +
      'some of your <b>real</b> devices from being detected (and vJoy’s own axes read as zero). ' +
      'If a stick is missing below, this may be why — use <b>Firefox</b>, or uninstall/disable vJoy to fly with your real stick in Chrome.';
  }
  if (!pads.length) {
    const d = GamepadModule.getDiagnostics();
    gamepadList.innerHTML = d.rawSlotCount > 0
      ? '(browser reports empty gamepad slots — press a button on the stick with this tab focused to populate them)'
      : '(none yet — press a button on each device)';
  } else {
    gamepadList.innerHTML = pads.map(p => {
      const axesStr = p.axesValues.map((v, i) => `[${i}]${v.toFixed(2)}`).join(' ');
      // Listing every button is too noisy on big HOTAS — show the total count and only which
      // indices are currently pressed (so a user can identify a button by pressing it).
      const pressed = p.buttonsPressed.reduce<number[]>((acc, isDown, i) => (isDown && acc.push(i), acc), []);
      const buttonsStr = `count ${p.buttonsPressed.length}, pressed: [${pressed.join(', ')}]`;
      // On Chromium, vJoy's presence blocks real-device detection (and its own axes read zero) —
      // flag each detected vJoy with a hover-tooltip warning.
      const warn = (CHROMIUM && isVjoy(p))
        ? `<span class="ctrl-vjoy-warn" title="${VJOY_CHROME_TOOLTIP}">⚠</span> `
        : '';
      return `<div class="ctrl-found">${warn}#${p.index}: ${p.id}` +
        (p.vid ? ` — VID ${p.vid} PID ${p.pid}` : '') +
        `<br>&nbsp;&nbsp;axes: ${axesStr}` +
        `<br>&nbsp;&nbsp;buttons: ${buttonsStr}</div>`;
    }).join('');
  }
  renderScDevices(); // cross-reference depends on the current pad snapshot too
  renderAxisMap();
}

export function initJoystickDetectionUI(): void {
  const vjoyInfoBtn = document.getElementById('ctrl-vjoy-info-btn') as HTMLButtonElement;
  const vjoyInfo = document.getElementById('ctrl-vjoy-info') as HTMLElement;
  vjoyInfoBtn.addEventListener('click', () => {
    vjoyInfo.style.display = vjoyInfo.style.display === 'none' ? 'block' : 'none';
  });

  if (!GamepadModule.isSupported()) {
    renderDiagnostics(); // explains the secure-origin requirement rather than a bare "not exposed"
    return;
  }
  // Refresh immediately whenever a device connects/disconnects (Chrome can stay blind under
  // pure polling until a connect event fires), on top of the interval below.
  GamepadModule.initConnectionListeners(() => {
    if (panel.style.display !== 'none') renderGamepads();
  });
  // live poll while the panel is open — the browser gives us no reliable
  // per-device change event, and detection depends on the user actually
  // moving/pressing each stick, so this needs to keep checking
  setInterval(() => {
    if (panel.style.display === 'none') return;
    GamepadModule.poll();
    renderGamepads();
  }, 100);
}
