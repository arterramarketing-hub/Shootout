/** Minimal pure vector math. No engine dependency: this runs on the server too. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const copy = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

export const set = (out: Vec3, x: number, y: number, z: number): Vec3 => {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
};

export const add = (a: Vec3, b: Vec3): Vec3 => vec3(a.x + b.x, a.y + b.y, a.z + b.z);

export const sub = (a: Vec3, b: Vec3): Vec3 => vec3(a.x - b.x, a.y - b.y, a.z - b.z);

export const scale = (v: Vec3, s: number): Vec3 => vec3(v.x * s, v.y * s, v.z * s);

export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

export const length = (v: Vec3): number => Math.sqrt(dot(v, v));

/** Length ignoring the vertical axis. Movement speed is a horizontal quantity. */
export const lengthXZ = (v: Vec3): number => Math.hypot(v.x, v.z);

export const normalize = (v: Vec3): Vec3 => {
  const len = length(v);
  return len > 1e-8 ? scale(v, 1 / len) : vec3();
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

/**
 * Frame-rate independent exponential approach.
 * `smoothing` is the fraction of the remaining gap left after one second.
 */
export const damp = (a: number, b: number, smoothing: number, dt: number): number =>
  lerp(a, b, 1 - Math.pow(smoothing, dt));

export const moveToward = (current: number, target: number, maxDelta: number): number => {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
};
