import { describe, it, expect } from 'vitest';
import { parseVidPid } from '../src/input/gamepadModule';

describe('parseVidPid', () => {
  it('parses Chromium format', () => {
    expect(parseVidPid('VKBsim Gladiator EVO L (Vendor: 231d Product: 0201)')).toEqual({ vid: '231D', pid: '0201' });
  });

  it('parses Firefox format', () => {
    expect(parseVidPid('231d-0201- VKBsim Gladiator EVO L')).toEqual({ vid: '231D', pid: '0201' });
    expect(parseVidPid('231d-011f- VKBSim T-Rudder')).toEqual({ vid: '231D', pid: '011F' });
    expect(parseVidPid('1234-bead-vJoy - Virtual Joystick')).toEqual({ vid: '1234', pid: 'BEAD' });
  });

  it('returns nulls when no vid/pid can be found', () => {
    expect(parseVidPid('Xbox Wireless Controller')).toEqual({ vid: null, pid: null });
  });
});
