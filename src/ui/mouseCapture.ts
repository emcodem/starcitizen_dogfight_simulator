import * as MouseLook from '../input/mouseLook';
import { setFiring } from '../world/weapons';

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
    if (statusEl) statusEl.textContent = captured ? 'Captured — Esc or alt-tab to release.' : 'Not captured — click the game view to enable.';
  });

  // fire weapons — left mouse button, but only once the pointer is already
  // captured (so the very first click just captures the mouse, as before)
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0 && MouseLook.isCaptured()) setFiring(true);
  });
  window.addEventListener('mouseup', e => {
    if (e.button === 0) setFiring(false);
  });

  const sensSlider = document.getElementById('ctrl-mouse-sens') as HTMLInputElement;
  sensSlider.value = String(MouseLook.getSensitivity());
  sensSlider.addEventListener('input', e => MouseLook.setSensitivity(parseFloat((e.target as HTMLInputElement).value)));

  const deadzoneSlider = document.getElementById('ctrl-mouse-deadzone') as HTMLInputElement;
  deadzoneSlider.value = String(MouseLook.getDeadzone());
  deadzoneSlider.addEventListener('input', e => MouseLook.setDeadzone(parseFloat((e.target as HTMLInputElement).value)));

  const invertCheckbox = document.getElementById('ctrl-mouse-invert') as HTMLInputElement;
  invertCheckbox.checked = MouseLook.getInvertY();
  invertCheckbox.addEventListener('change', e => MouseLook.setInvertY((e.target as HTMLInputElement).checked));

  document.getElementById('ctrl-mouse-recenter')!.addEventListener('click', () => MouseLook.recenter());
  // quick keyboard shortcut to recenter the virtual stick mid-flight without opening the panel
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyV' && MouseLook.isCaptured()) MouseLook.recenter();
  });
}

// keyboard fallback for firing (works without mouse-look captured, e.g. keyboard-only play)
export function initKeyboardFireFallback(): void {
  window.addEventListener('keydown', e => { if (e.code === 'ShiftRight') setFiring(true); });
  window.addEventListener('keyup', e => { if (e.code === 'ShiftRight') setFiring(false); });
}
