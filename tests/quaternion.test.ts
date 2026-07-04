import { describe, it, expect } from 'vitest';
import { quatMultiply, integrateOrientation, computeAxes } from '../src/math/quaternion';
import type { Quat } from '../src/types';

const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

function magnitude(q: Quat): number {
  return Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
}

describe('quatMultiply', () => {
  it('identity * q === q', () => {
    const q: Quat = { x: 0.1, y: 0.2, z: 0.3, w: 0.9 };
    const result = quatMultiply(IDENTITY, q);
    expect(result.x).toBeCloseTo(q.x);
    expect(result.y).toBeCloseTo(q.y);
    expect(result.z).toBeCloseTo(q.z);
    expect(result.w).toBeCloseTo(q.w);
  });
});

describe('integrateOrientation', () => {
  it('keeps the quaternion normalized after integration', () => {
    const q = integrateOrientation(IDENTITY, { pitch: 1.2, yaw: -0.4, roll: 0.7 }, 0.016);
    expect(magnitude(q)).toBeCloseTo(1, 5);
  });

  it('rotating by zero angular velocity leaves orientation unchanged', () => {
    const q = integrateOrientation(IDENTITY, { pitch: 0, yaw: 0, roll: 0 }, 0.016);
    expect(q.x).toBeCloseTo(0);
    expect(q.y).toBeCloseTo(0);
    expect(q.z).toBeCloseTo(0);
    expect(q.w).toBeCloseTo(1);
  });

  it('pitch input rotates about the local X axis', () => {
    const q = integrateOrientation(IDENTITY, { pitch: 1, yaw: 0, roll: 0 }, 0.01);
    // small-angle integration: x component should grow, y/z should stay ~0
    expect(q.x).toBeGreaterThan(0);
    expect(q.y).toBeCloseTo(0, 5);
    expect(q.z).toBeCloseTo(0, 5);
  });
});

describe('computeAxes', () => {
  it('matches the sandbox convention for the identity orientation', () => {
    const { forward, right, up } = computeAxes(IDENTITY);
    expect(forward).toEqual({ x: 0, y: 0, z: 1 });
    expect(right).toEqual({ x: 1, y: 0, z: 0 });
    expect(up).toEqual({ x: 0, y: -1, z: 0 });
  });

  it('stays orthonormal after rotation', () => {
    const q = integrateOrientation(IDENTITY, { pitch: 0.8, yaw: 1.3, roll: -0.5 }, 0.3);
    const { forward, right, up } = computeAxes(q);
    for (const v of [forward, right, up]) {
      const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
      expect(len).toBeCloseTo(1, 5);
    }
    const dot = (a: typeof forward, b: typeof forward) => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(dot(forward, right)).toBeCloseTo(0, 5);
    expect(dot(forward, up)).toBeCloseTo(0, 5);
    expect(dot(right, up)).toBeCloseTo(0, 5);
  });
});
