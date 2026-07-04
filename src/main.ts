import './style.css';

import { SHIP_TYPES } from './ship/shipTypes';
import { makeShip } from './ship/shipState';
import { step } from './physics/step';
import { render } from './render/render';
import { initStartupModal } from './ui/startupModal';
import { initFullscreenGuard } from './ui/fullscreenGuard';
import { initTouchControls } from './ui/touchControls';
import { initMouseCapture, initKeyboardFireFallback } from './ui/mouseCapture';
import { initControlsPanel } from './ui/controlsPanel';
import { initModeToggle } from './ui/modeToggle';

const canvas = document.getElementById('c') as HTMLCanvasElement;
function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

initStartupModal();

const ship = makeShip(SHIP_TYPES[0]);

initFullscreenGuard(ship);
initTouchControls(ship);
initMouseCapture();
initKeyboardFireFallback();
initControlsPanel();
initModeToggle(ship);

// ---------- Main loop ----------
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    step(ship, dt);
    render(ship);
  } catch (err) {
    console.error('Frame error (continuing):', err);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
