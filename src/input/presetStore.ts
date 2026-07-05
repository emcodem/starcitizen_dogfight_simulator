import { serializeAllConfig, deserializeAllConfig } from './configRegistry';

// =====================================================================
// PresetStore — generic "control preset" persistence (localStorage when
// available, otherwise file export/import). Bundles whatever config
// modules have registered with configRegistry (keybinds, joystick axis/
// button maps, mouse look settings, ...) into one JSON blob per preset.
// Deliberately knows nothing about what's inside that blob — adding or
// removing a config item is a change in the owning module only.
// =====================================================================

const PRESET_PREFIX = 'vector_control_preset:';
const LAST_PRESET_KEY = 'vector_last_preset';

function probeLocalStorage(): boolean {
  try {
    const testKey = '__vector_storage_probe__';
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}
export const hasPresetStorage = typeof window !== 'undefined' && probeLocalStorage();

function setLastPresetName(name: string | null): void {
  if (!hasPresetStorage) return;
  if (name === null) localStorage.removeItem(LAST_PRESET_KEY);
  else localStorage.setItem(LAST_PRESET_KEY, name);
}
export function getLastPresetName(): string | null {
  if (!hasPresetStorage) return null;
  return localStorage.getItem(LAST_PRESET_KEY);
}

// Presets saved before joystick/mouse settings joined the schema stored the
// raw keybind map at the top level (no wrapper). Recognize that shape and
// migrate it in place instead of silently discarding old presets.
function normalizePresetData(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const looksWrapped = 'keybinds' in obj || 'axisMap' in obj || 'buttonMap' in obj || 'scDevices' in obj || 'mouseLook' in obj;
  return looksWrapped ? obj : { keybinds: obj };
}

export async function savePreset(name: string): Promise<void> {
  if (!hasPresetStorage) throw new Error('no-storage');
  localStorage.setItem(PRESET_PREFIX + name, JSON.stringify(serializeAllConfig()));
  setLastPresetName(name);
}
export async function loadPreset(name: string): Promise<void> {
  if (!hasPresetStorage) throw new Error('no-storage');
  const value = localStorage.getItem(PRESET_PREFIX + name);
  if (value === null) throw new Error('Preset not found.');
  deserializeAllConfig(normalizePresetData(JSON.parse(value)));
  setLastPresetName(name);
}
export async function deletePreset(name: string): Promise<void> {
  if (!hasPresetStorage) throw new Error('no-storage');
  localStorage.removeItem(PRESET_PREFIX + name);
  if (getLastPresetName() === name) setLastPresetName(null);
}
export async function listPresets(): Promise<string[]> {
  if (!hasPresetStorage) throw new Error('no-storage');
  const names: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PRESET_PREFIX)) names.push(key.slice(PRESET_PREFIX.length));
  }
  return names;
}

// Called once at startup — silently re-applies whichever preset was active last
// session, if any. A stale reference (e.g. the preset was deleted elsewhere) is
// cleared rather than retried on every load.
export async function restoreLastPreset(): Promise<string | null> {
  const name = getLastPresetName();
  if (!name) return null;
  try {
    await loadPreset(name);
    return name;
  } catch {
    setLastPresetName(null);
    return null;
  }
}

export function exportToFile(name: string): void {
  const blob = new Blob([JSON.stringify(serializeAllConfig(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (name || 'control-preset') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}
export function importFromFileText(text: string): void {
  deserializeAllConfig(normalizePresetData(JSON.parse(text)));
}
