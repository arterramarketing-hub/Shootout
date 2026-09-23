import "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { ColorCurves } from "@babylonjs/core/Materials/colorCurves";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { SpotLight } from "@babylonjs/core/Lights/spotLight";
import { WORLD_LAYER } from "./viewmodel";
import { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Scene } from "@babylonjs/core/scene";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import type { QualitySettings } from "../engine/quality";
import type { MapDefinition, SurfaceKind } from "../maps/types";
import { brushGeometry } from "./brushGeometry";
import { TEXEL_METRES, createMaterialLibrary } from "./materials";
import { buildSky } from "./sky";

export interface BuiltScene {
  scene: Scene;
  /** One merged mesh per surface kind. Keeps the draw call count in single digits. */
  staticMeshes: Mesh[];
  /** The sun, for anything that wants to hang shadows off it. */
  key: DirectionalLight;
  /** The survivor's torch, on a night map; hung off the camera by the caller. */
  torch: SpotLight | null;
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
  // Under mist the fog is the sky: anything the far plane cuts off must
  // vanish into the same colour it was already fading into.
  const sky = style.mist
    ? fog
    : style.sky
      ? Color3.FromHexString(style.sky)
      : fog.scale(0.5);
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

  if (style.mist) {
    // Always on, whatever the tier: it is what makes the short far plane
    // invisible, and what the level's mood is made of.
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = style.mist;
    scene.fogColor = fog;
  } else if (quality.fog) {
    scene.fogMode = Scene.FOGMODE_LINEAR;
    // Fog fades into the sky where there is one, so a distant roofline
    // dissolves into blue rather than into a grey that the sky is not.
    scene.fogColor = style.sky ? fog : fog.scale(0.55);
    scene.fogStart = quality.viewDistance * 0.45;
    scene.fogEnd = quality.viewDistance;
  }

  const key = buildLighting(scene, map);
  // Built before the level's materials, which are frozen once made and only
  // ever know the lights that existed when they compiled.
  const torch = style.night ? buildTorch(scene) : null;
  gradeImage(scene, map);
  // Anisotropy is close to free on a GPU and expensive without one, so it
  // rides with the rest of the settings a strong machine gets.
  const staticMeshes = buildMap(scene, map, quality.tier === "high" ? 4 : 1);
  buildSky(scene, style, quality, map.textureSeed);

  return { scene, staticMeshes, key, torch };
};

/**
 * A torch, for the dark.
 *
 * One spot light, warm, a little wider than the view is tall, reaching as
 * far as the mist lets anything be seen. It lights the level and whatever
 * is walking in it, and not the weapon: that has its own light and its own
 * camera, and a torch held behind it would only burn it out.
 */
const buildTorch = (scene: Scene): SpotLight => {
  const torch = new SpotLight("torch", Vector3.Zero(), new Vector3(0, 0, 1), 1.25, 1, scene);
  // A soft edge: full strength inside the inner cone, fading to nothing at
  // the outer one, rather than a hard disc on the wall.
  torch.innerAngle = 0.5;
  torch.diffuse = Color3.FromHexString("#fff0d2");
  torch.specular = new Color3(0.25, 0.23, 0.2);
  torch.intensity = 2.6;
  torch.range = 36;
  torch.includeOnlyWithLayerMask = WORLD_LAYER;
  return torch;
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
  grade.exposure = map.style.exposure ?? (map.style.sky ? 1.40 : 1.06);
  grade.contrast = 1.14;
  grade.vignetteEnabled = true;
  // A vignette is a frame, not a mood. At seven tenths it was doing the work
  // of the lighting: pulling the edges of every shot down until the level
  // read as dim wherever the player looked. Enough to settle the corners.
  grade.vignetteWeight = 0.45;
  grade.vignetteStretch = 0.5;
  grade.vignetteColor = new Color4(0.08, 0.06, 0.05, 0);
  grade.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
  const curves = new ColorCurves();
  // Nothing here was ever more saturated than a dusty brick, and the grade
  // was then taking a further eighth of what there was. Desaturating a
  // palette that is already washed out is how a level ends up the colour of
  // nothing at all.
  curves.globalSaturation = 0;
  curves.shadowsSaturation = -4;
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
export const addSunShadows = (
  built: BuiltScene,
  camera: Camera,
  quality: QualitySettings,
): CascadedShadowGenerator => {
  const { scene, key, staticMeshes: meshes } = built;
  // A middling phone gets the same shadows at half the map and the cheaper
  // filter. Half a shadow map is a quarter of the pixels, which is most of
  // what the tier below could not afford; the shadows are softer and a
  // little coarser and they are still shadows.
  const high = quality.tier === "high";
  const generator = new CascadedShadowGenerator(high ? 1024 : 512, key, false, camera);
  generator.numCascades = 2;
  generator.lambda = 0.85;
  generator.shadowMaxZ = high ? 90 : 55;
  generator.stabilizeCascades = true;
  generator.usePercentageCloserFiltering = true;
  generator.filteringQuality = high
    ? CascadedShadowGenerator.QUALITY_MEDIUM
    : CascadedShadowGenerator.QUALITY_LOW;
  generator.bias = 0.004;
  generator.normalBias = high ? 0.03 : 0.05;
  // A shadow outdoors is not an absence of light, it is the sky instead of
  // the sun. Left at nothing, the key is switched off entirely inside one
  // and half a sunlit street goes to black; a third of it left on is what
  // keeps a player standing in shadow a player rather than a silhouette.
  generator.setDarkness(0.34);
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

/**
 * Bloom, on the things that are actually giving off light.
 *
 * Babylon's glow layer redraws only the emissive part of the scene into a
 * buffer of its own, blurs it and adds it back, so the cost is the size of
 * that buffer and has nothing to do with how big the level is. Two hundred
 * and fifty-six pixels square is plenty, because what it is blurring is a
 * tracer two pixels wide and the sparks off an impact, and the whole point
 * of the pass is that the result is soft.
 *
 * It is bound to the world camera. The weapon is drawn by a second camera
 * with its own five-metre far plane, and its muzzle flash is already the
 * brightest thing on the screen for the frame and a half it exists; running
 * a second blur over it would buy nothing.
 *
 * The level's own surfaces are kept out of it. Every one of them carries a
 * little emissive so that unlit corners stay readable rather than going
 * black, and a bloom pass over a whole wall of that is not a light, it is a
 * fog. What is left glowing is what is meant to: rounds in flight, what they
 * hit, and the plates.
 */
export const addGlow = (built: BuiltScene, camera: Camera): GlowLayer => {
  const glow = new GlowLayer("glow", built.scene, {
    mainTextureFixedSize: 256,
    blurKernelSize: 24,
    camera,
  });
  glow.intensity = 0.62;
  for (const mesh of built.staticMeshes) glow.addExcludedMesh(mesh);
  return glow;
};

/**
 * How far the hemispheric fill leans off vertical, as a tangent.
 *
 * Far enough that a wall side-on to the sun and the wall opposite it are
 * plainly different colours; short enough that the floor is still the
 * brightest thing in the level and the sky is still overhead.
 */
const FILL_LEAN = 0.46;

const buildLighting = (scene: Scene, map: MapDefinition): DirectionalLight => {
  const style = map.style;

  const direction = new Vector3(
    style.keyDirection.x,
    style.keyDirection.y,
    style.keyDirection.z,
  ).normalize();

  // Two lights only. A hemispheric fill for shape, one directional for
  // direction. Its shadows are added below, on the one tier that can afford
  // them.
  //
  // The fill leans off vertical, across the sun rather than with it. Upright
  // with a sun this steep, three of the five ways a face can point come out
  // at the same value: the wall the sun misses and both walls side-on to it
  // all sit at the midpoint of the hemisphere, so a corner between two of
  // them disappears. Leaning the fill across the sun gives those two side
  // walls the sky and the ground respectively, which separates them from
  // each other by a good part of the fill's whole range, and does it
  // without taking anything off the two the sun has already sorted out.
  const across = new Vector3(-direction.z, 0, direction.x);
  if (across.lengthSquared() > 1e-6) across.normalize();
  const fill = new HemisphericLight(
    "fill",
    new Vector3(across.x * FILL_LEAN, 1, across.z * FILL_LEAN),
    scene,
  );
  fill.intensity = style.fillIntensity;
  fill.diffuse = Color3.FromHexString(style.skyLight);
  // A warm bounce from the floor keeps undersides from going dead.
  fill.groundColor = Color3.FromHexString(style.groundLight);
  fill.specular = new Color3(0.05, 0.05, 0.05);

  // The key is angled well off vertical so that walls, not just floors,
  // catch it and the geometry reads in three dimensions.
  const key = new DirectionalLight("key", direction, scene);
  key.intensity = style.keyIntensity;
  key.diffuse = Color3.FromHexString(style.keyLight);
  key.specular = new Color3(0.16, 0.16, 0.16);
  return key;
};

const buildMap = (
  scene: Scene,
  map: MapDefinition,
  anisotropy: number,
): Mesh[] => {
  const library = createMaterialLibrary(scene, map.style, map.textureSeed, anisotropy);
  // Bucketed by kind and tint together: a zone's coloured brushes still merge
  // with each other, so colour-coding costs one draw call per colour used
  // rather than one per brush.
  const buckets = new Map<string, { kind: SurfaceKind; tint?: string; meshes: Mesh[] }>();

  for (const [index, brush] of map.brushes.entries()) {
    // Collision only: the edge of an open map, where the city carries on
    // past the point anybody may walk to.
    if (brush.hidden) continue;
    const mesh = new Mesh(`brush_${index}`, scene);
    const geometry = brushGeometry(brush, TEXEL_METRES);
    const data = new VertexData();
    data.positions = geometry.positions;
    data.normals = geometry.normals;
    data.uvs = geometry.uvs;
    data.colors = geometry.colors;
    data.indices = geometry.indices;
    data.applyToMesh(mesh);
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
