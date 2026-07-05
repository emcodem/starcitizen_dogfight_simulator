import type { Ship } from '../types';
import { loadDecoupled, toggleDecoupled } from '../ship/decoupledPersist';

// The COUPLED/DECOUPLED HUD row (in the stats panel) doubles as a click target — same
// effect as the decoupleToggle keybind (default: C), for players who'd rather click than
// remember a key.
export function initModeToggle(ship: Ship): void {
  ship.decoupled = loadDecoupled();
  document.getElementById('mode-flag')!.addEventListener('click', () => toggleDecoupled(ship));
}
