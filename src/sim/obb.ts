import { vec3, type Vec3 } from "./vec3";

/**
 * An oriented box: the one primitive the level is built from.
 *
 * Collision and hitscan work against these rather than against engine meshes,
 * because the authoritative server has to reach exactly the same answer the
 * client does. Two different implementations, however carefully written, will
 * disagree somewhere, and every disagreement is a rubber-band.
 */
export interface Obb {
  center: Vec3;
  halfExtents: Vec3;
  /** Rotation as three column axes, already orthonormal. */
  axisX: Vec3;
  axisY: Vec3;
  axisZ: Vec3;
  /** World-space bounds, for cheap rejection before the exact test. */
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

/** Build an oriented box from a centre, size, and yaw then pitch rotation. */
export const makeObb = (
  center: Vec3,
  halfExtents: Vec3,
  yaw: number,
  pitch: number,
): Obb => {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  // Rotation about Y then about X, matching how the level builder orients
  // brushes. Columns of that product are the box's own axes.
  const axisX = vec3(cy, 0, -sy);
  const axisY = vec3(sy * sp, cp, cy * sp);
  const axisZ = vec3(sy * cp, -sp, cy * cp);

  const extentX =
    Math.abs(axisX.x) * halfExtents.x +
    Math.abs(axisY.x) * halfExtents.y +
    Math.abs(axisZ.x) * halfExtents.z;
  const extentY =
    Math.abs(axisX.y) * halfExtents.x +
    Math.abs(axisY.y) * halfExtents.y +
    Math.abs(axisZ.y) * halfExtents.z;
  const extentZ =
    Math.abs(axisX.z) * halfExtents.x +
    Math.abs(axisY.z) * halfExtents.y +
    Math.abs(axisZ.z) * halfExtents.z;

  return {
    center,
    halfExtents,
    axisX,
    axisY,
    axisZ,
    minX: center.x - extentX,
    minY: center.y - extentY,
    minZ: center.z - extentZ,
    maxX: center.x + extentX,
    maxY: center.y + extentY,
    maxZ: center.z + extentZ,
  };
};

/** An axis-aligned box, which is all a hitbox ever needs to be. */
export const makeAabb = (center: Vec3, halfExtents: Vec3): Obb =>
  makeObb(center, halfExtents, 0, 0);

/** Project a world point into the box's local frame. */
export const toLocal = (box: Obb, point: Vec3): Vec3 => {
  const dx = point.x - box.center.x;
  const dy = point.y - box.center.y;
  const dz = point.z - box.center.z;
  return vec3(
    dx * box.axisX.x + dy * box.axisX.y + dz * box.axisX.z,
    dx * box.axisY.x + dy * box.axisY.y + dz * box.axisY.z,
    dx * box.axisZ.x + dy * box.axisZ.y + dz * box.axisZ.z,
  );
};

/** Rotate a local direction back into world space. */
export const toWorldDirection = (box: Obb, local: Vec3): Vec3 =>
  vec3(
    box.axisX.x * local.x + box.axisY.x * local.y + box.axisZ.x * local.z,
    box.axisX.y * local.x + box.axisY.y * local.y + box.axisZ.y * local.z,
    box.axisX.z * local.x + box.axisY.z * local.y + box.axisZ.z * local.z,
  );

export interface RayBoxHit {
  distance: number;
  /** Outward surface normal in world space. */
  normal: Vec3;
}

/**
 * Ray against an oriented box, by the slab method in the box's own frame.
 * Returns the nearest forward intersection, or null.
 */
export const rayObb = (
  box: Obb,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
): RayBoxHit | null => {
  const localOrigin = toLocal(box, origin);
  // Direction is a vector, so it rotates without the translation.
  const localDirection = vec3(
    direction.x * box.axisX.x + direction.y * box.axisX.y + direction.z * box.axisX.z,
    direction.x * box.axisY.x + direction.y * box.axisY.y + direction.z * box.axisY.z,
    direction.x * box.axisZ.x + direction.y * box.axisZ.y + direction.z * box.axisZ.z,
  );

  let near = 0;
  let far = maxDistance;
  let axis = 0;
  let sign = 1;

  const origins = [localOrigin.x, localOrigin.y, localOrigin.z];
  const directions = [localDirection.x, localDirection.y, localDirection.z];
  const extents = [box.halfExtents.x, box.halfExtents.y, box.halfExtents.z];

  for (let i = 0; i < 3; i += 1) {
    const d = directions[i];
    const o = origins[i];
    const e = extents[i];
    if (Math.abs(d) < 1e-8) {
      // Parallel to this slab: a miss unless the ray already lies inside it.
      if (o < -e || o > e) return null;
      continue;
    }
    const inverse = 1 / d;
    let t1 = (-e - o) * inverse;
    let t2 = (e - o) * inverse;
    // The face the ray enters through is the one it is travelling toward, so
    // the outward normal there always opposes the direction of travel. This
    // does not flip when the two slab distances are swapped into order: a
    // downward ray enters a floor through its top face either way.
    const entrySign = d > 0 ? -1 : 1;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    if (t1 > near) {
      near = t1;
      axis = i;
      sign = entrySign;
    }
    if (t2 < far) far = t2;
    if (near > far) return null;
  }

  if (near < 0 || near > maxDistance) return null;
  const localNormal = vec3(axis === 0 ? sign : 0, axis === 1 ? sign : 0, axis === 2 ? sign : 0);
  return { distance: near, normal: toWorldDirection(box, localNormal) };
};

export interface Penetration {
  /** How deep the sphere is inside the box. */
  depth: number;
  /** Direction to push the sphere out, in world space. */
  normal: Vec3;
}

/**
 * Sphere against an oriented box.
 *
 * The capsule controller is sampled as a stack of spheres rather than solved
 * as a true capsule. With samples closer together than the radius there is no
 * gap to fall through, and the arithmetic stays short enough to run identically
 * on both sides of the wire.
 */
export const sphereObb = (box: Obb, center: Vec3, radius: number): Penetration | null => {
  const local = toLocal(box, center);
  const ex = box.halfExtents.x;
  const ey = box.halfExtents.y;
  const ez = box.halfExtents.z;

  const clampedX = Math.max(-ex, Math.min(ex, local.x));
  const clampedY = Math.max(-ey, Math.min(ey, local.y));
  const clampedZ = Math.max(-ez, Math.min(ez, local.z));

  const dx = local.x - clampedX;
  const dy = local.y - clampedY;
  const dz = local.z - clampedZ;
  const distanceSquared = dx * dx + dy * dy + dz * dz;

  if (distanceSquared > radius * radius) return null;

  if (distanceSquared > 1e-12) {
    const distance = Math.sqrt(distanceSquared);
    return {
      depth: radius - distance,
      normal: toWorldDirection(box, vec3(dx / distance, dy / distance, dz / distance)),
    };
  }

  // The centre is inside the box, so push out through the nearest face.
  const gapX = ex - Math.abs(local.x);
  const gapY = ey - Math.abs(local.y);
  const gapZ = ez - Math.abs(local.z);
  if (gapX <= gapY && gapX <= gapZ) {
    const sign = local.x >= 0 ? 1 : -1;
    return { depth: gapX + radius, normal: toWorldDirection(box, vec3(sign, 0, 0)) };
  }
  if (gapY <= gapZ) {
    const sign = local.y >= 0 ? 1 : -1;
    return { depth: gapY + radius, normal: toWorldDirection(box, vec3(0, sign, 0)) };
  }
  const sign = local.z >= 0 ? 1 : -1;
  return { depth: gapZ + radius, normal: toWorldDirection(box, vec3(0, 0, sign)) };
};
