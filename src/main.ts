import './style.css';

import { SHIP_TYPES } from './ship/shipTypes';
import { makeShip, resetShip } from './ship/shipState';
import { step } from './physics/step';
import { render } from './render/render';
import { initStartupModal } from './ui/startupModal';
import { initFullscreenGuard } from './ui/fullscreenGuard';
import { initTouchControls } from './ui/touchControls';
import { initMouseCapture } from './ui/mouseCapture';
import { initControlsPanel } from './ui/controlsPanel';
import { initModeToggle } from './ui/modeToggle';
import { initEspSettingsUI } from './ui/espSettingsUI';
import { initScenarioMenu, showScenarioResult, showPipTrainerResult } from './ui/scenarioMenu';
import { startScenario, updateScenario, bubbleTicks } from './scenarios/runtime';
import type { ScenarioConfig, ScenarioRuntime } from './scenarios/types';
import { startPipTrainer, updatePipTrainer } from './combat/pipTrainer';
import type { PipTrainerOptions, PipTrainerState } from './combat/pipTrainer';
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
initControlsPanel();
initModeToggle(ship);
initEspSettingsUI();

// ---------- Scenario / menu state machine — sim only runs while 'playing' ----------
type Mode = 'menu' | 'playing';
let mode: Mode = 'menu';
let activeRuntime: ScenarioRuntime | null = null;
let activePipTrainer: { state: PipTrainerState; opts: PipTrainerOptions } | null = null;

// Whatever launched the current run — used by restartRun (F1) to relaunch the same thing, since
// a scenario, the PIP Trainer, and free flight each need a different restart call.
type Launch =
  | { kind: 'freeflight' }
  | { kind: 'scenario'; config: ScenarioConfig }
  | { kind: 'pipTrainer'; opts: PipTrainerOptions };
let lastLaunch: Launch = { kind: 'freeflight' };

function startRun(config: ScenarioConfig | null): void {
  lastLaunch = config ? { kind: 'scenario', config } : { kind: 'freeflight' };
  resetShip(ship);
  setStationActive(config ? config.includeStation : true);
  activeRuntime = config ? startScenario(config, ship) : null;
  activePipTrainer = null;
  if (!config) ship.health = undefined; // clear any leftover health from a prior scenario run
  mode = 'playing';
}

function startPipTrainerRun(opts: PipTrainerOptions): void {
  lastLaunch = { kind: 'pipTrainer', opts };
  resetShip(ship);
  setStationActive(false); // pure aim-tracking airspace, nothing to collide with
  activeRuntime = null;
  ship.health = undefined; // no combat/lose-state involved — see combat/pipTrainer.ts
  activePipTrainer = { state: startPipTrainer(ship), opts };
  mode = 'playing';
}

initScenarioMenu({
  startFreeFlight: () => startRun(null),
  startScenario: config => startRun(config),
  startPipTrainer: opts => startPipTrainerRun(opts),
  onOpenMenu: () => { mode = 'menu'; }
});

// ---------- F1 / on-screen button — instant restart of whatever's currently running ----------
function restartRun(): void {
  if (mode !== 'playing') return; // nothing live to restart (menu/results screen is open)
  if (lastLaunch.kind === 'scenario') startRun(lastLaunch.config);
  else if (lastLaunch.kind === 'pipTrainer') startPipTrainerRun(lastLaunch.opts);
  else startRun(null);
}
(document.getElementById('restart-toggle') as HTMLElement).addEventListener('click', restartRun);
window.addEventListener('keydown', e => {
  if (e.code !== 'F1') return;
  e.preventDefault(); // browsers otherwise open help on F1
  restartRun();
});

// ---------- Main loop ----------
let last = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  try {
    if (mode === 'playing') {
      step(ship, dt, activeRuntime, activePipTrainer?.state ?? null);
      if (activeRuntime) {
        updateScenario(activeRuntime, ship, dt);
        if (activeRuntime.outcome !== 'active') {
          mode = 'menu';
          showScenarioResult(
            activeRuntime.outcome, activeRuntime.config, activeRuntime.failReason,
            activeRuntime.stats, bubbleTicks(activeRuntime)
          );
        }
      } else if (activePipTrainer) {
        updatePipTrainer(activePipTrainer.state, activePipTrainer.opts, ship, dt);
        if (activePipTrainer.state.outcome !== 'active') {
          mode = 'menu';
          showPipTrainerResult(activePipTrainer.state, activePipTrainer.opts);
        }
      }
      render(ship, activeRuntime, activePipTrainer);
    }
  } catch (err) {
    console.error('Frame error (continuing):', err);
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
