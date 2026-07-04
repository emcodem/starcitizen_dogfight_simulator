import * as ControlsModule from '../../input/controlsModule';
import { renderBindings } from './bindingsTableUI';

const presetNameInput = document.getElementById('ctrl-preset-name') as HTMLInputElement;
const presetSelect = document.getElementById('ctrl-preset-list') as HTMLSelectElement;
const presetStatus = document.getElementById('ctrl-preset-status') as HTMLElement;
const presetFileStatus = document.getElementById('ctrl-preset-file-status') as HTMLElement;

export async function refreshPresetList(): Promise<void> {
  if (!ControlsModule.hasArtifactStorage) {
    presetSelect.innerHTML = '';
    presetStatus.textContent = 'Browser preset storage unavailable here — use export/import file instead.';
    return;
  }
  try {
    const names = await ControlsModule.listPresets();
    presetSelect.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
  } catch (err) {
    presetStatus.textContent = 'Could not list presets: ' + (err as Error).message;
  }
}

export function initPresetsUI(): void {
  document.getElementById('ctrl-save-preset-btn')!.addEventListener('click', async () => {
    const name = presetNameInput.value.trim();
    if (!name) { presetStatus.textContent = 'Enter a preset name first.'; return; }
    try {
      await ControlsModule.savePreset(name);
      presetStatus.textContent = `Saved preset "${name}".`;
      refreshPresetList();
    } catch (err) {
      presetStatus.textContent = (err as Error).message === 'no-storage'
        ? 'Browser preset storage unavailable here — use export/import file instead.'
        : 'Save failed: ' + (err as Error).message;
    }
  });

  document.getElementById('ctrl-load-preset-btn')!.addEventListener('click', async () => {
    const name = presetSelect.value;
    if (!name) { presetStatus.textContent = 'Select a preset first.'; return; }
    try {
      await ControlsModule.loadPreset(name);
      presetStatus.textContent = `Loaded preset "${name}".`;
      renderBindings();
    } catch (err) {
      presetStatus.textContent = 'Load failed: ' + (err as Error).message;
    }
  });

  document.getElementById('ctrl-delete-preset-btn')!.addEventListener('click', async () => {
    const name = presetSelect.value;
    if (!name) { presetStatus.textContent = 'Select a preset first.'; return; }
    try {
      await ControlsModule.deletePreset(name);
      presetStatus.textContent = `Deleted preset "${name}".`;
      refreshPresetList();
    } catch (err) {
      presetStatus.textContent = 'Delete failed: ' + (err as Error).message;
    }
  });

  document.getElementById('ctrl-export-btn')!.addEventListener('click', () => {
    const name = presetNameInput.value.trim() || 'control-preset';
    ControlsModule.exportToFile(name);
    presetFileStatus.textContent = `Exported "${name}.json".`;
  });

  document.getElementById('ctrl-import-preset-btn')!.addEventListener('click', () => {
    (document.getElementById('ctrl-import-preset-input') as HTMLInputElement).click();
  });

  const importInput = document.getElementById('ctrl-import-preset-input') as HTMLInputElement;
  importInput.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        ControlsModule.importFromFileText(reader.result as string);
        presetFileStatus.textContent = `Imported preset from "${file.name}".`;
        renderBindings();
      } catch {
        presetFileStatus.textContent = 'Import failed: file is not a valid preset.';
      }
    };
    reader.readAsText(file);
    importInput.value = '';
  });
}
