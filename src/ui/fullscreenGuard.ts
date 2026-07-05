import type { Ship } from '../types';
import { keys, chordJustPressed } from '../input/controlsModule';

// Keyboard Lock API — Chromium-only, experimental, not in lib.dom.d.ts.
declare global {
  interface Navigator {
    keyboard?: {
      lock(codes: string[]): Promise<void>;
      unlock(): void;
    };
  }
}

// Games keys whose default browser action (page scroll etc.) we suppress — but note this
// can NOT block certain reserved combos like Ctrl+W/T/N/Q, which browsers deliberately
// don't let any page override. That's why Ctrl isn't a default binding here: holding it
// alongside another game key risks triggering one of those unblockable shortcuts.
const GAME_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC', 'KeyX', 'KeyV',
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft'];

let ctrlFlashTimeout: ReturnType<typeof setTimeout> | null = null;
function flashCtrlDisabledWarning(): void {
  const el = document.getElementById('ctrl-flash-warning') as HTMLElement;
  el.style.opacity = '1';
  if (ctrlFlashTimeout) clearTimeout(ctrlFlashTimeout);
  ctrlFlashTimeout = setTimeout(() => { el.style.opacity = '0'; }, 700);
}

export function initFullscreenGuard(ship: Ship): void {
  // ---------- Core keyboard input: populates `keys`, plus the Ctrl-disabled-outside-fullscreen guard ----------
  window.addEventListener('keydown', e => {
    const isCtrlCode = e.code === 'ControlLeft' || e.code === 'ControlRight';
    const inFullscreen = !!document.fullscreenElement;

    // Ctrl is disabled outside fullscreen — see the startup notice. Browsers won't let
    // any page block Ctrl+W (close tab) or Ctrl+Q (quit), so the only real protection
    // is to not let Ctrl register as game input until fullscreen (+ Keyboard Lock,
    // where supported) is actually engaged.
    if (isCtrlCode && !inFullscreen) {
      e.preventDefault();
      if (!e.repeat) flashCtrlDisabledWarning();
      return;
    }

    // Outside fullscreen Ctrl isn't bound to any game action, so a Ctrl/Cmd-held combo
    // (Ctrl+C, Ctrl+V, Ctrl+A, etc.) is standard browser behavior, not game input —
    // leave it completely alone rather than letting the gameCodes preventDefault below
    // swallow it. In fullscreen, Ctrl IS a bound game key (strafeDown default), so
    // Ctrl+W-style combos must keep working as game input there — don't skip.
    if ((e.ctrlKey || e.metaKey) && !isCtrlCode && !inFullscreen) return;

    keys[e.code] = true;
    if (!e.repeat && chordJustPressed('decoupleToggle', e.code)) {
      ship.decoupled = !ship.decoupled;
    }
    // space brake is hold-to-brake (see physics/step.ts), not a toggle — nothing to do here

    const target = e.target as HTMLElement | null;
    const isEditable = !!target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (!isEditable && GAME_CODES.includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  // ---------- Fullscreen + Keyboard Lock (protects Ctrl+W/Q where supported) ----------
  const hint = document.getElementById('fullscreen-hint') as HTMLElement;
  const dangerHint = document.getElementById('ctrl-danger-hint') as HTMLElement;
  const toggleBtn = document.getElementById('fullscreen-toggle') as HTMLElement;
  const keyboardLockSupported = !!(navigator.keyboard && navigator.keyboard.lock);

  async function enterProtectedFullscreen(): Promise<void> {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      hint.textContent = '⛶ Fullscreen unavailable here (blocked by browser/embed)';
      return;
    }
    if (keyboardLockSupported) {
      try {
        await navigator.keyboard!.lock(['ControlLeft', 'ControlRight', 'KeyW', 'KeyQ']);
      } catch (err) {
        console.warn('Keyboard lock failed:', err);
      }
    }
  }

  document.addEventListener('fullscreenchange', () => {
    const inFullscreen = !!document.fullscreenElement;
    toggleBtn.textContent = inFullscreen ? '⛶ EXIT FULLSCREEN' : '⛶ FULLSCREEN';
    toggleBtn.classList.toggle('on', inFullscreen);
    if (inFullscreen && keyboardLockSupported) {
      hint.textContent = '✓ Ctrl+W/Q protected — Esc to exit fullscreen';
      dangerHint.style.display = 'none';
    } else if (inFullscreen && !keyboardLockSupported) {
      hint.textContent = 'Fullscreen on, but this browser has no Keyboard Lock API — still avoid Ctrl+W/Q';
    } else {
      hint.textContent = '⛶ Enter fullscreen to protect Ctrl+W/Q (Chrome/Edge only)';
      dangerHint.style.display = '';
      if (navigator.keyboard && navigator.keyboard.unlock) {
        try { navigator.keyboard.unlock(); } catch { /* ignore */ }
      }
    }
  });

  if (!keyboardLockSupported) {
    hint.textContent = '⛶ Fullscreen available, but Keyboard Lock needs Chrome/Edge — still avoid Ctrl+W/Q';
  }
  hint.addEventListener('click', enterProtectedFullscreen);

  toggleBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      enterProtectedFullscreen();
    }
  });
}
