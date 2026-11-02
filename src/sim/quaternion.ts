import type { Vec3 } from './vector';

/** A unit quaternion: an orientation, or a rotation from the ship's body frame to the world. */
export interface Quat {
  readonly w: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const IDENTITY: Quat = { w: 1, x: 0, y: 0, z: 0 };

export const multiply = (a: Quat, b: Quat): Quat => ({
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
});

export const conjugate = (q: Quat): Quat => ({ w: q.w, x: -q.x, y: -q.y, z: -q.z });

export const normalizeQuat = (q: Quat): Quat => {
  const l = Math.hypot(q.w, q.x, q.y, q.z);
  return { w: q.w / l, x: q.x / l, y: q.y / l, z: q.z / l };
};

/** Rotates `v` by `q`. */
export const rotate = (q: Quat, v: Vec3): Vec3 => {
  const r = multiply(multiply(q, { w: 0, x: v.x, y: v.y, z: v.z }), conjugate(q));
  return { x: r.x, y: r.y, z: r.z };
};

/** The rotation of `angle` radians about the unit vector `axis`. */
export const fromAxisAngle = (axis: Vec3, angle: number): Quat => {
  const s = Math.sin(angle / 2);
  return { w: Math.cos(angle / 2), x: axis.x * s, y: axis.y * s, z: axis.z * s };
};

/** Advances an orientation by a body-frame angular velocity (rad/s) over `dt` seconds. */
export const integrate = (q: Quat, bodyAngularVelocity: Vec3, dt: number): Quat => {
  const speed = Math.hypot(bodyAngularVelocity.x, bodyAngularVelocity.y, bodyAngularVelocity.z);
  if (speed === 0) return q;
  const axis = {
    x: bodyAngularVelocity.x / speed,
    y: bodyAngularVelocity.y / speed,
    z: bodyAngularVelocity.z / speed,
  };
  return normalizeQuat(multiply(q, fromAxisAngle(axis, speed * dt)));
};
