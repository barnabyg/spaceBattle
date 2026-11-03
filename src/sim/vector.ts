/** A 3D vector in SI units (metres, metres per second, ...). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export const vec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });

export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * Two unit vectors square to the unit vector `v` and to each other, so that with it they make a
 * right-handed set. The first lies in the world's x–y plane unless `v` is close to the z axis.
 */
export const perpendiculars = (v: Vec3): readonly [Vec3, Vec3] => {
  const reference = Math.abs(v.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 1, y: 0, z: 0 };
  const across = normalize(cross(v, reference));
  return [across, cross(v, across)];
};

export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);

export const distance = (a: Vec3, b: Vec3): number => length(sub(a, b));

/** The unit vector along `a`, or the zero vector if `a` has no length. */
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l === 0 ? ZERO : scale(a, 1 / l);
};
