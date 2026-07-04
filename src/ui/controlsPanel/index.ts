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
  const panel = document.getElementById('ctrl-panel') as HTMLElement;
  toggleBtn.addEventListener('click', () => {
    const opening = panel.style.display === 'none';
    panel.style.display = opening ? 'block' : 'none';
    if (opening) { renderBindings(); refreshPresetList(); }
  });
}
