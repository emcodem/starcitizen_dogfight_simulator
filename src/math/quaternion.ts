import type { AngularState, Quat, Vec3 } from '../types';

// ---------- Quaternion orientation math ----------
// Body-frame integration: angular velocity (pitch/yaw/roll) is always expressed
// relative to the ship's CURRENT orientation, so rotating never depends on the
// order rotations were applied in — fixes pitch/yaw feeling inverted after a roll.

export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
  };
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function rotateVecByQuat(v: Vec3, q: Quat): Vec3 {
  const qv: Quat = { w: 0, x: v.x, y: v.y, z: v.z };
  const qConj: Quat = { w: q.w, x: -q.x, y: -q.y, z: -q.z };
  const r = quatMultiply(quatMultiply(q, qv), qConj);
  return { x: r.x, y: r.y, z: r.z };
}

export function integrateOrientation(q: Quat, angVel: AngularState, dt: number): Quat {
  // angVel.pitch = rotation about local X (right), .yaw about local Y (up), .roll about local Z (forward)
  const omega: Quat = { w: 0, x: angVel.pitch, y: angVel.yaw, z: angVel.roll };
  const qDot = quatMultiply(q, omega);
  const nq: Quat = {
    x: q.x + 0.5 * qDot.x * dt,
    y: q.y + 0.5 * qDot.y * dt,
    z: q.z + 0.5 * qDot.z * dt,
    w: q.w + 0.5 * qDot.w * dt
  };
  return quatNormalize(nq);
}

export interface ShipAxes {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

export function computeAxes(q: Quat): ShipAxes {
  // base vectors match the sandbox's original convention (forward=+Z, right=+X, up=-Y)
  return {
    forward: rotateVecByQuat({ x: 0, y: 0, z: 1 }, q),
    right: rotateVecByQuat({ x: 1, y: 0, z: 0 }, q),
    up: rotateVecByQuat({ x: 0, y: -1, z: 0 }, q)
  };
}
