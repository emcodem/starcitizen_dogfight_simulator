import './style.css';

import { SHIP_TYPES } from './ship/shipTypes';
import { makeShip, resetShip } from './ship/shipState';
import { step } from './physics/step';
import { render } from './render/render';
import { initStartupModal } from './ui/startupModal';
import { initFullscreenGuard } from './ui/fullscreenGuard';
import { initTouchControls } from './ui/touchControls';
import { initMouseCapture, initKeyboardFireFallback } from './ui/mouseCapture';
import { initControlsPanel } from './ui/controlsPanel';
import { initModeToggle } from './ui/modeToggle';
import { initScenarioMenu, showScenarioResult } from './ui/scenarioMenu';
import { startScenario, updateScenario } from './scenarios/runtime';
import type { ScenarioConfig, ScenarioRuntime } from './scenarios/types';
import { setStationActive } from './world/station';

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

// ---------- Scenario / menu state machine — sim only runs while 'playing' ----------
type Mode = 'menu' | 'playing';
let mode: Mode = 'menu';
let activeRuntime: ScenarioRuntime | null = null;

function startRun(config: ScenarioConfig | null): void {
  resetShip(ship);
  setStationActive(config ? config.includeStation : true);
  activeRuntime = config ? startScenario(config, ship) : null;
  if (!config) ship.health = undefined; // clear any leftover health from a prior scenario run
  mode = 'playing';
}

initScenarioMenu({
  startFreeFlight: () => startRun(null),
  startScenario: config => startRun(config),
  onOpenMenu: () => { mode = 'menu'; }
});

// ---------- Main loop ----------
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (mode === 'playing') {
      step(ship, dt);
      if (activeRuntime) {
        updateScenario(activeRuntime, ship, dt);
        if (activeRuntime.outcome !== 'active') {
          mode = 'menu';
          showScenarioResult(activeRuntime.outcome, activeRuntime.config);
        }
      }
      render(ship, activeRuntime);
    }
  } catch (err) {
    console.error('Frame error (continuing):', err);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
