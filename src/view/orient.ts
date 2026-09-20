import { Quaternion, type Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Point a mesh's length down a direction.
 *
 * Babylon's `Quaternion.FromLookDirectionLH` looks like the function for
 * this and is not: it leaves the axis where it started for a level
 * direction and swings further away the steeper the direction gets, by
 * fourteen degrees at thirty above the horizon and sixty near the vertical.
 * A tracer built with it reads correctly along a flat shot and flies off
 * sideways from one fired upward, which is exactly what it did.
 *
 * The rotation here is built from the direction's own bearing and elevation,
 * which has an answer everywhere on the sphere. The shortest arc between two
 * vectors would do as well for everything here — nothing that uses this
 * cares which way up it ends, since a stretched box and a round decal are
 * both unchanged by a roll about their own axis — but it comes apart within
 * a couple of degrees of pointing backwards, which is a direction rounds are
 * fired in as often as any other.
 *
 * `direction` must be a unit vector.
 */

export const alignToDirection = (direction: Vector3, into: Quaternion): Quaternion => {
  const yaw = Math.atan2(direction.x, direction.z);
  // Babylon's pitch turns the length downward as it grows, so height is its
  // negative.
  const pitch = -Math.asin(Math.max(-1, Math.min(1, direction.y)));
  Quaternion.RotationYawPitchRollToRef(yaw, pitch, 0, into);
  return into;
};
