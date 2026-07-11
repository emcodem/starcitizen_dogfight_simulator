import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseVidPid, poll, findDevice, findByVidPid } from '../src/input/gamepadModule';

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

// Build a minimal fake Gamepad and install navigator.getGamepads so poll() can read it.
function fakePad(index: number, id: string, nAxes = 2, nButtons = 0): Gamepad {
  return {
    index, id, connected: true, timestamp: 0, mapping: '',
    axes: new Array(nAxes).fill(0),
    buttons: new Array(nButtons).fill({ pressed: false, value: 0, touched: false }),
    vibrationActuator: null,
  } as unknown as Gamepad;
}
function setPads(pads: Gamepad[]): void {
  vi.stubGlobal('navigator', { getGamepads: () => pads });
  poll();
}

describe('findDevice — capability-fingerprint disambiguation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes two same-VID/PID vJoys to distinct gamepads by axis/button count', () => {
    // The Gremlin-style setup: two vJoys, same VID 1234 / PID BEAD, configured with different
    // layouts — an 8-axis/4-button stick and a 2-axis/0-button one. Note the 8-axis one is at the
    // HIGHER browser index, to prove resolution never relies on index order.
    const eightAxis = fakePad(3, '1234-bead-vJoy - Virtual Joystick', 8, 4);
    const twoAxis = fakePad(2, '1234-bead-vJoy - Virtual Joystick', 2, 0);
    setPads([twoAxis, eightAxis]);
    expect(findDevice({ vid: '1234', pid: 'BEAD', axisCount: 8, buttonCount: 4 })?.index).toBe(3);
    expect(findDevice({ vid: '1234', pid: 'BEAD', axisCount: 2, buttonCount: 0 })?.index).toBe(2);
  });

  it('resolves the fingerprinted device regardless of its browser index across a reload', () => {
    // Same two vJoys, but they came back at different indices — fingerprint is index-independent.
    setPads([
      fakePad(6, '1234-bead-vJoy - Virtual Joystick', 8, 4),
      fakePad(5, '1234-bead-vJoy - Virtual Joystick', 2, 0),
    ]);
    expect(findDevice({ vid: '1234', pid: 'BEAD', axisCount: 8, buttonCount: 4 })?.index).toBe(6);
    expect(findDevice({ vid: '1234', pid: 'BEAD', axisCount: 2, buttonCount: 0 })?.index).toBe(5);
  });

  it('returns null when the fingerprinted device is not currently connected', () => {
    setPads([fakePad(2, '1234-bead-vJoy - Virtual Joystick', 2, 0)]);
    expect(findDevice({ vid: '1234', pid: 'BEAD', axisCount: 8, buttonCount: 4 })).toBeNull();
  });

  it('legacy binding (no fingerprint) still resolves by vid/pid alone', () => {
    setPads([fakePad(2, '1234-bead-vJoy - Virtual Joystick', 2, 0)]);
    expect(findByVidPid('1234', 'BEAD')?.index).toBe(2);
  });

  it('cannot distinguish two identically-configured devices (known limitation)', () => {
    // Both vJoys have the same 2-axis/0-button layout — the fingerprint collapses them and the
    // first is returned as a best effort. Users must give each vJoy a distinct axis/button count.
    setPads([
      fakePad(2, '1234-bead-vJoy - Virtual Joystick', 2, 0),
      fakePad(3, '1234-bead-vJoy - Virtual Joystick', 2, 0),
    ]);
    const ref = { vid: '1234', pid: 'BEAD', axisCount: 2, buttonCount: 0 };
    expect(findDevice(ref)?.index).toBe(2);
  });
});
