import { normalize, vec3, type Vec3 } from "./vec3";

/**
 * Aim direction from yaw and pitch.
 * Yaw is clockwise from the forward axis; pitch is above the horizon.
 * Matches the engine's left-handed convention, where yaw zero looks down +Z.
 */
export const aimForward = (yaw: number, pitch: number): Vec3 => {
  const cosPitch = Math.cos(pitch);
  return vec3(Math.sin(yaw) * cosPitch, Math.sin(pitch), Math.cos(yaw) * cosPitch);
};

/** The shooter's right, horizontal regardless of pitch. */
export const aimRight = (yaw: number): Vec3 => vec3(Math.cos(yaw), 0, -Math.sin(yaw));

/** The shooter's up, perpendicular to both. */
export const aimUp = (yaw: number, pitch: number): Vec3 => {
  const forward = aimForward(yaw, pitch);
  const right = aimRight(yaw);
  return vec3(
    forward.y * right.z - forward.z * right.y,
    forward.z * right.x - forward.x * right.z,
    forward.x * right.y - forward.y * right.x,
  );
};

/**
 * Offset a direction inside the aim's own tangent plane.
 *
 * Offsetting yaw and pitch as raw angles would squash the cone into an ellipse
 * as the shooter looks up or down. Building the direction from the aim basis
 * keeps a circular cone at every pitch.
 */
export const offsetDirection = (
  yaw: number,
  pitch: number,
  yawOffset: number,
  pitchOffset: number,
): Vec3 => {
  const forward = aimForward(yaw, pitch);
  if (yawOffset === 0 && pitchOffset === 0) return forward;
  const right = aimRight(yaw);
  const up = aimUp(yaw, pitch);
  return normalize(
    vec3(
      forward.x + right.x * yawOffset + up.x * pitchOffset,
      forward.y + right.y * yawOffset + up.y * pitchOffset,
      forward.z + right.z * yawOffset + up.z * pitchOffset,
    ),
  );
};
