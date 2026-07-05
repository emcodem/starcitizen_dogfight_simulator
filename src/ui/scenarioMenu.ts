import {
  SCENARIOS, buildAimTrainingScenario, AIM_TRAINING_DEFAULTS,
  buildMergeDrillScenario, MERGE_DRILL_DEFAULTS
} from '../scenarios/definitions';
import type { AimTrainingOptions, MergeDrillOptions } from '../scenarios/definitions';
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

// Persisted in localStorage so a player's tuned drill settings survive a page reload, not just
// menu open/close.
const AIM_TRAINING_STORAGE_KEY = 'vector_aim_training_options';

function loadAimTrainingOptions(): AimTrainingOptions {
  try {
    const raw = localStorage.getItem(AIM_TRAINING_STORAGE_KEY);
    if (!raw) return { ...AIM_TRAINING_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      droneCount: typeof parsed.droneCount === 'number' ? parsed.droneCount : AIM_TRAINING_DEFAULTS.droneCount,
      aggressiveness: typeof parsed.aggressiveness === 'number' ? parsed.aggressiveness : AIM_TRAINING_DEFAULTS.aggressiveness,
      durationSec: typeof parsed.durationSec === 'number' || parsed.durationSec === null
        ? parsed.durationSec : AIM_TRAINING_DEFAULTS.durationSec
    };
  } catch {
    return { ...AIM_TRAINING_DEFAULTS }; // localStorage unavailable (e.g. private browsing) or corrupt data
  }
}

function saveAimTrainingOptions(): void {
  try { localStorage.setItem(AIM_TRAINING_STORAGE_KEY, JSON.stringify(aimTrainingOptions)); }
  catch { /* localStorage can be unavailable (e.g. private browsing) — non-fatal */ }
}

const aimTrainingOptions: AimTrainingOptions = loadAimTrainingOptions();

const MERGE_DRILL_STORAGE_KEY = 'vector_merge_drill_options';

function loadMergeDrillOptions(): MergeDrillOptions {
  try {
    const raw = localStorage.getItem(MERGE_DRILL_STORAGE_KEY);
    if (!raw) return { ...MERGE_DRILL_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      rangeBubbleRadius: typeof parsed.rangeBubbleRadius === 'number'
        ? parsed.rangeBubbleRadius : MERGE_DRILL_DEFAULTS.rangeBubbleRadius
    };
  } catch {
    return { ...MERGE_DRILL_DEFAULTS }; // localStorage unavailable (e.g. private browsing) or corrupt data
  }
}

function saveMergeDrillOptions(): void {
  try { localStorage.setItem(MERGE_DRILL_STORAGE_KEY, JSON.stringify(mergeDrillOptions)); }
  catch { /* localStorage can be unavailable (e.g. private browsing) — non-fatal */ }
}

const mergeDrillOptions: MergeDrillOptions = loadMergeDrillOptions();

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
    'Drones', aimTrainingOptions.droneCount, 2, 100, 2,
    v => `${v}`,
    v => { aimTrainingOptions.droneCount = v; saveAimTrainingOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Aggressiveness', Math.round(aimTrainingOptions.aggressiveness * 9) + 1, 1, 10, 1,
    v => `${v}/10`,
    v => { aimTrainingOptions.aggressiveness = (v - 1) / 9; saveAimTrainingOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Duration', aimTrainingOptions.durationSec === null ? 11 : Math.round(aimTrainingOptions.durationSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { aimTrainingOptions.durationSec = v >= 11 ? null : v * 60; saveAimTrainingOptions(); }
  ));

  return wrap;
}

// descEl's text is kept in sync with the slider so the card's stated bubble size never drifts
// from the value it'll actually be started with (the description text embeds the meter figure).
function buildMergeDrillControls(descEl: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Bubble Size', mergeDrillOptions.rangeBubbleRadius, 10, 1000, 10,
    v => `${v}m`,
    v => {
      mergeDrillOptions.rangeBubbleRadius = v;
      saveMergeDrillOptions();
      descEl.textContent = buildMergeDrillScenario(mergeDrillOptions).description;
    }
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
    const isMergeDrill = config.id === 'merge-drill';
    // merge-drill's description embeds the configured bubble radius, so it's rebuilt from the
    // player's saved options rather than using the default-built SCENARIOS entry as-is.
    const displayConfig = isMergeDrill ? buildMergeDrillScenario(mergeDrillOptions) : config;
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.innerHTML = `<h3>${displayConfig.name}</h3><p>${displayConfig.description}</p>`;
    if (isAimTraining) card.appendChild(buildAimTrainingControls());
    if (isMergeDrill) card.appendChild(buildMergeDrillControls(card.querySelector('p') as HTMLElement));
    const btn = document.createElement('button');
    btn.textContent = 'START';
    btn.addEventListener('click', () => {
      overlay.style.display = 'none';
      handlers.startScenario(
        isAimTraining ? buildAimTrainingScenario(aimTrainingOptions)
          : isMergeDrill ? buildMergeDrillScenario(mergeDrillOptions)
          : config
      );
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
  stats?: { shotsFired: number; hitsLanded: number; kills: number },
  bubbleTicks?: number // Merge Drill's "100ms ticks spent in range" count — see scenarios/runtime.ts
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
  if (config.rangeBubbleRadius !== undefined && bubbleTicks !== undefined) {
    detail += ` In range: ${bubbleTicks} (${(bubbleTicks / 10).toFixed(1)}s).`;
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
