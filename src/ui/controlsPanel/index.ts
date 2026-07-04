import { initBindingsTableUI, renderBindings } from './bindingsTableUI';
import { initPresetsUI, refreshPresetList } from './presetsUI';
import { initActionmapsImportUI } from './actionmapsImportUI';
import { initJoystickDetectionUI } from './joystickDetectionUI';

export function initControlsPanel(): void {
  initBindingsTableUI();
  initPresetsUI();
  initActionmapsImportUI();
  initJoystickDetectionUI();

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

  toggleBtn.addEventListener('click', () => {
    if (panel.style.display === 'none') open(); else close();
  });
  closeBtn.addEventListener('click', close);

  // Escape closes the panel — but a pending keyboard/axis/button rebind capture (see
  // bindingsTableUI) consumes Escape first via stopPropagation, so this only fires once
  // nothing is mid-capture: first Escape cancels a capture, a second Escape closes the panel.
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && panel.style.display !== 'none') close();
  });
}
