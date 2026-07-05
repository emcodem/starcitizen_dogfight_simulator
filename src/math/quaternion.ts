import type { AngularState, Quat, Vec3 } from '../types';
import { clamp, cross, normalize } from './vec';

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

// Builds the quaternion whose computeAxes().forward/up match the given world-space directions —
// used by AI to construct a "face this direction" target orientation. upHint just needs to be
// non-parallel to forward; a small fallback keeps it from degenerating when it's not.
export function lookAtQuat(forward: Vec3, upHint: Vec3 = { x: 0, y: 1, z: 0 }): Quat {
  const f = normalize(forward);
  let right = cross(f, upHint);
  if (Math.hypot(right.x, right.y, right.z) < 1e-6) {
    right = cross(f, { x: 1, y: 0, z: 0 });
  }
  right = normalize(right);
  const up = cross(right, f);
  return quatFromAxes(right, up, f);
}

// Standard rotation-matrix-to-quaternion conversion, adapted to this file's axis convention
// (computeAxes maps base up (0,-1,0) to `up`, so the matrix's up column is -up — see lookAtQuat).
function quatFromAxes(right: Vec3, up: Vec3, forward: Vec3): Quat {
  const m00 = right.x, m10 = right.y, m20 = right.z;
  const m01 = -up.x, m11 = -up.y, m21 = -up.z;
  const m02 = forward.x, m12 = forward.y, m22 = forward.z;

  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    return quatNormalize({
      w: 0.25 * s,
      x: (m21 - m12) / s,
      y: (m02 - m20) / s,
      z: (m10 - m01) / s
    });
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return quatNormalize({
      w: (m21 - m12) / s,
      x: 0.25 * s,
      y: (m01 + m10) / s,
      z: (m02 + m20) / s
    });
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return quatNormalize({
      w: (m02 - m20) / s,
      x: (m01 + m10) / s,
      y: 0.25 * s,
      z: (m12 + m21) / s
    });
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    return quatNormalize({
      w: (m10 - m01) / s,
      x: (m02 + m20) / s,
      y: (m12 + m21) / s,
      z: 0.25 * s
    });
  }
}

function quatDot(a: Quat, b: Quat): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = quatDot(a, b);
  let bb = b;
  if (dot < 0) {
    dot = -dot;
    bb = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  dot = clamp(dot, -1, 1);

  if (dot > 0.9995) {
    return quatNormalize({
      x: a.x + t * (bb.x - a.x),
      y: a.y + t * (bb.y - a.y),
      z: a.z + t * (bb.z - a.z),
      w: a.w + t * (bb.w - a.w)
    });
  }

  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sinTheta0 = Math.sin(theta0);
  const s0 = Math.cos(theta) - (dot * Math.sin(theta)) / sinTheta0;
  const s1 = Math.sin(theta) / sinTheta0;
  return quatNormalize({
    x: s0 * a.x + s1 * bb.x,
    y: s0 * a.y + s1 * bb.y,
    z: s0 * a.z + s1 * bb.z,
    w: s0 * a.w + s1 * bb.w
  });
}

// Rotates `current` toward `target` by at most `maxAngleRad`, snapping to `target` once within
// range — a generic "turn at a capped rate" primitive for AI facing/aiming behavior.
export function rotateTowards(current: Quat, target: Quat, maxAngleRad: number): Quat {
  const dot = clamp(Math.abs(quatDot(current, target)), -1, 1);
  const angle = 2 * Math.acos(dot);
  if (angle <= maxAngleRad || angle < 1e-6) return quatNormalize(target);
  return slerp(current, target, maxAngleRad / angle);
}
