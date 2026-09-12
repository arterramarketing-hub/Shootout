import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { QualitySettings } from "../engine/quality";
import type { MapDefinition, SurfaceKind } from "../maps/types";
import { createMaterials } from "./materials";

export interface BuiltScene {
  scene: Scene;
  /** One merged mesh per surface kind. Keeps the draw call count in single digits. */
  staticMeshes: Mesh[];
}

export const createScene = (
  engine: AbstractEngine,
  map: MapDefinition,
  quality: QualitySettings,
): BuiltScene => {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.06, 0.07, 1);
  // Ambient lifts the shadowed side of every surface. Without it, vertical
  // walls facing away from the key light read as flat black.
  scene.ambientColor = new Color3(0.26, 0.27, 0.3);
  scene.collisionsEnabled = true;
  // Gravity is integrated in the simulation, not by the scene.
  scene.gravity = Vector3.Zero();
  // Nothing in the greybox animates or changes material, so let Babylon skip
  // the per-frame bookkeeping it would otherwise do for dynamic scenes.
  scene.blockMaterialDirtyMechanism = true;
  scene.skipPointerMovePicking = true;
  scene.autoClearDepthAndStencil = true;

  if (quality.fog) {
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.07, 0.08, 0.09);
    scene.fogStart = quality.viewDistance * 0.35;
    scene.fogEnd = quality.viewDistance;
  }

  buildLighting(scene);
  const staticMeshes = buildMap(scene, map);

  return { scene, staticMeshes };
};

const buildLighting = (scene: Scene): void => {
  // Two lights only. A hemispheric fill for shape, one directional for
  // direction. Real-time shadows stay off on every mobile tier.
  const fill = new HemisphericLight("fill", new Vector3(0.2, 1, 0.15), scene);
  fill.intensity = 0.58;
  fill.diffuse = new Color3(0.86, 0.9, 0.98);
  // A warm bounce from the floor keeps undersides from going dead.
  fill.groundColor = new Color3(0.42, 0.39, 0.36);
  fill.specular = new Color3(0.05, 0.05, 0.05);

  // The key is angled well off vertical so that walls, not just floors,
  // catch it and the geometry reads in three dimensions.
  const key = new DirectionalLight("key", new Vector3(-0.55, -0.7, 0.45), scene);
  key.intensity = 0.52;
  key.diffuse = new Color3(1.0, 0.96, 0.88);
  key.specular = new Color3(0.08, 0.08, 0.08);
};

const buildMap = (scene: Scene, map: MapDefinition): Mesh[] => {
  const materials = createMaterials(scene);
  const byKind = new Map<SurfaceKind, Mesh[]>();

  for (const [index, brush] of map.brushes.entries()) {
    const mesh = MeshBuilder.CreateBox(
      `brush_${index}`,
      { width: brush.width, height: brush.height, depth: brush.depth },
      scene,
    );
    mesh.position.set(brush.x, brush.y, brush.z);
    mesh.rotation.set(brush.pitch ?? 0, brush.yaw ?? 0, 0);
    const bucket = byKind.get(brush.kind);
    if (bucket) bucket.push(mesh);
    else byKind.set(brush.kind, [mesh]);
  }

  const merged: Mesh[] = [];
  for (const [kind, meshes] of byKind) {
    // Merging collapses every brush of a kind into one draw call. The third
    // argument disposes the sources; the fifth keeps submeshes so collision
    // and culling still work per-brush.
    const mesh = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
    if (!mesh) continue;
    mesh.name = `static_${kind}`;
    mesh.material = materials[kind];
    mesh.checkCollisions = true;
    mesh.isPickable = true;
    mesh.freezeWorldMatrix();
    // An octree turns collision from a scan of every triangle into a local
    // lookup, which is the difference between 60 fps and a stutter on a phone.
    mesh.createOrUpdateSubmeshesOctree(64, 2);
    merged.push(mesh);
  }

  scene.createOrUpdateSelectionOctree();
  return merged;
};
