import { describe, it, expect } from 'vitest';
import {
  parseActionMapsXML,
  parseJoystickDevices,
  parseJoystickAxisBindings,
  buildAxisMap,
  buildOverridesFromParsed
} from '../src/input/controlsModule';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ActionMaps>
  <options type="joystick" instance="1" Product=" VKBsim Gladiator EVO L    {0201231D-0000-0000-0000-504944564944}" />
  <options type="joystick" instance="2" Product="" />
  <actionmap name="spaceship_movement">
    <action name="v_pitch_up">
      <rebind input="kb1_up" />
    </action>
    <action name="v_yaw_left">
      <rebind input="kb1_lshift+left" />
    </action>
    <action name="v_roll">
      <rebind input="js1_x" />
    </action>
    <action name="v_space_brake">
      <rebind input="mouse1" />
    </action>
  </actionmap>
</ActionMaps>`;

describe('parseActionMapsXML', () => {
  it('collects only kb1_ rebinds, keyed by SC action name', () => {
    const { actionsRaw } = parseActionMapsXML(SAMPLE_XML);
    expect(actionsRaw['v_pitch_up']).toEqual(['kb1_up']);
    expect(actionsRaw['v_yaw_left']).toEqual(['kb1_lshift+left']);
    // v_roll only has a js1_x (joystick) rebind, no kb1_ — should not appear
    expect(actionsRaw['v_roll']).toBeUndefined();
    // v_space_brake only has a mouse rebind — should not appear
    expect(actionsRaw['v_space_brake']).toBeUndefined();
  });

  it('throws on malformed XML', () => {
    expect(() => parseActionMapsXML('<not-xml')).toThrow();
  });
});

describe('parseJoystickDevices', () => {
  it('decodes the DirectInput GUID into vendor/product ID', () => {
    const devices = parseJoystickDevices(SAMPLE_XML);
    expect(devices).toHaveLength(1); // the empty-Product instance="2" slot is skipped
    const [dev] = devices;
    expect(dev.instance).toBe('1');
    expect(dev.name).toBe('VKBsim Gladiator EVO L');
    // hex8 = "0201231D" -> pid = first 4 chars, vid = last 4 chars
    expect(dev.pid).toBe('0201');
    expect(dev.vid).toBe('231D');
  });
});

describe('parseJoystickAxisBindings + buildAxisMap', () => {
  it('resolves a js1_x rebind to the roll concept', () => {
    const axisRaw = parseJoystickAxisBindings(SAMPLE_XML);
    expect(axisRaw['v_roll']).toEqual([{ instance: '1', axis: 'x' }]);

    const axisMap = buildAxisMap(axisRaw);
    expect(axisMap.roll).toEqual({ instance: '1', axis: 'x', scName: 'v_roll' });
  });
});

describe('buildOverridesFromParsed', () => {
  it('matches known SC action names and reports the rest as not found', () => {
    const parsed = parseActionMapsXML(SAMPLE_XML);
    const { matched, notFound } = buildOverridesFromParsed(parsed);

    const pitchUp = matched.find(m => m.simAction === 'pitchUp');
    expect(pitchUp?.chords).toEqual([['ArrowUp']]);

    const yawLeft = matched.find(m => m.simAction === 'yawLeft');
    expect(yawLeft?.chords).toEqual([['ShiftLeft', 'ArrowLeft']]);

    // actions with no rebind in the file at all should be reported, not silently guessed
    expect(notFound.some(nf => nf.simAction === 'rollLeft')).toBe(true);
  });
});
