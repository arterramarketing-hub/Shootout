import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { TargetPlacement } from "../maps/types";
import { createTarget, type TargetState } from "../sim/targets";
import type { DamageableMetadata } from "./hitscanWorld";

/**
 * A practice plate: a body board and a smaller head board on a post, the
 * shape every live-fire range uses. Original geometry, built from primitives.
 */
const BODY = { width: 0.52, height: 0.95, depth: 0.06, centre: 1.02 };
const HEAD = { width: 0.24, height: 0.26, depth: 0.06, centre: 1.63 };
const POST = { diameter: 0.07, height: 0.55 };

export interface TargetBinding {
  state: TargetState;
  /** Pivots at the base so the plate folds backwards when hit. */
  pivot: TransformNode;
  body: Mesh;
  head: Mesh;
}

export class TargetField {
  readonly bindings: TargetBinding[] = [];
  private readonly plateMaterial: StandardMaterial;
  private readonly headMaterial: StandardMaterial;
  private readonly postMaterial: StandardMaterial;
  private readonly plateBase: Color3;
  private readonly headBase: Color3;

  constructor(
    private readonly scene: Scene,
    placements: readonly TargetPlacement[],
  ) {
    this.plateBase = Color3.FromHexString("#c4713f");
    this.headBase = Color3.FromHexString("#d89a4e");

    this.plateMaterial = new StandardMaterial("mat_target_body", scene);
    this.plateMaterial.diffuseColor = this.plateBase;
    this.plateMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
    this.plateMaterial.ambientColor = this.plateBase;

    this.headMaterial = new StandardMaterial("mat_target_head", scene);
    this.headMaterial.diffuseColor = this.headBase;
    this.headMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
    this.headMaterial.ambientColor = this.headBase;

    this.postMaterial = new StandardMaterial("mat_target_post", scene);
    this.postMaterial.diffuseColor = Color3.FromHexString("#3c4149");
    this.postMaterial.specularColor = new Color3(0.05, 0.05, 0.05);
    this.postMaterial.freeze();

    for (const placement of placements) this.build(placement);
  }

  private build(placement: TargetPlacement): void {
    const pivot = new TransformNode(`target_${placement.id}`, this.scene);
    pivot.position.set(placement.x, placement.y, placement.z);
    pivot.rotation.y = placement.yaw;

    const post = MeshBuilder.CreateCylinder(
      `target_post_${placement.id}`,
      { diameter: POST.diameter, height: POST.height, tessellation: 8 },
      this.scene,
    );
    post.position.y = POST.height / 2;
    post.material = this.postMaterial;
    post.isPickable = false;
    post.parent = pivot;

    const body = MeshBuilder.CreateBox(
      `target_body_${placement.id}`,
      { width: BODY.width, height: BODY.height, depth: BODY.depth },
      this.scene,
    );
    body.position.y = BODY.centre;
    body.material = this.plateMaterial;
    body.parent = pivot;

    const head = MeshBuilder.CreateBox(
      `target_head_${placement.id}`,
      { width: HEAD.width, height: HEAD.height, depth: HEAD.depth },
      this.scene,
    );
    head.position.y = HEAD.centre;
    head.material = this.headMaterial;
    head.parent = pivot;

    // The metadata is what the hitscan layer reads to award damage.
    const bodyMeta: DamageableMetadata = { targetId: placement.id, isHead: false };
    const headMeta: DamageableMetadata = { targetId: placement.id, isHead: true };
    body.metadata = { damageable: bodyMeta };
    head.metadata = { damageable: headMeta };

    this.bindings.push({ state: createTarget(placement.id), pivot, body, head });
  }

  get states(): TargetState[] {
    return this.bindings.map((binding) => binding.state);
  }

  findState(id: string): TargetState | undefined {
    return this.bindings.find((binding) => binding.state.id === id)?.state;
  }

  /** Push simulation state into the scene. */
  render(): void {
    let anyFlash = 0;
    for (const binding of this.bindings) {
      // Fold backwards about the base rather than sinking into the floor.
      binding.pivot.rotation.x = binding.state.knockdown * (Math.PI / 2) * 0.92;
      const down = binding.state.down;
      binding.body.isPickable = !down;
      binding.head.isPickable = !down;
      anyFlash = Math.max(anyFlash, binding.state.flash);
    }
    // One shared material means one flash for all plates; with six targets on
    // screen that is cheaper than a material each and reads the same.
    const flash = anyFlash;
    this.plateMaterial.emissiveColor = this.plateBase.scale(0.06 + flash * 0.9);
    this.headMaterial.emissiveColor = this.headBase.scale(0.06 + flash * 0.9);
  }
}
