import type { BoxBrush } from "../maps/types";
import type { CollisionWorld } from "./types";
import type { HitscanWorld, RayHit } from "./combat";
import { makeAabb, makeObb, rayObb, sphereObb, type Obb } from "./obb";
import { vec3, type Vec3 } from "./vec3";

/** A dynamic box the simulation can shoot but never collides with. */
export interface Hitbox {
  id: string;
  isHead: boolean;
  box: Obb;
}

export const BRUSH_WORLD = {
  /** Spheres sampled along the capsule. Spacing stays under the radius. */
  capsuleSamples: 5,
  /** Depenetration passes per move. */
  resolveIterations: 6,
  /** A surface this steep or shallower counts as ground. */
  groundNormalY: 0.6,
  /** Slack left when pushing out, so contact does not flicker. */
  skin: 0.0015,
  /** Displacement longer than this is split, so nothing tunnels. */
  maxSubstep: 0.2,
} as const;

/**
 * The level as plain geometry, with no engine behind it.
 *
 * This is the one collision and hitscan implementation, used by the client for
 * prediction and by the authoritative server for the real thing. Running two
 * implementations would guarantee they disagree somewhere, and every
 * disagreement between them surfaces as the player being yanked backwards.
 */
/**
 * A capsule moving through a BrushWorld.
 *
 * The controller is separate from the geometry because the server runs many
 * capsules against one level. Sharing the brush list keeps memory flat as
 * players join, and guarantees everyone is colliding with the same world.
 */
export class CapsuleController implements CollisionWorld {
  private position: Vec3 = vec3();
  private groundedFlag = false;

  constructor(
    private readonly world: BrushWorld,
    private radius = 0.38,
    private halfHeight = 0.9,
  ) {}

  setSize(radius: number, halfHeight: number): void {
    // Keep the feet planted when the stance changes, rather than letting the
    // collider grow through the floor or the ceiling.
    this.position.y += halfHeight - this.halfHeight;
    this.radius = radius;
    this.halfHeight = halfHeight;
  }

  getPosition(): Vec3 {
    return { ...this.position };
  }

  setPosition(position: Vec3): void {
    this.position = { ...position };
  }

  get grounded(): boolean {
    return this.groundedFlag;
  }

  move(displacement: Vec3): Vec3 {
    const before = { ...this.position };
    const length = Math.hypot(displacement.x, displacement.y, displacement.z);
    // Split a long move so a fast player cannot step straight through a wall.
    const steps = Math.max(1, Math.ceil(length / BRUSH_WORLD.maxSubstep));
    const inverse = 1 / steps;

    this.groundedFlag = false;
    for (let step = 0; step < steps; step += 1) {
      this.position.x += displacement.x * inverse;
      this.position.y += displacement.y * inverse;
      this.position.z += displacement.z * inverse;
      this.resolve();
    }

    return vec3(
      this.position.x - before.x,
      this.position.y - before.y,
      this.position.z - before.z,
    );
  }

  hasHeadroom(fromHalfHeight: number, toHalfHeight: number): boolean {
    const needed = toHalfHeight - fromHalfHeight;
    if (needed <= 0) return true;
    const origin = vec3(
      this.position.x,
      this.position.y + fromHalfHeight - this.radius,
      this.position.z,
    );
    return this.world.raycastSolids(origin, vec3(0, 1, 0), needed + this.radius + 0.05) === null;
  }

  /** Push the capsule out of anything it is inside. */
  private resolve(): void {
    const span = Math.max(0, this.halfHeight - this.radius);
    const count: number = BRUSH_WORLD.capsuleSamples;

    for (let pass = 0; pass < BRUSH_WORLD.resolveIterations; pass += 1) {
      let moved = false;

      for (let i = 0; i < count; i += 1) {
        // Derive the sample from the position as it stands right now. Caching
        // all five up front and pushing each one independently applies the
        // same correction several times over, which throws the capsule back
        // further than it ever came.
        const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
        const centre = vec3(this.position.x, this.position.y + span * t, this.position.z);

        let deepest: { depth: number; normal: Vec3 } | null = null;
        for (const box of this.world.solids) {
          if (!sphereNearBox(box, centre, this.radius)) continue;
          const hit = sphereObb(box, centre, this.radius);
          if (!hit || hit.depth <= 0) continue;
          if (!deepest || hit.depth > deepest.depth) deepest = hit;
        }
        if (!deepest) continue;

        const push = deepest.depth + BRUSH_WORLD.skin;
        this.position.x += deepest.normal.x * push;
        this.position.y += deepest.normal.y * push;
        this.position.z += deepest.normal.z * push;
        if (deepest.normal.y >= BRUSH_WORLD.groundNormalY) this.groundedFlag = true;
        moved = true;
      }

      if (!moved) return;
    }
  }
}

const sphereNearBox = (box: Obb, centre: Vec3, radius: number): boolean =>
  centre.x + radius >= box.minX &&
  centre.x - radius <= box.maxX &&
  centre.y + radius >= box.minY &&
  centre.y - radius <= box.maxY &&
  centre.z + radius >= box.minZ &&
  centre.z - radius <= box.maxZ;

export class BrushWorld implements HitscanWorld {
  readonly solids: Obb[] = [];
  private readonly hitboxes = new Map<string, Hitbox[]>();

  constructor(brushes: readonly BoxBrush[]) {
    for (const brush of brushes) {
      if (brush.solid === false) continue;
      this.solids.push(
        makeObb(
          vec3(brush.x, brush.y, brush.z),
          vec3(brush.width / 2, brush.height / 2, brush.depth / 2),
          brush.yaw ?? 0,
          brush.pitch ?? 0,
        ),
      );
    }
  }

  // --- Dynamic hitboxes -----------------------------------------------------

  /** Replace one combatant's hitboxes. Pass an empty list when they are down. */
  setHitboxes(id: string, boxes: { center: Vec3; halfExtents: Vec3; isHead: boolean }[]): void {
    if (boxes.length === 0) {
      this.hitboxes.delete(id);
      return;
    }
    this.hitboxes.set(
      id,
      boxes.map((entry) => ({
        id,
        isHead: entry.isHead,
        box: makeAabb(entry.center, entry.halfExtents),
      })),
    );
  }

  clearHitboxes(): void {
    this.hitboxes.clear();
  }

  /** A new capsule controller sharing this level's geometry. */
  createController(radius = 0.38, halfHeight = 0.9): CapsuleController {
    return new CapsuleController(this, radius, halfHeight);
  }

  // --- HitscanWorld ---------------------------------------------------------

  raycast(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    ignoreId: string | null = null,
  ): RayHit | null {
    let best: RayHit | null = null;

    const solid = this.raycastSolids(origin, direction, maxDistance);
    if (solid) best = solid;

    for (const [id, boxes] of this.hitboxes) {
      // The shooter's own hitboxes are transparent to their own rays: the eye
      // sits inside the head box, so otherwise every shot stops at the muzzle.
      if (ignoreId !== null && id === ignoreId) continue;
      for (const entry of boxes) {
        const limit = best ? best.distance : maxDistance;
        const hit = rayObb(entry.box, origin, direction, limit);
        if (!hit) continue;
        best = {
          distance: hit.distance,
          point: vec3(
            origin.x + direction.x * hit.distance,
            origin.y + direction.y * hit.distance,
            origin.z + direction.z * hit.distance,
          ),
          normal: hit.normal,
          targetId: id,
          headshot: entry.isHead,
        };
      }
    }

    return best;
  }

  raycastSolids(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null {
    let best: RayHit | null = null;
    for (const box of this.solids) {
      if (!segmentNearBox(box, origin, direction, best ? best.distance : maxDistance)) continue;
      const hit = rayObb(box, origin, direction, best ? best.distance : maxDistance);
      if (!hit) continue;
      best = {
        distance: hit.distance,
        point: vec3(
          origin.x + direction.x * hit.distance,
          origin.y + direction.y * hit.distance,
          origin.z + direction.z * hit.distance,
        ),
        normal: hit.normal,
        targetId: null,
        headshot: false,
      };
    }
    return best;
  }
}

/** Cheap rejection: does the ray's own bounding box overlap the brush's? */
const segmentNearBox = (
  box: Obb,
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
): boolean => {
  const endX = origin.x + direction.x * maxDistance;
  const endY = origin.y + direction.y * maxDistance;
  const endZ = origin.z + direction.z * maxDistance;
  return (
    Math.max(origin.x, endX) >= box.minX &&
    Math.min(origin.x, endX) <= box.maxX &&
    Math.max(origin.y, endY) >= box.minY &&
    Math.min(origin.y, endY) <= box.maxY &&
    Math.max(origin.z, endZ) >= box.minZ &&
    Math.min(origin.z, endZ) <= box.maxZ
  );
};
