import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { MapStyle, SurfaceKind } from "../maps/types";
import { createTextures, type SurfaceTextureId, type TextureSet } from "./textures";

/**
 * Which generated texture dresses each kind of surface, and how shiny it is.
 *
 * Keeping this mapping separate from the level data means a new map changes
 * its whole look by changing colours, without touching a single brush.
 */
const SURFACES: Record<SurfaceKind, { texture: SurfaceTextureId; specular: number; power: number }> = {
  floor: { texture: "concrete", specular: 0.03, power: 16 },
  wall: { texture: "panel", specular: 0.05, power: 24 },
  prop: { texture: "crate", specular: 0.04, power: 20 },
  accent: { texture: "metal", specular: 0.14, power: 48 },
  catwalk: { texture: "grate", specular: 0.1, power: 40 },
  hazard: { texture: "hazard", specular: 0.06, power: 24 },
};

/**
 * One texture repeat per this many metres, so texel density stays even.
 * Three metres keeps wall panels reading as panels; at one or two the seams
 * repeat often enough that a wall looks like bathroom tile.
 */
export const TEXEL_METRES = 3;

export type MaterialSet = Record<SurfaceKind, StandardMaterial>;

export const createMaterials = (
  scene: Scene,
  style: MapStyle,
  seed: number,
  anisotropy = 1,
): { materials: MaterialSet; textures: TextureSet } => {
  const textures = createTextures(scene, style, seed, anisotropy);
  const set = {} as MaterialSet;

  for (const [kind, config] of Object.entries(SURFACES) as [
    SurfaceKind,
    (typeof SURFACES)[SurfaceKind],
  ][]) {
    const material = new StandardMaterial(`mat_${kind}`, scene);
    material.diffuseTexture = textures[config.texture];
    // Ambient response is what lets the scene's ambient colour reach this
    // surface; leaving it black is why an unlit wall turns pure black.
    material.ambientTexture = textures[config.texture];
    material.ambientColor = new Color3(1, 1, 1);
    material.specularColor = new Color3(config.specular, config.specular, config.specular);
    material.specularPower = config.power;
    material.useAlphaFromDiffuseTexture = false;
    // Materials are frozen because nothing about them changes at runtime;
    // this skips a per-frame dirty check on every draw.
    material.freeze();
    set[kind] = material;
  }
  return { materials: set, textures };
};
