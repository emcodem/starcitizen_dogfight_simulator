import type { Vec3 } from '../types';
import type { FlightGate } from './types';
import { computeAxes, lookAtQuat } from '../math/quaternion';

// Generates a helical "fly through these rings" course along +Z — a corkscrew translation that
// approximates a barrel roll's flight path (looping laterally while still progressing forward).
// Following the gates in order requires actually flying the maneuver, not just pointing at a
// single target. All gates share one forward-facing orientation since the course only ever
// progresses along +Z.
export function buildBarrelRollGatePath(opts: {
  startZ: number;       // distance ahead of the player spawn where the course begins
  gateCount: number;
  spacingZ: number;     // forward distance between consecutive gates
  turns: number;        // how many full loops the course makes over its length
  rollRadius: number;   // radius of the corkscrew, meters
  gateRadius: number;   // how forgiving each ring is
}): FlightGate[] {
  const { startZ, gateCount, spacingZ, turns, rollRadius, gateRadius } = opts;
  const quat = lookAtQuat({ x: 0, y: 0, z: 1 });
  const gates: FlightGate[] = [];
  for (let i = 1; i <= gateCount; i++) {
    const angle = (i / gateCount) * turns * Math.PI * 2;
    gates.push({
      pos: { x: Math.cos(angle) * rollRadius, y: Math.sin(angle) * rollRadius, z: startZ + i * spacingZ },
      quat,
      radius: gateRadius
    });
  }
  return gates;
}

// Whether the player has crossed this gate's plane this frame (their position has moved from the
// gate's forward side to its aft side), and if so whether they passed through the ring (cleared)
// or missed it outside the ring radius. Returns 'ahead' while the gate is still in front of the
// player — call once per frame against the current target gate (see scenarios/runtime.ts).
export function evaluateGateCrossing(playerPos: Vec3, gate: FlightGate): 'ahead' | 'cleared' | 'missed' {
  const { forward } = computeAxes(gate.quat);
  const toGate: Vec3 = { x: gate.pos.x - playerPos.x, y: gate.pos.y - playerPos.y, z: gate.pos.z - playerPos.z };
  const along = toGate.x * forward.x + toGate.y * forward.y + toGate.z * forward.z;
  if (along > 0) return 'ahead';
  const lateral = Math.hypot(
    toGate.x - forward.x * along,
    toGate.y - forward.y * along,
    toGate.z - forward.z * along
  );
  return lateral <= gate.radius ? 'cleared' : 'missed';
}
