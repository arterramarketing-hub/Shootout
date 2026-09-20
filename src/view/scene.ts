import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { QualitySettings } from "../engine/quality";
import type { BoxBrush, MapDefinition, SurfaceKind } from "../maps/types";
import { TEXEL_METRES, createMaterialLibrary } from "./materials";
import { buildSky } from "./sky";

export interface BuiltScene {
  scene: Scene;
  /** One merged mesh per surface kind. Keeps the draw call count in single digits. */
  staticMeshes: Mesh[];
  /** The sun, for anything that wants to hang shadows off it. */
  key: DirectionalLight;
}

export const createScene = (
  engine: AbstractEngine,
  map: MapDefinition,
  quality: QualitySettings,
): BuiltScene => {
  const style = map.style;
  const scene = new Scene(engine);
  const fog = Color3.FromHexString(style.fog);

  // The sky is whatever is drawn where the level is not. An interior wants
  // the fog's own darkness there; a street wants a sky.
  const sky = style.sky ? Color3.FromHexString(style.sky) : fog.scale(0.5);
  scene.clearColor = new Color4(sky.r, sky.g, sky.b, 1);
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
    // Fog fades into the sky where there is one, so a distant roofline
    // dissolves into blue rather than into a grey that the sky is not.
    scene.fogColor = style.sky ? fog : fog.scale(0.55);
    scene.fogStart = quality.viewDistance * 0.4;
    scene.fogEnd = quality.viewDistance;
  }

  const key = buildLighting(scene, map);
  gradeImage(scene, map);
  // Relief costs a second texture and a heavier shader on every surface, so
  // it rides with the rest of the settings a strong machine gets.
  const detailed = quality.tier === "high";
  const staticMeshes = buildMap(scene, map, detailed ? 4 : 1, detailed);
  buildSky(scene, style, quality, map.textureSeed);

  return { scene, staticMeshes, key };
};

/**
 * The grade: what makes a scene read as one world rather than a set of
 * materials that happen to share a room.
 *
 * Tone mapping so the sun can be bright without the brick going to a flat
 * orange, a touch more contrast, a little less saturation across the board,
 * and a soft vignette. All of it runs in the material shaders rather than as
 * a post-process, so it costs nothing on a phone. Interiors get the same
 * treatment: consistency is the point.
 */
const gradeImage = (scene: Scene, map: MapDefinition): void => {
  const grade = scene.imageProcessingConfiguration;
  // No tone mapping: these materials are not high-dynamic-range inputs, and
  // a filmic curve only pulls a sunlit street down into murk to make room
  // for highlights it will never be given.
  grade.toneMappingEnabled = false;
  grade.exposure = map.style.sky ? 1.08 : 1.0;
  grade.contrast = 1.06;
  grade.vignetteEnabled = true;
  grade.vignetteWeight = 0.7;
  grade.vignetteStretch = 0.5;
  grade.vignetteColor = new Color4(0.08, 0.06, 0.05, 0);
  grade.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  const curves = new ColorCurves();
  curves.globalSaturation = -12;
  curves.shadowsSaturation = -10;
  curves.highlightsHue = 40;
  curves.highlightsSaturation = 6;
  grade.colorCurvesEnabled = true;
  grade.colorCurves = curves;
};

/**
 * Sun shadows, on the tier that can afford them.
 *
 * Shadow is what makes a frame read as a frame: without it a column in front
 * of a wall and a column painted on it are the same picture. Cascaded so the
 * near cascade can afford to be sharp across a street and the far one only
 * has to be there. Only the level casts and receives; the weapon has its own
 * camera, and everything that moves is cheap enough to leave unlit rather
 * than redraw the shadow map for.
 *
 * Takes the camera it is fitted to, and it must be the world camera: the
 * weapon renders through a second one whose far plane is five metres, and a
 * cascade fitted to that frustum shadows nothing the player can see. It is a
 * constructor argument rather than a property set afterward, because setting
 * it afterward rebuilds the shadow map and quietly drops every caster added
 * before.
 */
export const addSunShadows = (built: BuiltScene, camera: Camera): CascadedShadowGenerator => {
  const { scene, key, staticMeshes: meshes } = built;
  const generator = new CascadedShadowGenerator(1024, key, false, camera);
  generator.numCascades = 2;
  generator.lambda = 0.85;
  generator.shadowMaxZ = 90;
  generator.stabilizeCascades = true;
  generator.usePercentageCloserFiltering = true;
  generator.filteringQuality = CascadedShadowGenerator.QUALITY_MEDIUM;
  generator.bias = 0.004;
  generator.normalBias = 0.03;
  for (const mesh of meshes) {
    generator.addShadowCaster(mesh, false);
    mesh.receiveShadows = true;
  }
  // The level's materials were frozen before shadows existed. Thaw and
  // refreeze so the next compile sees the receivers.
  for (const material of scene.materials) {
    if (!material.isFrozen) continue;
    material.unfreeze();
    material.freeze();
  }
  return generator;
};

const buildLighting = (scene: Scene, map: MapDefinition): DirectionalLight => {
  const style = map.style;

  // Two lights only. A hemispheric fill for shape, one directional for
  // direction. Its shadows are added below, on the one tier that can afford
  // them.
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
  return key;
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

const buildMap = (
  scene: Scene,
  map: MapDefinition,
  anisotropy: number,
  relief: boolean,
): Mesh[] => {
  const library = createMaterialLibrary(scene, map.style, map.textureSeed, anisotropy, relief);
  // Bucketed by kind and tint together: a zone's coloured brushes still merge
  // with each other, so colour-coding costs one draw call per colour used
  // rather than one per brush.
  const buckets = new Map<string, { kind: SurfaceKind; tint?: string; meshes: Mesh[] }>();

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
    const key = `${brush.kind}|${brush.tint ?? ""}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.meshes.push(mesh);
    else buckets.set(key, { kind: brush.kind, tint: brush.tint, meshes: [mesh] });
  }

  const merged: Mesh[] = [];
  for (const [key, bucket] of buckets) {
    // Merging collapses every brush in a bucket into one draw call. The third
    // argument disposes the sources; the sixth keeps submeshes so culling
    // still works per-brush.
    const mesh = Mesh.MergeMeshes(bucket.meshes, true, true, undefined, false, true);
    if (!mesh) continue;
    mesh.name = `static_${key.replace("|", "_")}`;
    mesh.material = library.get(bucket.kind, bucket.tint);
    mesh.checkCollisions = false;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.createOrUpdateSubmeshesOctree(64, 2);
    merged.push(mesh);
  }

  scene.createOrUpdateSelectionOctree();
  return merged;
};
