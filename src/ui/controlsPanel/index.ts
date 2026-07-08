import { initBindingsTableUI, renderBindings } from './bindingsTableUI';
import { initPresetsUI, refreshPresetList, restoreLastPreset } from './presetsUI';
import { initActionmapsImportUI } from './actionmapsImportUI';
import { initJoystickDetectionUI } from './joystickDetectionUI';

export function initControlsPanel(): void {
  initBindingsTableUI();
  initPresetsUI();
  initActionmapsImportUI();
  initJoystickDetectionUI();
  restoreLastPreset();

  const toggleBtn = document.getElementById('ctrl-toggle') as HTMLElement;
  const closeBtn = document.getElementById('ctrl-close-btn') as HTMLElement;
  const panel = document.getElementById('ctrl-panel') as HTMLElement;

  function open(): void {
    panel.style.display = 'block';
    renderBindings();
    refreshPresetList();
  }
  function close(): void {
    panel.style.display = 'none';
  }

  function toggleOpen(): void {
    if (panel.style.display === 'none') open(); else close();
  }
  toggleBtn.addEventListener('click', toggleOpen);
  closeBtn.addEventListener('click', close);
  window.addEventListener('keydown', e => {
    if (e.code !== 'F4') return;
    e.preventDefault();
    toggleOpen();
  });

  // Escape closes the panel — but a pending keyboard/axis/button rebind capture (see
  // bindingsTableUI) consumes Escape first via stopPropagation, so this only fires once
  // nothing is mid-capture: first Escape cancels a capture, a second Escape closes the panel.
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && panel.style.display !== 'none') close();
  });
}
