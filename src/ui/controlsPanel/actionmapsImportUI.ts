import * as ControlsModule from '../../input/controlsModule';
import * as GamepadModule from '../../input/gamepadModule';
import { setScDevices, setAxisMap } from '../../input/deviceState';
import { renderGamepads } from './joystickDetectionUI';
import { renderBindings } from './bindingsTableUI';

export function initActionmapsImportUI(): void {
  const importStatus = document.getElementById('ctrl-import-status') as HTMLElement;
  const importResults = document.getElementById('ctrl-import-results') as HTMLElement;
  const scDevicesList = document.getElementById('ctrl-sc-devices-list') as HTMLElement;

  document.getElementById('ctrl-copy-path-btn')!.addEventListener('click', async () => {
    const pathInput = document.getElementById('ctrl-default-path') as HTMLInputElement;
    pathInput.select();
    try {
      await navigator.clipboard.writeText(pathInput.value);
      importStatus.textContent = 'Path copied — paste into the file dialog\'s address bar (Ctrl+L, then paste, then Enter).';
    } catch {
      document.execCommand('copy'); // fallback for contexts without Clipboard API permission
      importStatus.textContent = 'Path copied to clipboard (fallback method).';
    }
  });

  const fileInput = document.getElementById('ctrl-file-input') as HTMLInputElement;
  document.getElementById('ctrl-import-actionmaps-btn')!.addEventListener('click', () => {
    fileInput.click();
  });
  fileInput.addEventListener('change', e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed = ControlsModule.parseActionMapsXML(text);
        const { overrides, matched, notFound } = ControlsModule.buildOverridesFromParsed(parsed);
        ControlsModule.applyOverrides(overrides);
        const labels = ControlsModule.getActionLabels();
        const matchedHtml = matched.map(m =>
          `<div class="ctrl-found">✓ ${labels[m.simAction]} ← ${m.scName} (${m.chords.map(ControlsModule.chordToLabel).join(' / ')})</div>`
        ).join('');
        const notFoundHtml = notFound.map(nf =>
          `<div class="ctrl-missing">– ${labels[nf.simAction]}: not found in file, kept current</div>`
        ).join('');
        importResults.innerHTML = matchedHtml + notFoundHtml;
        const usesCtrl = matched.some(m => m.chords.some(chord => chord.includes('ControlLeft') || chord.includes('ControlRight')));
        importStatus.textContent = `Applied ${matched.length} of ${matched.length + notFound.length} bindings from "${file.name}".`
          + (usesCtrl ? ' Note: Ctrl is bound to an action, but is disabled outside fullscreen by default — enter fullscreen to use it.' : '');

        // also pull the joystick device list and axis bindings out of the same file —
        // done before renderBindings() so its Joystick column reflects this file, not a stale one
        try {
          setScDevices(ControlsModule.parseJoystickDevices(text));
          const axisRaw = ControlsModule.parseJoystickAxisBindings(text);
          setAxisMap(ControlsModule.buildAxisMap(axisRaw));
          GamepadModule.poll();
          renderGamepads();
        } catch {
          scDevicesList.innerHTML = '(could not read device list from this file)';
        }
        renderBindings();
      } catch (err) {
        importStatus.textContent = 'Import failed: ' + (err as Error).message;
        importResults.innerHTML = '';
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });
}
