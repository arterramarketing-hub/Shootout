import "@babylonjs/core/Collisions/collisionCoordinator";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { CollisionWorld } from "../sim/types";
import { vec3, type Vec3 } from "../sim/vec3";

/**
 * Babylon-backed implementation of the simulation's collision interface.
 *
 * Babylon's built-in ellipsoid collider is used rather than a full physics
 * engine: a character controller needs swept sliding against static geometry
 * and nothing else, and skipping a physics library keeps the bundle small and
 * the step cost predictable on a phone.
 */
export class BabylonCollisionWorld implements CollisionWorld {
  private readonly collider: Mesh;
  private readonly before = new Vector3();
  private readonly displacement = new Vector3();

  constructor(
    private readonly scene: Scene,
    radius: number,
    halfHeight: number,
  ) {
    this.collider = MeshBuilder.CreateBox("player_collider", { size: 0.1 }, scene);
    this.collider.isVisible = false;
    this.collider.isPickable = false;
    this.collider.checkCollisions = false;
    this.collider.ellipsoid = new Vector3(radius, halfHeight, radius);
    this.collider.ellipsoidOffset = Vector3.Zero();
  }

  setSize(radius: number, halfHeight: number): void {
    const previous = this.collider.ellipsoid.y;
    this.collider.ellipsoid.set(radius, halfHeight, radius);
    // Shrinking the collider must not drop the player through the floor, and
    // growing it must not push them into the ceiling: keep the feet planted.
    this.collider.position.y += halfHeight - previous;
  }

  move(displacement: Vec3): Vec3 {
    this.before.copyFrom(this.collider.position);
    this.displacement.set(displacement.x, displacement.y, displacement.z);
    this.collider.moveWithCollisions(this.displacement);
    return vec3(
      this.collider.position.x - this.before.x,
      this.collider.position.y - this.before.y,
      this.collider.position.z - this.before.z,
    );
  }

  getPosition(): Vec3 {
    const position = this.collider.position;
    return vec3(position.x, position.y, position.z);
  }

  setPosition(position: Vec3): void {
    this.collider.position.set(position.x, position.y, position.z);
  }

  hasHeadroom(fromHalfHeight: number, toHalfHeight: number): boolean {
    const needed = toHalfHeight - fromHalfHeight;
    if (needed <= 0) return true;
    const origin = this.collider.position.add(new Vector3(0, fromHalfHeight, 0));
    const ray = new Ray(origin, Vector3.Up(), needed + 0.05);
    const hit = this.scene.pickWithRay(ray, (mesh) => mesh.checkCollisions);
    return !(hit?.hit ?? false);
  }
}
