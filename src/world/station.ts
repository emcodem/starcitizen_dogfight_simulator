// ---------- Static collidable object — a simple station to practice flying around and avoiding ----------
export const STATION = { pos: { x: 0, y: 0, z: 400 }, halfSize: 25, collisionRadius: 32 };
export const SPAWN = { pos: { x: 0, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } };

// Some scenarios (e.g. a dedicated dogfight drill) don't want the sandbox station cluttering the
// arena — main.ts flips this when starting a run, per ScenarioConfig.includeStation.
let stationActive = true;

export function setStationActive(active: boolean): void {
  stationActive = active;
}

export function isStationActive(): boolean {
  return stationActive;
}
