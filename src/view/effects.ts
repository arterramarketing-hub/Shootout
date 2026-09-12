import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { PelletImpact } from "../sim/combat";
import type { Vec3 } from "../sim/vec3";

const TRACER_POOL = 24;
const IMPACT_POOL = 32;
const TRACER_LIFE = 0.055;
const IMPACT_LIFE = 2.4;

interface Pooled {
  mesh: Mesh;
  life: number;
}

/**
 * Shot feedback: muzzle flash, tracers and impact marks.
 *
 * Everything is pooled and allocated once. Creating meshes per shot would
 * stall on a phone at nine hundred rounds a minute, and the garbage it left
 * behind would show up as a hitch in the middle of a fight.
 */
export class ShotEffects {
  private readonly tracers: Pooled[] = [];
  private readonly impacts: Pooled[] = [];
  private tracerCursor = 0;
  private impactCursor = 0;

  private readonly tracerMaterial: StandardMaterial;
  private readonly impactMaterial: StandardMaterial;

  private readonly from = new Vector3();
  private readonly to = new Vector3();

  constructor(scene: Scene) {
    this.tracerMaterial = emissive(scene, "mat_tracer", "#ffd9a0", 0.9);
    this.impactMaterial = emissive(scene, "mat_impact", "#20242a", 0.0);
    this.impactMaterial.diffuseColor = Color3.FromHexString("#15181c");

    for (let i = 0; i < TRACER_POOL; i += 1) {
      const mesh = MeshBuilder.CreateBox(`tracer_${i}`, { size: 1 }, scene);
      mesh.material = this.tracerMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      mesh.rotationQuaternion = Quaternion.Identity();
      this.tracers.push({ mesh, life: 0 });
    }

    for (let i = 0; i < IMPACT_POOL; i += 1) {
      const mesh = MeshBuilder.CreatePlane(`impact_${i}`, { size: 0.12 }, scene);
      mesh.material = this.impactMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      mesh.rotationQuaternion = Quaternion.Identity();
      this.impacts.push({ mesh, life: 0 });
    }
  }

  /** Draw one pellet's path and, when it hit something, its impact mark. */
  addPellet(origin: Vec3, impact: PelletImpact): void {
    this.addTracer(origin, impact.point);
    if (impact.hit) this.addImpact(impact.point, impact.normal);
  }

  private addTracer(origin: Vec3, end: Vec3): void {
    const entry = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;

    this.from.set(origin.x, origin.y, origin.z);
    this.to.set(end.x, end.y, end.z);
    const delta = this.to.subtract(this.from);
    const length = delta.length();
    if (length < 1e-4) return;

    entry.mesh.position.copyFrom(this.from.add(delta.scale(0.5)));
    entry.mesh.scaling.set(0.012, 0.012, length);
    // Point the stretched box down the path of the round.
    const direction = delta.scale(1 / length);
    entry.mesh.rotationQuaternion = Quaternion.FromLookDirectionLH(direction, Vector3.Up());
    entry.mesh.setEnabled(true);
    entry.life = TRACER_LIFE;
  }

  private addImpact(point: Vec3, normal: Vec3): void {
    const entry = this.impacts[this.impactCursor];
    this.impactCursor = (this.impactCursor + 1) % this.impacts.length;

    const surfaceNormal = new Vector3(normal.x, normal.y, normal.z);
    if (surfaceNormal.lengthSquared() < 1e-6) surfaceNormal.set(0, 1, 0);
    surfaceNormal.normalize();
    // Lift the mark clear of the surface, or it fights the wall for depth.
    entry.mesh.position.set(
      point.x + surfaceNormal.x * 0.006,
      point.y + surfaceNormal.y * 0.006,
      point.z + surfaceNormal.z * 0.006,
    );
    const reference = Math.abs(surfaceNormal.y) > 0.95 ? Vector3.Forward() : Vector3.Up();
    entry.mesh.rotationQuaternion = Quaternion.FromLookDirectionLH(
      surfaceNormal.scale(-1),
      reference,
    );
    entry.mesh.setEnabled(true);
    entry.life = IMPACT_LIFE;
  }

  update(deltaSeconds: number): void {
    for (const entry of this.tracers) {
      if (entry.life <= 0) continue;
      entry.life -= deltaSeconds;
      if (entry.life <= 0) entry.mesh.setEnabled(false);
    }
    for (const entry of this.impacts) {
      if (entry.life <= 0) continue;
      entry.life -= deltaSeconds;
      if (entry.life <= 0) entry.mesh.setEnabled(false);
    }
  }
}

const emissive = (
  scene: Scene,
  name: string,
  hex: string,
  glow: number,
): StandardMaterial => {
  const material = new StandardMaterial(name, scene);
  const colour = Color3.FromHexString(hex);
  material.diffuseColor = colour;
  material.emissiveColor = colour.scale(glow);
  material.specularColor = Color3.Black();
  material.disableLighting = glow > 0.5;
  material.freeze();
  return material;
};
