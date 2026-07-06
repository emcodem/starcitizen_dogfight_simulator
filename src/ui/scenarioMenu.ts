import {
  SCENARIOS, buildAimTrainingScenario, AIM_TRAINING_DEFAULTS,
  buildMergeDrillScenario, MERGE_DRILL_DEFAULTS,
  buildEvasivePilotScenario, EVASIVE_PILOT_DEFAULTS
} from '../scenarios/definitions';
import type { AimTrainingOptions, MergeDrillOptions, EvasivePilotOptions } from '../scenarios/definitions';
import type { ScenarioConfig } from '../scenarios/types';
import { PIP_TRAINER_DEFAULTS } from '../combat/pipTrainer';
import type { PipTrainerOptions, PipTrainerState } from '../combat/pipTrainer';

export interface ScenarioMenuHandlers {
  startScenario(config: ScenarioConfig): void;
  startFreeFlight(): void;
  startPipTrainer(opts: PipTrainerOptions): void;
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

const EVASIVE_PILOT_STORAGE_KEY = 'vector_evasive_pilot_options';

function loadEvasivePilotOptions(): EvasivePilotOptions {
  try {
    const raw = localStorage.getItem(EVASIVE_PILOT_STORAGE_KEY);
    if (!raw) return { ...EVASIVE_PILOT_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      returnFire: typeof parsed.returnFire === 'boolean' ? parsed.returnFire : EVASIVE_PILOT_DEFAULTS.returnFire,
      durationSec: typeof parsed.durationSec === 'number' || parsed.durationSec === null
        ? parsed.durationSec : EVASIVE_PILOT_DEFAULTS.durationSec
    };
  } catch {
    return { ...EVASIVE_PILOT_DEFAULTS }; // localStorage unavailable (e.g. private browsing) or corrupt data
  }
}

function saveEvasivePilotOptions(): void {
  try { localStorage.setItem(EVASIVE_PILOT_STORAGE_KEY, JSON.stringify(evasivePilotOptions)); }
  catch { /* localStorage can be unavailable (e.g. private browsing) — non-fatal */ }
}

const evasivePilotOptions: EvasivePilotOptions = loadEvasivePilotOptions();

const PIP_TRAINER_STORAGE_KEY = 'vector_pip_trainer_options';

function loadPipTrainerOptions(): PipTrainerOptions {
  try {
    const raw = localStorage.getItem(PIP_TRAINER_STORAGE_KEY);
    if (!raw) return { ...PIP_TRAINER_DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      speed: typeof parsed.speed === 'number' ? parsed.speed : PIP_TRAINER_DEFAULTS.speed,
      randomness: typeof parsed.randomness === 'number' ? parsed.randomness : PIP_TRAINER_DEFAULTS.randomness,
      holdDurationSec: typeof parsed.holdDurationSec === 'number' ? parsed.holdDurationSec : PIP_TRAINER_DEFAULTS.holdDurationSec,
      avoidDegrees: typeof parsed.avoidDegrees === 'number' ? parsed.avoidDegrees : PIP_TRAINER_DEFAULTS.avoidDegrees,
      durationSec: typeof parsed.durationSec === 'number' || parsed.durationSec === null
        ? parsed.durationSec : PIP_TRAINER_DEFAULTS.durationSec
    };
  } catch {
    return { ...PIP_TRAINER_DEFAULTS }; // localStorage unavailable (e.g. private browsing) or corrupt data
  }
}

function savePipTrainerOptions(): void {
  try { localStorage.setItem(PIP_TRAINER_STORAGE_KEY, JSON.stringify(pipTrainerOptions)); }
  catch { /* localStorage can be unavailable (e.g. private browsing) — non-fatal */ }
}

const pipTrainerOptions: PipTrainerOptions = loadPipTrainerOptions();

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

function checkboxRow(label: string, initial: boolean, onChange: (v: boolean) => void): HTMLElement {
  const row = document.createElement('label');
  row.className = 'scenario-checkbox-row';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;
  input.addEventListener('change', () => onChange(input.checked));
  // Toggling shouldn't also click/drag through to whatever's under the card.
  input.addEventListener('click', e => e.stopPropagation());

  const labelEl = document.createElement('span');
  labelEl.textContent = label;

  row.appendChild(input);
  row.appendChild(labelEl);
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

// descEl's text is kept in sync with the return-fire checkbox so the card's stated behavior never
// drifts from what it'll actually be started with (same convention as buildMergeDrillControls).
function buildEvasivePilotControls(descEl: HTMLElement): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Duration', evasivePilotOptions.durationSec === null ? 11 : Math.round(evasivePilotOptions.durationSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { evasivePilotOptions.durationSec = v >= 11 ? null : v * 60; saveEvasivePilotOptions(); }
  ));
  wrap.appendChild(checkboxRow(
    'Return fire', evasivePilotOptions.returnFire,
    v => {
      evasivePilotOptions.returnFire = v;
      saveEvasivePilotOptions();
      descEl.textContent = buildEvasivePilotScenario(evasivePilotOptions).description;
    }
  ));

  return wrap;
}

// Speed/Randomness/Hold Time/Duration knobs for the PIP Trainer card — see combat/pipTrainer.ts.
function buildPipTrainerControls(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'scenario-slider-block';

  wrap.appendChild(sliderRow(
    'Speed', pipTrainerOptions.speed, 20, 400, 5,
    v => `${v} m/s`,
    v => { pipTrainerOptions.speed = v; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Randomness', Math.round(pipTrainerOptions.randomness * 9) + 1, 1, 10, 1,
    v => `${v}/10`,
    v => { pipTrainerOptions.randomness = (v - 1) / 9; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Hold Time', Math.round(pipTrainerOptions.holdDurationSec * 1000), 1, 2000, 1,
    v => v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${v}ms`,
    v => { pipTrainerOptions.holdDurationSec = v / 1000; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Avoid Radius', pipTrainerOptions.avoidDegrees, 0, 25, 1,
    v => v === 0 ? 'Off' : `${v}°`,
    v => { pipTrainerOptions.avoidDegrees = v; savePipTrainerOptions(); }
  ));
  wrap.appendChild(sliderRow(
    'Duration', pipTrainerOptions.durationSec === null ? 11 : Math.round(pipTrainerOptions.durationSec / 60), 1, 11, 1,
    v => v >= 11 ? 'Indefinite' : `${v} min`,
    v => { pipTrainerOptions.durationSec = v >= 11 ? null : v * 60; savePipTrainerOptions(); }
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

  // Not a ScenarioConfig — a bare, physically-damped ESP-style PIP to flick/track onto, with no
  // ship, hull, or health involved at all. See combat/pipTrainer.ts for why this is deliberately
  // separate from the ship-based drills below.
  const pipTrainerCard = document.createElement('div');
  pipTrainerCard.className = 'scenario-card';
  pipTrainerCard.innerHTML =
    '<h3>PIP Trainer</h3><p>A single ESP-style PIP jinks around in front of you with no ship attached to it — ' +
    'just pure tracking practice. It actively flees your crosshair rather than sitting still or drifting onto it, ' +
    'so you have to chase it down. Keep your nose on it continuously for the configured hold time to score a rep, ' +
    'then it immediately jinks again.</p>';
  pipTrainerCard.appendChild(buildPipTrainerControls());
  const pipTrainerBtn = document.createElement('button');
  pipTrainerBtn.textContent = 'START';
  pipTrainerBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    handlers.startPipTrainer(pipTrainerOptions);
  });
  pipTrainerCard.appendChild(pipTrainerBtn);
  list.appendChild(pipTrainerCard);

  for (const config of SCENARIOS) {
    const isAimTraining = config.id === 'aim-training';
    const isMergeDrill = config.id === 'merge-drill';
    const isEvasivePilot = config.id === 'evasive-pilot';
    // merge-drill/evasive-pilot's description embeds the configured options, so it's rebuilt from
    // the player's saved options rather than using the default-built SCENARIOS entry as-is.
    const displayConfig = isMergeDrill ? buildMergeDrillScenario(mergeDrillOptions)
      : isEvasivePilot ? buildEvasivePilotScenario(evasivePilotOptions)
      : config;
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.innerHTML = `<h3>${displayConfig.name}</h3><p>${displayConfig.description}</p>`;
    if (isAimTraining) card.appendChild(buildAimTrainingControls());
    if (isMergeDrill) card.appendChild(buildMergeDrillControls(card.querySelector('p') as HTMLElement));
    if (isEvasivePilot) card.appendChild(buildEvasivePilotControls(card.querySelector('p') as HTMLElement));
    const btn = document.createElement('button');
    btn.textContent = 'START';
    btn.addEventListener('click', () => {
      overlay.style.display = 'none';
      handlers.startScenario(
        isAimTraining ? buildAimTrainingScenario(aimTrainingOptions)
          : isMergeDrill ? buildMergeDrillScenario(mergeDrillOptions)
          : isEvasivePilot ? buildEvasivePilotScenario(evasivePilotOptions)
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
  stats?: { shotsFired: number; hitsLanded: number; kills: number; hitsTaken: number },
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
  if (stats && config.evasiveReturnFire) detail += ` Hits taken: ${stats.hitsTaken}.`;
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

export function showPipTrainerResult(state: PipTrainerState, opts: PipTrainerOptions): void {
  picker.style.display = 'none';
  resultEl.style.display = 'block';
  resultEl.className = 'won'; // PIP Trainer has no lose state — it only ends by running out the clock

  const perMinute = state.elapsedSec > 0 ? (state.reps / state.elapsedSec) * 60 : 0;
  const scoreLine = `Score: ${state.reps} reps (${perMinute.toFixed(1)}/min over ${state.elapsedSec.toFixed(1)}s).`;

  // Echo back the exact settings the run used — same formatting conventions as the slider labels
  // in buildPipTrainerControls, so this reads as "here's what you ran," not a different unit system.
  const holdMs = Math.round(opts.holdDurationSec * 1000);
  const holdLabel = holdMs >= 1000 ? `${(holdMs / 1000).toFixed(2)}s` : `${holdMs}ms`;
  const randomnessLabel = `${Math.round(opts.randomness * 9) + 1}/10`;
  const avoidLabel = opts.avoidDegrees === 0 ? 'Off' : `${opts.avoidDegrees}°`;
  const durationLabel = opts.durationSec === null ? 'Indefinite' : `${Math.round(opts.durationSec / 60)} min`;
  const settingsLine = `Speed: ${opts.speed} m/s &middot; Randomness: ${randomnessLabel} &middot; ` +
    `Hold Time: ${holdLabel} &middot; Avoid Radius: ${avoidLabel} &middot; Duration: ${durationLabel}`;

  resultEl.innerHTML =
    `<h2>DRILL COMPLETE</h2>` +
    `<p style="color:var(--hud-dim)">${scoreLine}</p>` +
    `<p style="color:var(--hud-dim); font-size:11px;">${settingsLine}</p>`;

  const retryBtn = document.createElement('button');
  retryBtn.textContent = 'RETRY';
  retryBtn.addEventListener('click', () => {
    overlay.style.display = 'none';
    handlers.startPipTrainer(opts);
  });
  const menuBtn = document.createElement('button');
  menuBtn.textContent = 'BACK TO MENU';
  menuBtn.addEventListener('click', showPicker);

  resultEl.appendChild(retryBtn);
  resultEl.appendChild(menuBtn);
  overlay.style.display = 'flex';
}
