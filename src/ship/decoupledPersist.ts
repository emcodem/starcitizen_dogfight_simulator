import type { Ship } from '../types';

// Every input source that flips decoupled mode (HUD click, keybind, touch button) routes
// through here so the choice persists across page loads regardless of which one was used.
const STORAGE_KEY = 'vector_decoupled';

export function loadDecoupled(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; } // localStorage can be unavailable (e.g. private browsing)
}

export function toggleDecoupled(ship: Ship): void {
  ship.decoupled = !ship.decoupled;
  try { localStorage.setItem(STORAGE_KEY, ship.decoupled ? '1' : '0'); }
  catch { /* localStorage can be unavailable (e.g. private browsing) — non-fatal */ }
}
