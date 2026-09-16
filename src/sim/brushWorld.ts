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
  private groundNormalValue: Vec3 | null = null;

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

  groundNormal(): Vec3 | null {
    return this.groundNormalValue;
  }

  move(displacement: Vec3): Vec3 {
    const before = { ...this.position };
    const length = Math.hypot(displacement.x, displacement.y, displacement.z);
    // Split a long move so a fast player cannot step straight through a wall.
    const steps = Math.max(1, Math.ceil(length / BRUSH_WORLD.maxSubstep));
    const inverse = 1 / steps;

    this.groundedFlag = false;
    this.groundNormalValue = null;
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
        for (const box of this.world.solidsNear(centre, this.radius)) {
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
        if (deepest.normal.y >= BRUSH_WORLD.groundNormalY) {
          this.groundedFlag = true;
          this.groundNormalValue = deepest.normal;
        }
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

/**
 * Size of a broadphase cell, in metres.
 *
 * A few times the largest thing that moves. Smaller cells put a long wall
 * into hundreds of them; larger ones hand every query most of the level.
 */
const CELL = 4;

export class BrushWorld implements HitscanWorld {
  readonly solids: Obb[] = [];
  private readonly hitboxes = new Map<string, Hitbox[]>();
  /**
   * Which solids overlap each column of the level, on a grid over the ground.
   *
   * A level made of a few dozen boxes could afford to test every one of them
   * against every ray and every capsule. A building with a frame — columns,
   * beams, spandrels, rail — runs to several hundred, and the server resolves
   * a dozen capsules against all of it sixty times a second. Bucketing by
   * ground cell means a query only ever sees what is actually near it.
   */
  private readonly cells = new Map<number, number[]>();
  /** Scratch for deduplicating a query's results without allocating. */
  private readonly stamp: Uint32Array;
  private query = 0;
  private readonly scratch: Obb[] = [];

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
    this.stamp = new Uint32Array(this.solids.length);
    for (const [index, box] of this.solids.entries()) {
      for (let cx = cellOf(box.minX); cx <= cellOf(box.maxX); cx += 1) {
        for (let cz = cellOf(box.minZ); cz <= cellOf(box.maxZ); cz += 1) {
          const key = cellKey(cx, cz);
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(index);
          else this.cells.set(key, [index]);
        }
      }
    }
  }

  /** Every solid that could touch a sphere. A superset, never a subset. */
  solidsNear(centre: Vec3, radius: number): readonly Obb[] {
    this.beginQuery();
    for (let cx = cellOf(centre.x - radius); cx <= cellOf(centre.x + radius); cx += 1) {
      for (let cz = cellOf(centre.z - radius); cz <= cellOf(centre.z + radius); cz += 1) {
        this.gather(cx, cz);
      }
    }
    return this.scratch;
  }

  private beginQuery(): void {
    this.query += 1;
    this.scratch.length = 0;
  }

  private gather(cx: number, cz: number): void {
    const bucket = this.cells.get(cellKey(cx, cz));
    if (!bucket) return;
    for (const index of bucket) {
      if (this.stamp[index] === this.query) continue;
      this.stamp[index] = this.query;
      this.scratch.push(this.solids[index]);
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
    const consider = (box: Obb): void => {
      if (!segmentNearBox(box, origin, direction, best ? best.distance : maxDistance)) return;
      const hit = rayObb(box, origin, direction, best ? best.distance : maxDistance);
      if (!hit) return;
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
    };

    // Walk the ground cells the ray passes over, nearest first, and stop as
    // soon as the nearest hit so far is closer than the next cell: nothing
    // beyond it can beat it.
    this.beginQuery();
    let cx = cellOf(origin.x);
    let cz = cellOf(origin.z);
    const endX = cellOf(origin.x + direction.x * maxDistance);
    const endZ = cellOf(origin.z + direction.z * maxDistance);
    const stepX = direction.x > 0 ? 1 : direction.x < 0 ? -1 : 0;
    const stepZ = direction.z > 0 ? 1 : direction.z < 0 ? -1 : 0;
    // Distance along the ray to the next cell boundary on each axis, and the
    // distance one whole cell costs.
    const deltaX = stepX === 0 ? Infinity : Math.abs(CELL / direction.x);
    const deltaZ = stepZ === 0 ? Infinity : Math.abs(CELL / direction.z);
    let nextX =
      stepX === 0
        ? Infinity
        : ((stepX > 0 ? (cx + 1) * CELL : cx * CELL) - origin.x) / direction.x;
    let nextZ =
      stepZ === 0
        ? Infinity
        : ((stepZ > 0 ? (cz + 1) * CELL : cz * CELL) - origin.z) / direction.z;

    for (let guard = 0; guard < 4096; guard += 1) {
      this.gather(cx, cz);
      for (const box of this.scratch) consider(box);
      this.scratch.length = 0;

      const entry = Math.min(nextX, nextZ);
      if (entry > maxDistance) break;
      if (best !== null && (best as RayHit).distance <= entry) break;
      if (cx === endX && cz === endZ) break;
      if (nextX < nextZ) {
        cx += stepX;
        nextX += deltaX;
      } else {
        cz += stepZ;
        nextZ += deltaZ;
      }
    }
    return best;
  }
}

const cellOf = (value: number): number => Math.floor(value / CELL);

/** One integer per cell, for a Map that must not allocate a string a query. */
const cellKey = (cx: number, cz: number): number => (cx + 32768) * 65536 + (cz + 32768);

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
