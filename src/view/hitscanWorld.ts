import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { HitscanWorld, RayHit } from "../sim/combat";
import { vec3, type Vec3 } from "../sim/vec3";

/** Metadata the view attaches to meshes the simulation can damage. */
export interface DamageableMetadata {
  targetId: string;
  /** Head zones score a headshot multiplier. */
  isHead: boolean;
}

const readDamageable = (mesh: AbstractMesh): DamageableMetadata | null => {
  const metadata = mesh.metadata as { damageable?: DamageableMetadata } | null;
  return metadata?.damageable ?? null;
};

/**
 * Babylon-backed hitscan for the simulation.
 *
 * Rays test damageable meshes and level geometry together in one pick, so a
 * target standing behind a wall is correctly shielded by it: picking the
 * nearest hit of either kind is what makes cover mean anything.
 */
export class BabylonHitscanWorld implements HitscanWorld {
  private readonly origin = new Vector3();
  private readonly direction = new Vector3();
  private readonly ray = new Ray(new Vector3(), new Vector3(), 1);

  constructor(private readonly scene: Scene) {}

  raycast(
    origin: Vec3,
    direction: Vec3,
    maxDistance: number,
    ignoreId: string | null = null,
  ): RayHit | null {
    this.origin.set(origin.x, origin.y, origin.z);
    this.direction.set(direction.x, direction.y, direction.z);
    this.ray.origin = this.origin;
    this.ray.direction = this.direction;
    this.ray.length = maxDistance;

    const pick = this.scene.pickWithRay(this.ray, (mesh) => {
      if (!mesh.isPickable) return false;
      const damageable = readDamageable(mesh);
      // The shooter's own hitboxes are transparent to their own rays.
      if (damageable && ignoreId !== null && damageable.targetId === ignoreId) return false;
      return mesh.checkCollisions || damageable !== null;
    });
    if (!pick?.hit || !pick.pickedPoint) return null;

    const damageable = pick.pickedMesh ? readDamageable(pick.pickedMesh) : null;
    const normal = pick.getNormal(true) ?? new Vector3(0, 1, 0);

    return {
      distance: pick.distance,
      point: vec3(pick.pickedPoint.x, pick.pickedPoint.y, pick.pickedPoint.z),
      normal: vec3(normal.x, normal.y, normal.z),
      targetId: damageable?.targetId ?? null,
      headshot: damageable?.isHead ?? false,
    };
  }
}
