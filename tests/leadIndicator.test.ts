import { describe, it, expect } from 'vitest';
import { computeLeadPoint } from '../src/combat/leadIndicator';

describe('computeLeadPoint', () => {
  it('returns the target position when both shooter and target are stationary', () => {
    const shooterPos = { x: 0, y: 0, z: 0 };
    const zero = { x: 0, y: 0, z: 0 };
    const targetPos = { x: 100, y: 20, z: -30 };
    const lead = computeLeadPoint(shooterPos, zero, targetPos, zero, 1400);
    expect(lead).not.toBeNull();
    expect(lead!.x).toBeCloseTo(targetPos.x, 3);
    expect(lead!.y).toBeCloseTo(targetPos.y, 3);
    expect(lead!.z).toBeCloseTo(targetPos.z, 3);
  });

  it('compensates for the shooter\'s own velocity against a stationary target', () => {
    const shooterPos = { x: 0, y: 0, z: 0 };
    const shooterVel = { x: 50, y: 0, z: 0 }; // moving sideways relative to the target
    const targetPos = { x: 0, y: 0, z: 1000 };
    const zero = { x: 0, y: 0, z: 0 };
    const lead = computeLeadPoint(shooterPos, shooterVel, targetPos, zero, 1400);
    expect(lead).not.toBeNull();
    // shooter drifting +x means the aim point must shift -x to compensate, or the inherited
    // velocity carries the shot past the (stationary) target
    expect(lead!.x).toBeLessThan(targetPos.x);
    expect(lead!.z).toBeCloseTo(targetPos.z, 3);
  });

  it('returns null when the target can outrun the projectile', () => {
    const shooterPos = { x: 0, y: 0, z: 0 };
    const zero = { x: 0, y: 0, z: 0 };
    const targetPos = { x: 0, y: 0, z: 1000 };
    const fastTargetVel = { x: 0, y: 0, z: 5000 }; // far faster than the projectile
    const lead = computeLeadPoint(shooterPos, zero, targetPos, fastTargetVel, 1400);
    expect(lead).toBeNull();
  });
});
