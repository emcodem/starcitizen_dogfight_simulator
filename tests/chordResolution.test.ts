import { describe, it, expect } from 'vitest';
import { tokenToCode, inputStringToChord, chordToLabel } from '../src/input/controlsModule';

describe('tokenToCode', () => {
  it('maps named tokens to their KeyboardEvent.code', () => {
    expect(tokenToCode('lshift')).toBe('ShiftLeft');
    expect(tokenToCode('rctrl')).toBe('ControlRight');
    expect(tokenToCode('space')).toBe('Space');
  });

  it('maps single letters and digits', () => {
    expect(tokenToCode('a')).toBe('KeyA');
    expect(tokenToCode('A')).toBe('KeyA');
    expect(tokenToCode('5')).toBe('Digit5');
  });

  it('maps function keys', () => {
    expect(tokenToCode('f1')).toBe('F1');
    expect(tokenToCode('f12')).toBe('F12');
  });

  it('returns null for unsupported tokens (e.g. mouse buttons)', () => {
    expect(tokenToCode('mouse1')).toBeNull();
    expect(tokenToCode('')).toBeNull();
    expect(tokenToCode(undefined)).toBeNull();
  });
});

describe('inputStringToChord', () => {
  it('parses a single-key SC input string', () => {
    expect(inputStringToChord('kb1_x')).toEqual(['KeyX']);
  });

  it('parses a multi-key chord joined with +', () => {
    expect(inputStringToChord('kb1_lshift+right')).toEqual(['ShiftLeft', 'ArrowRight']);
  });

  it('returns null when any token in the chord is unsupported', () => {
    expect(inputStringToChord('kb1_lshift+mouse1')).toBeNull();
  });
});

describe('chordToLabel', () => {
  it('renders a readable label for a chord', () => {
    expect(chordToLabel(['ShiftLeft', 'ArrowRight'])).toBe('Shift+Right');
    expect(chordToLabel(['KeyW'])).toBe('W');
    expect(chordToLabel(['Digit1'])).toBe('1');
  });
});
