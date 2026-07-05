import * as EspAssist from '../combat/espAssist';
import { onConfigApplied } from '../input/configRegistry';

function syncEspSettingsUI(): void {
  const sizeSlider = document.getElementById('ctrl-esp-circle-size') as HTMLInputElement | null;
  if (sizeSlider) sizeSlider.value = String(EspAssist.getCircleRadius());

  const dampeningSlider = document.getElementById('ctrl-esp-dampening') as HTMLInputElement | null;
  if (dampeningSlider) dampeningSlider.value = String(EspAssist.getDampeningStrength());
}

// Keeps the sliders in sync whenever a control preset is loaded/imported/restored, without the
// preset UI needing to know ESP settings exist — same pattern as ui/mouseCapture.ts.
onConfigApplied(syncEspSettingsUI);

export function initEspSettingsUI(): void {
  syncEspSettingsUI();

  const sizeSlider = document.getElementById('ctrl-esp-circle-size') as HTMLInputElement;
  sizeSlider.addEventListener('input', e => EspAssist.setCircleRadius(parseFloat((e.target as HTMLInputElement).value)));

  const dampeningSlider = document.getElementById('ctrl-esp-dampening') as HTMLInputElement;
  dampeningSlider.addEventListener('input', e => EspAssist.setDampeningStrength(parseFloat((e.target as HTMLInputElement).value)));
}
