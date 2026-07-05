import { SCENARIOS, buildAimTrainingScenario, AIM_TRAINING_DEFAULTS } from '../scenarios/definitions';
import type { AimTrainingOptions } from '../scenarios/definitions';
import type { ScenarioConfig } from '../scenarios/types';

export interface ScenarioMenuHandlers {
  startScenario(config: ScenarioConfig): void;
  startFreeFlight(): void;
  onOpenMenu(): void;
}

let overlay: HTMLElement;
let picker: HTMLElement;
let list: HTMLElement;
let resultEl: HTMLElement;
let handlers: ScenarioMenuHandlers;

// Persists across menu open/close (but not page reload) so re-opening the menu doesn't reset a
// drill the player already tuned.
const aimTrainingOptions: AimTrainingOptions = { ...AIM_TRAINING_DEFAULTS };

function sliderRow(
  label: string, initial: number, min: number, max: number, step: number,
  format: (v: number) => string, onChange: (v: number) => void
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'scenario-slider-row';

  const top = document.createElement('div');
  top.className = 'scenario-slider-top';
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const valueEl = document.createElement('span');
  valueEl.className = 'scenario-slider-value';
  valueEl.textContent = format(initial);
  top.appendChild(labelEl);
  top.appendChild(valueEl);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueEl.textContent = format(v);
    onChange(v);
  });
  // Dragging a slider shouldn't also drag/click through to whatever's under the card.
  input.addEventListener('click', e => e.stopPropagation());

  row.appendChild(top);
  row.appendChild(input);
  return row;
}

function buildAimTrainingControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Drones', aimTrainingOptions.droneCount, 2, 20, 2,
    v => `${v}`,
    v => { aimTrainingOptions.droneCount = v; }
  ));
  wrap.appendChild(sliderRow(
    'Aggressiveness', Math.round(aimTrainingOptions.aggressiveness * 9) + 1, 1, 10, 1,
    v => `${v}/10`,
    v => { aimTrainingOptions.aggressiveness = (v - 1) / 9; }
  ));
  wrap.appendChild(sliderRow(
    'Duration', aimTrainingOptions.durationSec === null ? 11 : Math.round(aimTrainingOptions.durationSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { aimTrainingOptions.durationSec = v >= 11 ? null : v * 60; }
  ));

  return wrap;
}

function renderList(): void {
  list.innerHTML = '';

  const freeFlightCard = document.createElement('div');
  freeFlightCard.className = 'scenario-card';
  freeFlightCard.innerHTML = '<h3>Free Flight</h3><p>No opponents — open sandbox flying.</p>';
  const freeBtn = document.createElement('button');
  freeBtn.textContent = 'START';
  freeBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    handlers.startFreeFlight();
  });
  freeFlightCard.appendChild(freeBtn);
  list.appendChild(freeFlightCard);

  for (const config of SCENARIOS) {
    const isAimTraining = config.id === 'aim-training';
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.innerHTML = `<h3>${config.name}</h3><p>${config.description}</p>`;
    if (isAimTraining) card.appendChild(buildAimTrainingControls());
    const btn = document.createElement('button');
    btn.textContent = 'START';
    btn.addEventListener('click', () => {
      overlay.style.display = 'none';
      handlers.startScenario(isAimTraining ? buildAimTrainingScenario(aimTrainingOptions) : config);
    });
    card.appendChild(btn);
    list.appendChild(card);
  }
}

function showPicker(): void {
  picker.style.display = 'block';
  resultEl.style.display = 'none';
  resultEl.className = '';
  renderList();
  overlay.style.display = 'flex';
}

function openMenu(): void {
  handlers.onOpenMenu();
  showPicker();
}

export function initScenarioMenu(h: ScenarioMenuHandlers): void {
  handlers = h;
  overlay = document.getElementById('scenario-menu-overlay') as HTMLElement;
  picker = document.getElementById('scenario-menu-picker') as HTMLElement;
  list = document.getElementById('scenario-menu-list') as HTMLElement;
  resultEl = document.getElementById('scenario-menu-result') as HTMLElement;

  const toggleBtn = document.getElementById('scenario-menu-toggle') as HTMLElement;
  toggleBtn.addEventListener('click', openMenu);

  showPicker();
}

export function showScenarioResult(
  outcome: 'won' | 'lost',
  config: ScenarioConfig,
  failReason?: 'died' | 'missedGate' | 'timeout',
  stats?: { shotsFired: number; hitsLanded: number; kills: number }
): void {
  picker.style.display = 'none';
  resultEl.style.display = 'block';
  resultEl.className = outcome;

  const isGates = config.winCondition === 'gates';
  const isSurvive = config.winCondition === 'survive';
  let title: string;
  let detail: string;
  if (outcome === 'won') {
    title = isGates ? 'MANEUVER COMPLETE' : isSurvive ? 'DRILL COMPLETE' : 'TARGET DESTROYED';
    detail = `${config.name} — training complete.`;
  } else if (failReason === 'missedGate') {
    title = 'GATE MISSED';
    detail = `${config.name} — flew past a gate outside its ring.`;
  } else if (failReason === 'timeout') {
    title = 'TIME EXPIRED';
    detail = `${config.name} — didn't clear the course in time.`;
  } else {
    title = 'YOU WERE DESTROYED';
    detail = `${config.name} — you took ${config.hitsToKillPlayer} hits.`;
  }
  if (stats && stats.shotsFired > 0) {
    const accuracy = Math.round((stats.hitsLanded / stats.shotsFired) * 100);
    detail += ` Accuracy: ${accuracy}% (${stats.hitsLanded}/${stats.shotsFired}).`;
    if (isSurvive) detail += ` Kills: ${stats.kills}.`;
  }
  resultEl.innerHTML = `<h2>${title}</h2><p style="color:var(--hud-dim)">${detail}</p>`;

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'RETRY';
  retryBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    handlers.startScenario(config);
  });
  const menuBtn = document.createElement('button');
  menuBtn.textContent = 'BACK TO MENU';
  menuBtn.addEventListener('click', showPicker);

  resultEl.appendChild(retryBtn);
  resultEl.appendChild(menuBtn);
  overlay.style.display = 'flex';
}
