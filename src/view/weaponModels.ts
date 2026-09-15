import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { WeaponId } from "../sim/weapons";
import { MODELS, type ModelSpec, type Part } from "./weaponGeometry";
import { DEFAULT_FINISH, type Finish } from "../sim/cosmetics";

/**
 * Greybox weapon viewmodels, built from primitives.
 *
 * The shapes themselves live in weaponGeometry, which has no engine import, so
 * the rule that the weapon must never cover the crosshair can be checked
 * against the same boxes this builds.
 *
 * These are original blocked-out shapes, not replicas: the job in Phase 1 is
 * a readable silhouette and a believable sight line, so that handling and
 * animation can be tuned before any art exists. Modelled assets land in
 * Phase 4 and drop straight into these transforms.
 */

const TONE_KEYS: Part["tone"][] = ["body", "metal", "accent"];

/** Lets the equipped finish repaint every weapon in place. */
export interface FinishPainter {
  apply(finish: Finish): void;
}

export interface WeaponModel {
  root: TransformNode;
  /** The shapes this was built from, which is what decides where it sits. */
  spec: ModelSpec;
  /** Local position of the sight, used to line up the aimed pose. */
  sight: { x: number; y: number; z: number };
  /** Where the muzzle flash sits. */
  muzzle: TransformNode;
}

export const createWeaponModels = (
  scene: Scene,
  layerMask: number,
): { models: Record<WeaponId, WeaponModel>; painter: FinishPainter } => {
  const materials = new Map<string, StandardMaterial>();
  for (const tone of TONE_KEYS) {
    const material = new StandardMaterial(`mat_vm_${tone}`, scene);
    material.specularColor = new Color3(0.12, 0.12, 0.13);
    material.specularPower = 48;
    materials.set(tone, material);
  }

  const painter: FinishPainter = {
    apply(finish) {
      for (const tone of TONE_KEYS) {
        const material = materials.get(tone);
        if (!material) continue;
        const colour = Color3.FromHexString(finish[tone]);
        // Materials are frozen for speed, so a repaint has to lift that first.
        material.unfreeze();
        material.diffuseColor = colour;
        material.ambientColor = colour;
        // The viewmodel is lit by its own rig, so it must not go black in shadow.
        material.emissiveColor = colour.scale(0.1);
        material.freeze();
      }
    },
  };
  painter.apply(DEFAULT_FINISH);

  const models = {} as Record<WeaponId, WeaponModel>;
  for (const [id, spec] of Object.entries(MODELS) as [WeaponId, ModelSpec][]) {
    const root = new TransformNode(`vm_${id}`, scene);
    const meshes: Mesh[] = [];
    for (const [index, part] of spec.parts.entries()) {
      const mesh = MeshBuilder.CreateBox(
        `vm_${id}_${index}`,
        { width: part.width, height: part.height, depth: part.depth },
        scene,
      );
      mesh.position.set(part.x, part.y, part.z);
      mesh.material = materials.get(part.tone)!;
      mesh.isPickable = false;
      mesh.layerMask = layerMask;
      mesh.parent = root;
      meshes.push(mesh);
    }

    const muzzle = new TransformNode(`vm_${id}_muzzle`, scene);
    muzzle.position.set(0, spec.muzzle.y, spec.muzzle.z);
    muzzle.parent = root;

    root.setEnabled(false);
    models[id] = { root, spec, sight: spec.sight, muzzle };
  }
  return { models, painter };
};
