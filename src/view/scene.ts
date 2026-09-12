import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { QualitySettings } from "../engine/quality";
import type { BoxBrush, MapDefinition, SurfaceKind } from "../maps/types";
import { TEXEL_METRES, createMaterials } from "./materials";

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
  const style = map.style;
  const scene = new Scene(engine);
  const fog = Color3.FromHexString(style.fog);

  scene.clearColor = new Color4(fog.r * 0.5, fog.g * 0.5, fog.b * 0.55, 1);
  // Ambient lifts the shadowed side of every surface. Without it, vertical
  // walls facing away from the key light read as flat black, and a player
  // standing in one is invisible rather than merely hard to see.
  scene.ambientColor = Color3.FromHexString(style.ambient);
  // Nothing in the level animates or changes material, so let Babylon skip
  // the per-frame bookkeeping it would otherwise do for dynamic scenes.
  scene.blockMaterialDirtyMechanism = true;
  scene.skipPointerMovePicking = true;
  scene.autoClearDepthAndStencil = true;

  if (quality.fog) {
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = fog.scale(0.55);
    scene.fogStart = quality.viewDistance * 0.4;
    scene.fogEnd = quality.viewDistance;
  }

  buildLighting(scene, map);
  const staticMeshes = buildMap(scene, map, quality.tier === "high" ? 4 : 1);

  return { scene, staticMeshes };
};

const buildLighting = (scene: Scene, map: MapDefinition): void => {
  const style = map.style;

  // Two lights only. A hemispheric fill for shape, one directional for
  // direction. Real-time shadows stay off on every mobile tier.
  const fill = new HemisphericLight("fill", new Vector3(0.15, 1, 0.1), scene);
  fill.intensity = style.fillIntensity;
  fill.diffuse = Color3.FromHexString(style.skyLight);
  // A warm bounce from the floor keeps undersides from going dead.
  fill.groundColor = Color3.FromHexString(style.groundLight);
  fill.specular = new Color3(0.05, 0.05, 0.05);

  // The key is angled well off vertical so that walls, not just floors,
  // catch it and the geometry reads in three dimensions.
  const direction = style.keyDirection;
  const key = new DirectionalLight(
    "key",
    new Vector3(direction.x, direction.y, direction.z).normalize(),
    scene,
  );
  key.intensity = style.keyIntensity;
  key.diffuse = Color3.FromHexString(style.keyLight);
  key.specular = new Color3(0.16, 0.16, 0.16);
};

/**
 * UV rectangles for one box, scaled by its real size.
 *
 * Without this every face maps the texture zero to one, so a forty metre floor
 * and a one metre crate get the same single tile and the level reads as
 * stretched plastic. Scaling by world size gives one texel density everywhere.
 */
const faceUVs = (brush: BoxBrush): Vector4[] => {
  const u = (metres: number) => Math.max(0.25, metres / TEXEL_METRES);
  const width = u(brush.width);
  const height = u(brush.height);
  const depth = u(brush.depth);
  // Babylon's face order: back, front, right, left, top, bottom.
  return [
    new Vector4(0, 0, width, height),
    new Vector4(0, 0, width, height),
    new Vector4(0, 0, depth, height),
    new Vector4(0, 0, depth, height),
    new Vector4(0, 0, width, depth),
    new Vector4(0, 0, width, depth),
  ];
};

const buildMap = (scene: Scene, map: MapDefinition, anisotropy: number): Mesh[] => {
  const { materials } = createMaterials(scene, map.style, map.textureSeed, anisotropy);
  const byKind = new Map<SurfaceKind, Mesh[]>();

  for (const [index, brush] of map.brushes.entries()) {
    const mesh = MeshBuilder.CreateBox(
      `brush_${index}`,
      {
        width: brush.width,
        height: brush.height,
        depth: brush.depth,
        faceUV: faceUVs(brush),
        wrap: true,
      },
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
    // argument disposes the sources; the sixth keeps submeshes so culling
    // still works per-brush.
    const mesh = Mesh.MergeMeshes(meshes, true, true, undefined, false, true);
    if (!mesh) continue;
    mesh.name = `static_${kind}`;
    mesh.material = materials[kind];
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.createOrUpdateSubmeshesOctree(64, 2);
    merged.push(mesh);
  }

  scene.createOrUpdateSelectionOctree();
  return merged;
};
