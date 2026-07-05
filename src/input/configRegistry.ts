// =====================================================================
// ConfigRegistry — generic backbone for "control preset" persistence.
//
// Each input-config module (keybinds, joystick axis/button maps, mouse
// look settings, ...) registers itself here with a serialize/deserialize
// pair under its own key. Preset save/export bundles serializeAll() into
// one JSON blob; preset load/import runs it back through deserializeAll().
// Neither side needs to know what the other config modules are — adding
// or removing a config item only touches the module that owns it.
//
// UI modules that display config state can subscribe via onConfigApplied
// to refresh themselves whenever a preset is loaded, without the preset
// UI needing to know they exist.
// =====================================================================

export interface ConfigEntry {
  key: string;
  serialize(): unknown;
  deserialize(data: unknown): void;
}

const registry: ConfigEntry[] = [];
const applyListeners: Array<() => void> = [];

export function registerConfig(entry: ConfigEntry): void {
  registry.push(entry);
}

export function onConfigApplied(fn: () => void): void {
  applyListeners.push(fn);
}

export function serializeAllConfig(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of registry) out[entry.key] = entry.serialize();
  return out;
}

export function deserializeAllConfig(data: Record<string, unknown> | null | undefined): void {
  if (data) {
    for (const entry of registry) {
      if (Object.prototype.hasOwnProperty.call(data, entry.key)) entry.deserialize(data[entry.key]);
    }
  }
  applyListeners.forEach(fn => fn());
}
