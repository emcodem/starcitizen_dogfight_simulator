import { SCENARIOS } from '../scenarios/definitions';
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
    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.innerHTML = `<h3>${config.name}</h3><p>${config.description}</p>`;
    const btn = document.createElement('button');
    btn.textContent = 'START';
    btn.addEventListener('click', () => {
      overlay.style.display = 'none';
      handlers.startScenario(config);
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

export function showScenarioResult(outcome: 'won' | 'lost', config: ScenarioConfig): void {
  picker.style.display = 'none';
  resultEl.style.display = 'block';
  resultEl.className = outcome;

  const title = outcome === 'won' ? 'TARGET DESTROYED' : 'YOU WERE DESTROYED';
  const detail = outcome === 'won'
    ? `${config.name} — training complete.`
    : `${config.name} — you took ${config.hitsToKillPlayer} hits.`;
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
