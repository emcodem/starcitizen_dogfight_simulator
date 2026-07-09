import * as MouseLook from '../input/mouseLook';
import { onConfigApplied } from '../input/configRegistry';

function syncMouseSettingsUI(): void {
  const sensSlider = document.getElementById('ctrl-mouse-sens') as HTMLInputElement | null;
  if (sensSlider) sensSlider.value = String(MouseLook.getSensitivity());

  const deadzoneSlider = document.getElementById('ctrl-mouse-deadzone') as HTMLInputElement | null;
  if (deadzoneSlider) deadzoneSlider.value = String(MouseLook.getDeadzone());

  const invertCheckbox = document.getElementById('ctrl-mouse-invert') as HTMLInputElement | null;
  if (invertCheckbox) invertCheckbox.checked = MouseLook.getInvertY();
}

// Keeps the sliders in sync whenever a control preset is loaded/imported/restored,
// without the preset UI needing to know mouse settings exist.
onConfigApplied(syncMouseSettingsUI);

export function initMouseCapture(): void {
  const hint = document.getElementById('mouse-capture-hint') as HTMLElement;
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const noMouse = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  if (noMouse) return; // touch devices use the on-screen joystick instead

  hint.addEventListener('click', () => MouseLook.requestCapture());
  canvas.addEventListener('click', () => {
    if (!MouseLook.isCaptured()) MouseLook.requestCapture();
  });
  MouseLook.onChange(captured => {
    hint.style.display = captured ? 'none' : 'block';
    const statusEl = document.getElementById('ctrl-mouse-status');
    if (statusEl) statusEl.textContent = captured
      ? 'Captured — Esc, alt-tab, or Interact (F) to release.'
      : 'Not captured — click the game view or press Interact (F) to enable.';
  });

  // primary fire itself is polled each physics tick from the configured mouse button
  // (see physics/step.ts + input/mouseButtons.ts) — nothing to wire here anymore.

  syncMouseSettingsUI();
  const sensSlider = document.getElementById('ctrl-mouse-sens') as HTMLInputElement;
  sensSlider.addEventListener('input', e => MouseLook.setSensitivity(parseFloat((e.target as HTMLInputElement).value)));

  const deadzoneSlider = document.getElementById('ctrl-mouse-deadzone') as HTMLInputElement;
  deadzoneSlider.addEventListener('input', e => MouseLook.setDeadzone(parseFloat((e.target as HTMLInputElement).value)));

  const invertCheckbox = document.getElementById('ctrl-mouse-invert') as HTMLInputElement;
  invertCheckbox.addEventListener('change', e => MouseLook.setInvertY((e.target as HTMLInputElement).checked));

  document.getElementById('ctrl-mouse-recenter')!.addEventListener('click', () => MouseLook.recenter());
  // quick keyboard shortcut to recenter the virtual stick mid-flight without opening the panel
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyV' && MouseLook.isCaptured()) MouseLook.recenter();
  });
}
