import type { AxisConcept } from '../../types';
import * as GamepadModule from '../../input/gamepadModule';
import * as JoystickAxes from '../../input/joystickAxes';
import { getScDevices, getAxisMap } from '../../input/deviceState';

const panel = document.getElementById('ctrl-panel') as HTMLElement;
const scDevicesList = document.getElementById('ctrl-sc-devices-list') as HTMLElement;
const gamepadList = document.getElementById('ctrl-gamepad-list') as HTMLElement;
const gamepadSupportStatus = document.getElementById('ctrl-gamepad-support-status') as HTMLElement;

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

export function renderGamepads(): void {
  const pads = GamepadModule.getSnapshot();
  if (!pads.length) {
    gamepadList.innerHTML = '(none yet — press a button on each device)';
  } else {
    gamepadList.innerHTML = pads.map(p => {
      const axesStr = p.axesValues.map((v, i) => `[${i}]${v.toFixed(2)}`).join(' ');
      // Listing every button is too noisy on big HOTAS — show the total count and only which
      // indices are currently pressed (so a user can identify a button by pressing it).
      const pressed = p.buttonsPressed.reduce<number[]>((acc, isDown, i) => (isDown && acc.push(i), acc), []);
      const buttonsStr = `count ${p.buttonsPressed.length}, pressed: [${pressed.join(', ')}]`;
      return `<div class="ctrl-found">#${p.index}: ${p.id}` +
        (p.vid ? ` — VID ${p.vid} PID ${p.pid}` : '') +
        `<br>&nbsp;&nbsp;axes: ${axesStr}` +
        `<br>&nbsp;&nbsp;buttons: ${buttonsStr}</div>`;
    }).join('');
  }
  renderScDevices(); // cross-reference depends on the current pad snapshot too
  renderAxisMap();
}

export function initJoystickDetectionUI(): void {
  if (!GamepadModule.isSupported()) {
    gamepadSupportStatus.textContent = 'This browser does not expose the Gamepad API.';
    return;
  }
  // live poll while the panel is open — the browser gives us no reliable
  // per-device change event, and detection depends on the user actually
  // moving/pressing each stick, so this needs to keep checking
  setInterval(() => {
    if (panel.style.display === 'none') return;
    GamepadModule.poll();
    renderGamepads();
  }, 100);
}
