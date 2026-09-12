import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { WeaponId } from "../sim/weapons";

/**
 * Greybox weapon viewmodels, built from primitives.
 *
 * These are original blocked-out shapes, not replicas: the job in Phase 1 is
 * a readable silhouette and a believable sight line, so that handling and
 * animation can be tuned before any art exists. Modelled assets land in
 * Phase 4 and drop straight into these transforms.
 */

interface Part {
  /** Local offset from the weapon's grip, in metres. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  tone: "body" | "metal" | "accent";
}

interface ModelSpec {
  parts: Part[];
  /**
   * Where the sight sits. Aiming lines this point up with the screen centre,
   * which is what makes the transition read as looking down the weapon.
   */
  sight: { x: number; y: number; z: number };
  /** Where the muzzle flash sits, at the front of the barrel. */
  muzzle: { y: number; z: number };
}

/**
 * Local space runs from the rear of the receiver forward.
 *
 * No shoulder stock is modelled. On a real weapon it sits against the
 * shooter, which in first person means behind the camera, and modelling it
 * only puts geometry a few centimetres from the near plane where perspective
 * blows it up until it covers the screen.
 */
const MODELS: Record<WeaponId, ModelSpec> = {
  ar: {
    parts: [
      { x: 0, y: 0.012, z: 0.17, width: 0.062, height: 0.085, depth: 0.34, tone: "body" },
      { x: 0, y: 0.004, z: 0.40, width: 0.050, height: 0.055, depth: 0.16, tone: "accent" },
      { x: 0, y: 0.030, z: 0.46, width: 0.032, height: 0.032, depth: 0.26, tone: "metal" },
      { x: 0, y: -0.105, z: 0.15, width: 0.046, height: 0.17, depth: 0.10, tone: "accent" },
      { x: 0, y: -0.072, z: 0.02, width: 0.044, height: 0.13, depth: 0.10, tone: "body" },
      { x: 0, y: 0.072, z: 0.30, width: 0.018, height: 0.030, depth: 0.026, tone: "metal" },
    ],
    sight: { x: 0, y: 0.078, z: 0.30 },
    muzzle: { y: 0.030, z: 0.60 },
  },
  smg: {
    parts: [
      { x: 0, y: 0.010, z: 0.13, width: 0.058, height: 0.078, depth: 0.26, tone: "body" },
      { x: 0, y: 0.026, z: 0.33, width: 0.028, height: 0.028, depth: 0.14, tone: "metal" },
      { x: 0, y: -0.118, z: 0.12, width: 0.040, height: 0.20, depth: 0.072, tone: "accent" },
      { x: 0, y: -0.068, z: 0.01, width: 0.042, height: 0.12, depth: 0.098, tone: "body" },
      { x: 0, y: 0.066, z: 0.22, width: 0.016, height: 0.026, depth: 0.024, tone: "metal" },
    ],
    sight: { x: 0, y: 0.072, z: 0.22 },
    muzzle: { y: 0.026, z: 0.41 },
  },
  shotgun: {
    parts: [
      { x: 0, y: 0.010, z: 0.18, width: 0.060, height: 0.078, depth: 0.34, tone: "body" },
      { x: 0, y: 0.032, z: 0.52, width: 0.040, height: 0.040, depth: 0.34, tone: "metal" },
      { x: 0, y: -0.032, z: 0.44, width: 0.068, height: 0.052, depth: 0.15, tone: "accent" },
      { x: 0, y: -0.068, z: 0.03, width: 0.044, height: 0.12, depth: 0.10, tone: "body" },
      { x: 0, y: 0.060, z: 0.64, width: 0.015, height: 0.022, depth: 0.022, tone: "metal" },
    ],
    sight: { x: 0, y: 0.064, z: 0.64 },
    muzzle: { y: 0.032, z: 0.70 },
  },
  pistol: {
    parts: [
      { x: 0, y: 0.020, z: 0.08, width: 0.040, height: 0.062, depth: 0.20, tone: "metal" },
      { x: 0, y: -0.004, z: 0.19, width: 0.028, height: 0.028, depth: 0.06, tone: "metal" },
      { x: 0, y: -0.088, z: 0.0, width: 0.038, height: 0.15, depth: 0.082, tone: "accent" },
      { x: 0, y: 0.056, z: 0.15, width: 0.013, height: 0.019, depth: 0.019, tone: "metal" },
    ],
    sight: { x: 0, y: 0.058, z: 0.15 },
    muzzle: { y: -0.004, z: 0.23 },
  },
};

const TONES: Record<Part["tone"], string> = {
  body: "#33383f",
  metal: "#23272c",
  accent: "#4a3e31",
};

export interface WeaponModel {
  root: TransformNode;
  /** Local position of the sight, used to line up the aimed pose. */
  sight: { x: number; y: number; z: number };
  /** Where the muzzle flash sits. */
  muzzle: TransformNode;
}

export const createWeaponModels = (
  scene: Scene,
  layerMask: number,
): Record<WeaponId, WeaponModel> => {
  const materials = new Map<string, StandardMaterial>();
  for (const [tone, hex] of Object.entries(TONES)) {
    const material = new StandardMaterial(`mat_vm_${tone}`, scene);
    const colour = Color3.FromHexString(hex);
    material.diffuseColor = colour;
    material.ambientColor = colour;
    material.specularColor = new Color3(0.12, 0.12, 0.13);
    material.specularPower = 48;
    // The viewmodel is lit by its own rig, so it must not go black in shadow.
    material.emissiveColor = colour.scale(0.1);
    material.freeze();
    materials.set(tone, material);
  }

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
    models[id] = { root, sight: spec.sight, muzzle };
  }
  return models;
};
