import { describe, it, expect, beforeEach } from 'vitest';
import * as ControlsModule from '../src/input/controlsModule';
import {
  getAxisMap, setAxisMap, getButtonMap, setButtonMap,
  getMouseButtonMap, setMouseButtonMap, getScDevices, setScDevices
} from '../src/input/deviceState';
import * as MouseLook from '../src/input/mouseLook';
import * as PresetStore from '../src/input/presetStore';
import { registerConfig } from '../src/input/configRegistry';

const DEFAULT_MOUSE = { sensitivity: 1.5, invertY: true, deadzone: 0.05 };
const DEFAULT_MOUSE_BUTTON_MAP = { primaryFire: { button: 0, label: 'Left Click' } };

function resetAllConfig(): void {
  ControlsModule.resetToDefault();
  setAxisMap({});
  setButtonMap({});
  setMouseButtonMap({ ...DEFAULT_MOUSE_BUTTON_MAP });
  setScDevices([]);
  MouseLook.setSensitivity(DEFAULT_MOUSE.sensitivity);
  MouseLook.setInvertY(DEFAULT_MOUSE.invertY);
  MouseLook.setDeadzone(DEFAULT_MOUSE.deadzone);
}

beforeEach(() => {
  localStorage.clear();
  resetAllConfig();
});

describe('PresetStore', () => {
  it('round-trips keybinds, joystick axis/button maps, scDevices, and mouse settings', async () => {
    ControlsModule.setBinding('boost', [['KeyB']]);
    setAxisMap({
      pitch: { vid: '231D', pid: '0110', axisIndex: 1, label: 'Y', manual: true },
      // An XML-derived (non-manual) binding only stores an actionmaps.xml `instance` —
      // resolving it to a live gamepad needs the matching scDevices entry to survive too.
      yaw: { instance: '1', axis: 'x', scName: 'v_yaw' }
    });
    setScDevices([{ instance: '1', name: 'Test Stick', guid: 'ABCD1234', vid: '231D', pid: '0110' }]);
    setButtonMap({ spaceBrake: { vid: '231D', pid: '0110', buttonIndex: 4, label: 'Button 4' } });
    setMouseButtonMap({ primaryFire: { button: 2, label: 'Right Click' } });
    MouseLook.setSensitivity(2.5);
    MouseLook.setInvertY(false);
    MouseLook.setDeadzone(0.2);

    await PresetStore.savePreset('full-preset');
    resetAllConfig();

    // Sanity check the reset actually cleared everything before reload.
    expect(ControlsModule.getBindings().boost).toEqual([['ShiftLeft']]);
    expect(getAxisMap().pitch).toBeUndefined();
    expect(getButtonMap().spaceBrake).toBeUndefined();
    expect(getMouseButtonMap()).toEqual(DEFAULT_MOUSE_BUTTON_MAP);
    expect(getScDevices()).toEqual([]);
    expect(MouseLook.getSensitivity()).toBe(DEFAULT_MOUSE.sensitivity);

    await PresetStore.loadPreset('full-preset');

    expect(ControlsModule.getBindings().boost).toEqual([['KeyB']]);
    expect(getAxisMap().pitch).toEqual({ vid: '231D', pid: '0110', axisIndex: 1, label: 'Y', manual: true });
    expect(getAxisMap().yaw).toEqual({ instance: '1', axis: 'x', scName: 'v_yaw' });
    expect(getScDevices()).toEqual([{ instance: '1', name: 'Test Stick', guid: 'ABCD1234', vid: '231D', pid: '0110' }]);
    expect(getButtonMap().spaceBrake).toEqual({ vid: '231D', pid: '0110', buttonIndex: 4, label: 'Button 4' });
    expect(getMouseButtonMap().primaryFire).toEqual({ button: 2, label: 'Right Click' });
    expect(MouseLook.getSensitivity()).toBe(2.5);
    expect(MouseLook.getInvertY()).toBe(false);
    expect(MouseLook.getDeadzone()).toBe(0.2);
  });

  it('falls back to the default mouse button map if a preset stores an explicit null for it', async () => {
    localStorage.setItem('vector_control_preset:null-mouse', JSON.stringify({
      keybinds: ControlsModule.getBindings(),
      mouseButtonMap: null
    }));
    setMouseButtonMap({});

    await PresetStore.loadPreset('null-mouse');

    expect(getMouseButtonMap()).toEqual(DEFAULT_MOUSE_BUTTON_MAP);
  });

  it('migrates a legacy preset that stored only a raw keybind map', async () => {
    localStorage.setItem('vector_control_preset:legacy', JSON.stringify(ControlsModule.getBindings()));
    ControlsModule.setBinding('boost', [['KeyZ']]);

    await PresetStore.loadPreset('legacy');

    expect(ControlsModule.getBindings().boost).toEqual([['ShiftLeft']]);
  });

  it('export/import round-trips through a file-shaped JSON blob without touching localStorage', () => {
    ControlsModule.setBinding('boost', [['KeyN']]);
    MouseLook.setDeadzone(0.15);
    const blob = JSON.stringify({
      keybinds: ControlsModule.getBindings(),
      axisMap: getAxisMap(),
      buttonMap: getButtonMap(),
      scDevices: getScDevices(),
      mouseLook: { sensitivity: MouseLook.getSensitivity(), invertY: MouseLook.getInvertY(), deadzone: 0.15 }
    });
    resetAllConfig();

    PresetStore.importFromFileText(blob);

    expect(ControlsModule.getBindings().boost).toEqual([['KeyN']]);
    expect(MouseLook.getDeadzone()).toBe(0.15);
  });

  it('includes a newly-registered config item automatically, with no changes to PresetStore', async () => {
    let futureSetting = 'default';
    registerConfig({
      key: '__test_future_setting__',
      serialize: () => futureSetting,
      deserialize: data => { futureSetting = data as string; }
    });

    futureSetting = 'custom-value';
    await PresetStore.savePreset('future-preset');
    futureSetting = 'default';

    await PresetStore.loadPreset('future-preset');

    expect(futureSetting).toBe('custom-value');
  });

  it('tracks and restores the last preset chosen, clearing a stale reference on failure', async () => {
    await PresetStore.savePreset('last-one');
    expect(PresetStore.getLastPresetName()).toBe('last-one');

    resetAllConfig();
    ControlsModule.setBinding('boost', [['KeyM']]);
    const restored = await PresetStore.restoreLastPreset();
    expect(restored).toBe('last-one');
    expect(ControlsModule.getBindings().boost).toEqual([['ShiftLeft']]);

    await PresetStore.deletePreset('last-one');
    expect(PresetStore.getLastPresetName()).toBeNull();
    expect(await PresetStore.restoreLastPreset()).toBeNull();
  });
});
