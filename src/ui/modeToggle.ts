import type { Ship } from '../types';

// The COUPLED/DECOUPLED HUD flag doubles as a click target — same effect as the
// decoupleToggle keybind (default: C), for players who'd rather click than remember a key.
export function initModeToggle(ship: Ship): void {
  document.getElementById('mode-flag')!.addEventListener('click', () => {
    ship.decoupled = !ship.decoupled;
  });
}
