import { describe, it, expect } from 'vitest';
import * as EspAssist from '../src/combat/espAssist';

describe('dampingFactorForDistance', () => {
  it('applies no dampening at or beyond the circle radius', () => {
    EspAssist.setCircleRadius(50);
    EspAssist.setDampeningStrength(0.7);
    expect(EspAssist.dampingFactorForDistance(50)).toBe(1);
    expect(EspAssist.dampingFactorForDistance(80)).toBe(1);
  });

  it('applies the full dampening strength at dead center', () => {
    EspAssist.setCircleRadius(50);
    EspAssist.setDampeningStrength(0.7);
    expect(EspAssist.dampingFactorForDistance(0)).toBeCloseTo(0.3, 5);
  });

  it('ramps monotonically between center and the circle edge', () => {
    EspAssist.setCircleRadius(50);
    EspAssist.setDampeningStrength(0.7);
    const near = EspAssist.dampingFactorForDistance(10);
    const mid = EspAssist.dampingFactorForDistance(25);
    const far = EspAssist.dampingFactorForDistance(40);
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(far);
    expect(far).toBeLessThan(1);
  });
});
