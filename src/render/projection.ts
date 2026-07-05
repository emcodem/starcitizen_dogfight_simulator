import type { Vec3 } from '../types';
import type { ShipAxes } from '../math/quaternion';

// Shared world-to-screen projection — pulled out of render.ts so combat/pipTargeting.ts can
// compute a PIP's screen position from physics/step.ts too (no canvas reference there).

export interface Camera {
  pos: Vec3;
  axes: ShipAxes;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

const FOCAL_LENGTH = 500;

export function project(
  px: number, py: number, pz: number,
  cam: Camera,
  viewportWidth: number, viewportHeight: number
): ProjectedPoint | null {
  // transform world point into camera space using camera axes
  const dx = px - cam.pos.x, dy = py - cam.pos.y, dz = pz - cam.pos.z;
  const { forward, right, up } = cam.axes;
  const cx = dx * right.x + dy * right.y + dz * right.z;
  const cy = dx * up.x + dy * up.y + dz * up.z;
  const cz = dx * forward.x + dy * forward.y + dz * forward.z;
  if (cz <= 1) return null; // behind camera
  const f = FOCAL_LENGTH / cz;
  return { x: viewportWidth / 2 + cx * f, y: viewportHeight / 2 - cy * f, scale: f, depth: cz };
}
