import { describe, it, expect } from 'vitest';
import { buildBarrelRollGatePath, evaluateGateCrossing } from '../src/scenarios/gatePath';

describe('buildBarrelRollGatePath', () => {
  it('generates gateCount gates progressing forward along +Z', () => {
    const gates = buildBarrelRollGatePath({
      startZ: 100, gateCount: 4, spacingZ: 50, turns: 1, rollRadius: 20, gateRadius: 10
    });
    expect(gates).toHaveLength(4);
    expect(gates[0].pos.z).toBe(150);
    expect(gates[3].pos.z).toBe(300);
    for (const gate of gates) expect(gate.radius).toBe(10);
  });

  it('spreads gates around a circle of the given roll radius', () => {
    const gates = buildBarrelRollGatePath({
      startZ: 0, gateCount: 4, spacingZ: 100, turns: 1, rollRadius: 50, gateRadius: 10
    });
    for (const gate of gates) {
      expect(Math.hypot(gate.pos.x, gate.pos.y)).toBeCloseTo(50, 5);
    }
  });
});

describe('evaluateGateCrossing', () => {
  const gate = { pos: { x: 0, y: 0, z: 100 }, quat: { x: 0, y: 0, z: 0, w: 1 }, radius: 20 };

  it('reports "ahead" while the player has not reached the gate plane', () => {
    expect(evaluateGateCrossing({ x: 0, y: 0, z: 0 }, gate)).toBe('ahead');
  });

  it('reports "cleared" when the player passes through within the ring radius', () => {
    expect(evaluateGateCrossing({ x: 5, y: 5, z: 100 }, gate)).toBe('cleared');
  });

  it('reports "missed" when the player passes the plane outside the ring radius', () => {
    expect(evaluateGateCrossing({ x: 50, y: 0, z: 100 }, gate)).toBe('missed');
  });

  it('treats exactly-on-the-plane as passed (along <= 0)', () => {
    expect(evaluateGateCrossing({ x: 0, y: 0, z: 100 }, gate)).toBe('cleared');
  });
});
