import type { ActionName, AxisConcept } from '../../types';
import * as ControlsModule from '../../input/controlsModule';
import * as GamepadModule from '../../input/gamepadModule';
import * as JoystickAxes from '../../input/joystickAxes';
import { getAxisMap, bindAxis, unbindAxis, getButtonMap, bindButton, unbindButton } from '../../input/deviceState';

const bindingsList = document.getElementById('ctrl-bindings-list') as HTMLElement;
const rebindStatus = document.getElementById('ctrl-rebind-status') as HTMLElement;

let pendingRebindAction: ActionName | null = null;

// Maps each digital action to the joystick axis concept it corresponds to (if any),
// so the bindings table can show keyboard and joystick side by side per control.
// decoupleToggle/spaceBrake/boost have no analog equivalent — those get a joystick BUTTON
// binding instead (see BUTTON_BINDABLE_ACTIONS below).
const ACTION_TO_AXIS_CONCEPT: Partial<Record<ActionName, AxisConcept>> = {
  pitchUp: 'pitch', pitchDown: 'pitch',
  yawLeft: 'yaw', yawRight: 'yaw',
  rollLeft: 'roll', rollRight: 'roll',
  strafeForward: 'strafeLongitudinal', strafeBack: 'strafeLongitudinal',
  strafeLeft: 'strafeLateral', strafeRight: 'strafeLateral',
  strafeUp: 'strafeVertical', strafeDown: 'strafeVertical'
};
// JoystickAxes.read() uses shorthand keys that differ from the axisMap concept names above
const STICK_KEY_FOR_CONCEPT: Record<AxisConcept, keyof ReturnType<typeof JoystickAxes.read>> = {
  pitch: 'pitch', yaw: 'yaw', roll: 'roll',
  strafeLateral: 'lateral', strafeVertical: 'vertical', strafeLongitudinal: 'longitudinal'
};
const CONCEPT_LABELS: Record<AxisConcept, string> = {
  pitch: 'Pitch', yaw: 'Yaw', roll: 'Roll',
  strafeLongitudinal: 'Strafe Forward/Back', strafeLateral: 'Strafe Left/Right', strafeVertical: 'Strafe Up/Down'
};

// =====================================================================
// Joystick axis rebind capture. A single physical axis drives BOTH directions
// of a concept (e.g. one roll axis covers rollLeft AND rollRight), so unlike
// keyboard rebind (one key per action) this listens for whichever axis moves
// and binds the whole concept to it — the user doesn't pick a direction.
// Detects the exact device + axis array-index live, so unlike XML-imported
// axis bindings (which guess the index from a letter — see AXIS_INDEX in
// JoystickAxes), a manually-captured binding needs no guessing at all.
// =====================================================================
let pendingAxisRebindConcept: AxisConcept | null = null;
let axisRebindBaseline: Array<{ index: number; axes: number[] }> | null = null;
let axisRebindRAF: number | null = null;
const AXIS_REBIND_THRESHOLD = 0.4;

function cancelAxisRebind(): void {
  if (axisRebindRAF !== null) cancelAnimationFrame(axisRebindRAF);
  axisRebindRAF = null;
  pendingAxisRebindConcept = null;
  axisRebindBaseline = null;
}

function completeAxisRebind(concept: AxisConcept, pad: { id: string; vid: string | null; pid: string | null }, axisIndex: number): void {
  if (!pad.vid || !pad.pid) return; // guarded by callers, but keeps TS happy
  const niceName = pad.id.split('(')[0].trim();
  bindAxis(concept, { vid: pad.vid, pid: pad.pid, axisIndex, label: `${niceName} axis[${axisIndex}]`, manual: true });
  rebindStatus.textContent = `Bound "${niceName}" axis [${axisIndex}] to ${CONCEPT_LABELS[concept] || concept}.`;
  cancelAxisRebind();
  renderBindings();
}

function pollAxisRebind(): void {
  if (!pendingAxisRebindConcept || !axisRebindBaseline) return;
  GamepadModule.poll();
  const current = GamepadModule.getSnapshot();
  for (const base of axisRebindBaseline) {
    const now = current.find(p => p.index === base.index);
    if (!now) continue;
    for (let i = 0; i < base.axes.length; i++) {
      if (Math.abs((now.axesValues[i] || 0) - base.axes[i]) > AXIS_REBIND_THRESHOLD) {
        if (!now.vid || !now.pid) {
          rebindStatus.textContent = 'Could not identify that device\'s vendor/product ID — cannot bind it.';
          cancelAxisRebind();
          renderBindings();
          return;
        }
        completeAxisRebind(pendingAxisRebindConcept, now, i);
        return;
      }
    }
  }
  axisRebindRAF = requestAnimationFrame(pollAxisRebind);
}

function startAxisRebind(concept: AxisConcept): void {
  cancelAxisRebind();
  cancelButtonRebind();
  pendingRebindAction = null; // mutually exclusive with a pending keyboard rebind
  pendingAxisRebindConcept = concept;
  GamepadModule.poll();
  axisRebindBaseline = GamepadModule.getSnapshot().map(p => ({ index: p.index, axes: p.axesValues.slice() }));
  rebindStatus.textContent = `Move the joystick axis for "${CONCEPT_LABELS[concept] || concept}"… (Esc to cancel)`;
  renderBindings();
  axisRebindRAF = requestAnimationFrame(pollAxisRebind);
}

// Escape cancels an in-progress axis capture (separate from the keyboard rebind
// Escape handler below, which only fires when pendingRebindAction is set). Stops
// propagation so it doesn't also trigger the panel's own Escape-to-close handler —
// cancelling a capture shouldn't slam the whole panel shut in the same keystroke.
window.addEventListener('keydown', e => {
  if (e.code !== 'Escape' || !pendingAxisRebindConcept) return;
  e.stopPropagation();
  cancelAxisRebind();
  rebindStatus.textContent = 'Joystick bind cancelled.';
  renderBindings();
});

// =====================================================================
// Joystick BUTTON rebind capture — for decoupleToggle/spaceBrake, which are
// discrete toggles rather than analog axes. Unlike axis capture (which looks
// for the largest deviation from a baseline), a button binding is a plain
// rising edge: any button not already held at capture start that becomes
// pressed is the one bound. No direction pairing needed (one action, one button).
// =====================================================================
const BUTTON_BINDABLE_ACTIONS: ActionName[] = ['decoupleToggle', 'spaceBrake', 'boost'];
let pendingButtonRebindAction: ActionName | null = null;
let buttonRebindBaseline: Array<{ index: number; buttons: boolean[] }> | null = null;
let buttonRebindRAF: number | null = null;

function cancelButtonRebind(): void {
  if (buttonRebindRAF !== null) cancelAnimationFrame(buttonRebindRAF);
  buttonRebindRAF = null;
  pendingButtonRebindAction = null;
  buttonRebindBaseline = null;
}

function completeButtonRebind(action: ActionName, pad: { id: string; vid: string | null; pid: string | null }, buttonIndex: number): void {
  if (!pad.vid || !pad.pid) return;
  const niceName = pad.id.split('(')[0].trim();
  bindButton(action, { vid: pad.vid, pid: pad.pid, buttonIndex, label: `${niceName} button[${buttonIndex}]` });
  rebindStatus.textContent = `Bound "${niceName}" button [${buttonIndex}] to ${ControlsModule.getActionLabels()[action]}.`;
  cancelButtonRebind();
  renderBindings();
}

function pollButtonRebind(): void {
  if (!pendingButtonRebindAction || !buttonRebindBaseline) return;
  GamepadModule.poll();
  const current = GamepadModule.getSnapshot();
  for (const base of buttonRebindBaseline) {
    const now = current.find(p => p.index === base.index);
    if (!now) continue;
    for (let i = 0; i < base.buttons.length; i++) {
      if (now.buttonsPressed[i] && !base.buttons[i]) {
        if (!now.vid || !now.pid) {
          rebindStatus.textContent = 'Could not identify that device\'s vendor/product ID — cannot bind it.';
          cancelButtonRebind();
          renderBindings();
          return;
        }
        completeButtonRebind(pendingButtonRebindAction, now, i);
        return;
      }
    }
  }
  buttonRebindRAF = requestAnimationFrame(pollButtonRebind);
}

function startButtonRebind(action: ActionName): void {
  cancelAxisRebind();
  cancelButtonRebind();
  pendingRebindAction = null; // mutually exclusive with a pending keyboard rebind
  pendingButtonRebindAction = action;
  GamepadModule.poll();
  buttonRebindBaseline = GamepadModule.getSnapshot().map(p => ({ index: p.index, buttons: p.buttonsPressed.slice() }));
  rebindStatus.textContent = `Press the joystick button for "${ControlsModule.getActionLabels()[action]}"… (Esc to cancel)`;
  renderBindings();
  buttonRebindRAF = requestAnimationFrame(pollButtonRebind);
}

// Escape cancels an in-progress button capture (see note above the axis-capture handler
// re: stopPropagation)
window.addEventListener('keydown', e => {
  if (e.code !== 'Escape' || !pendingButtonRebindAction) return;
  e.stopPropagation();
  cancelButtonRebind();
  rebindStatus.textContent = 'Joystick bind cancelled.';
  renderBindings();
});

export function renderBindings(): void {
  const labels = ControlsModule.getActionLabels();
  const bindings = ControlsModule.getBindings();
  const stick = JoystickAxes.read();
  const axisMap = getAxisMap();
  const buttonMap = getButtonMap();

  let html = '<table id="ctrl-bindings-table"><thead><tr>' +
    '<th>Action</th><th>Keyboard</th><th>Joystick</th>' +
    '</tr></thead><tbody>';

  for (const action of Object.keys(labels) as ActionName[]) {
    const chords = bindings[action] || [];
    const chordLabel = chords.length ? chords.map(ControlsModule.chordToLabel).join(' / ') : '(unbound)';
    const isPending = pendingRebindAction === action;
    const kbCell = `<div>${isPending ? '<span class="ctrl-found">press a key…</span>' : `<span class="ctrl-found">${chordLabel}</span>`}</div>` +
      `<div style="margin-top:4px"><button type="button" class="ctrl-rebind-btn" data-action="${action}">${isPending ? 'Cancel' : 'Rebind'}</button></div>`;

    let joyCell: string;
    const concept = ACTION_TO_AXIS_CONCEPT[action];
    if (concept) {
      const isListening = pendingAxisRebindConcept === concept;
      const binding = axisMap[concept];
      let valueHtml: string;
      if (isListening) {
        valueHtml = '<span class="ctrl-found">listening… move a stick axis</span>';
      } else if (binding) {
        const detected = stick[STICK_KEY_FOR_CONCEPT[concept]] !== null;
        const label = binding.manual ? binding.label : `js${binding.instance}_${binding.axis}`;
        valueHtml = detected
          ? `<span class="ctrl-found">${label}</span>`
          : `<span class="ctrl-missing">${label} (not detected)</span>`;
      } else {
        valueHtml = '<span class="ctrl-missing">unbound</span>';
      }
      const inverted = JoystickAxes.getInvert()[concept];
      const invertHtml = (binding && !isListening)
        ? `<label style="display:inline-flex; align-items:center; gap:4px; margin-left:8px; color:var(--hud-dim)">` +
          `<input type="checkbox" class="ctrl-invert-checkbox" data-concept="${concept}" ${inverted ? 'checked' : ''} style="width:auto"> invert</label>`
        : '';
      let actionBtnHtml: string;
      if (isListening) {
        actionBtnHtml = `<button type="button" class="ctrl-axis-rebind-btn" data-concept="${concept}">Cancel</button>`;
      } else if (binding) {
        actionBtnHtml = `<button type="button" class="ctrl-axis-unbind-btn" data-concept="${concept}">Unbind</button>`;
      } else {
        actionBtnHtml = `<button type="button" class="ctrl-axis-rebind-btn" data-concept="${concept}">Bind Axis</button>`;
      }
      joyCell = `<div>${valueHtml}</div><div style="margin-top:4px; display:flex; align-items:center">${actionBtnHtml}${invertHtml}</div>`;
    } else if (BUTTON_BINDABLE_ACTIONS.includes(action)) {
      const isListening = pendingButtonRebindAction === action;
      const binding = buttonMap[action];
      let valueHtml: string;
      if (isListening) {
        valueHtml = '<span class="ctrl-found">listening… press a button</span>';
      } else if (binding) {
        const detected = !!GamepadModule.findByVidPid(binding.vid, binding.pid);
        valueHtml = detected
          ? `<span class="ctrl-found">${binding.label}</span>`
          : `<span class="ctrl-missing">${binding.label} (not detected)</span>`;
      } else {
        valueHtml = '<span class="ctrl-missing">unbound</span>';
      }
      let actionBtnHtml: string;
      if (isListening) {
        actionBtnHtml = `<button type="button" class="ctrl-button-rebind-btn" data-action="${action}">Cancel</button>`;
      } else if (binding) {
        actionBtnHtml = `<button type="button" class="ctrl-button-unbind-btn" data-action="${action}">Unbind</button>`;
      } else {
        actionBtnHtml = `<button type="button" class="ctrl-button-rebind-btn" data-action="${action}">Bind Joystick Button</button>`;
      }
      joyCell = `<div>${valueHtml}</div><div style="margin-top:4px">${actionBtnHtml}</div>`;
    } else {
      joyCell = '<span class="ctrl-missing">— (keyboard/mouse only)</span>';
    }

    html += `<tr>
      <td class="ctrl-action-label">${labels[action]}</td>
      <td>${kbCell}</td>
      <td>${joyCell}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  bindingsList.innerHTML = html;

  bindingsList.querySelectorAll('.ctrl-rebind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      cancelAxisRebind(); // mutually exclusive with an in-progress joystick capture
      cancelButtonRebind();
      const action = btn.getAttribute('data-action') as ActionName;
      pendingRebindAction = pendingRebindAction === action ? null : action;
      renderBindings();
    });
  });

  bindingsList.querySelectorAll('.ctrl-axis-rebind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const concept = btn.getAttribute('data-concept') as AxisConcept;
      if (pendingAxisRebindConcept === concept) { cancelAxisRebind(); renderBindings(); return; }
      startAxisRebind(concept);
    });
  });

  bindingsList.querySelectorAll('.ctrl-axis-unbind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const concept = btn.getAttribute('data-concept') as AxisConcept;
      unbindAxis(concept);
      rebindStatus.textContent = `Unbound joystick axis for "${CONCEPT_LABELS[concept] || concept}".`;
      renderBindings();
    });
  });

  bindingsList.querySelectorAll('.ctrl-button-rebind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action') as ActionName;
      if (pendingButtonRebindAction === action) { cancelButtonRebind(); renderBindings(); return; }
      startButtonRebind(action);
    });
  });

  bindingsList.querySelectorAll('.ctrl-button-unbind-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action') as ActionName;
      unbindButton(action);
      rebindStatus.textContent = `Unbound joystick button for "${ControlsModule.getActionLabels()[action]}".`;
      renderBindings();
    });
  });

  // one invert checkbox per axis concept, but two actions share a concept (e.g.
  // pitchUp/pitchDown both -> 'pitch') so re-render on change to keep both rows in sync
  bindingsList.querySelectorAll('.ctrl-invert-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const checkbox = cb as HTMLInputElement;
      JoystickAxes.setInvert(checkbox.getAttribute('data-concept') as AxisConcept, checkbox.checked);
      renderBindings();
    });
  });
}

export function initBindingsTableUI(): void {
  // capture the next key press while a rebind is pending, before it reaches game input
  window.addEventListener('keydown', e => {
    if (!pendingRebindAction) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.code === 'Escape') { pendingRebindAction = null; renderBindings(); return; }
    ControlsModule.setBinding(pendingRebindAction, [[e.code]]);
    rebindStatus.textContent = `Set "${ControlsModule.getActionLabels()[pendingRebindAction]}" to ${ControlsModule.chordToLabel([e.code])}.`;
    pendingRebindAction = null;
    renderBindings();
  }, true); // capture phase so it runs before the main game keydown handler

  document.getElementById('ctrl-reset-btn')!.addEventListener('click', () => {
    ControlsModule.resetToDefault();
    renderBindings();
    rebindStatus.textContent = 'Reset to sandbox defaults.';
  });
}
