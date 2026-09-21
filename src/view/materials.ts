import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { MapStyle, SurfaceKind } from "../maps/types";
import {
  createReliefMaps,
  createTextures,
  type SurfaceTextureId,
  type TextureLevels,
  type TextureSet,
} from "./textures";

/**
 * Which generated texture dresses each kind of surface, and how shiny it is.
 *
 * Keeping this mapping separate from the level data means a new map changes
 * its whole look by changing colours, without touching a single brush.
 */
/**
 * How far a tint may be scaled up when it is divided through its texture.
 *
 * A tint much lighter than the surface it sits on would push the texture's
 * bright speckle past white, and a surface with its highlights clipped off
 * has no grain left. Two and a half covers every tint any map asks for.
 */
const TINT_CEILING = 2.5;

const SURFACES: Record<SurfaceKind, { texture: SurfaceTextureId; specular: number; power: number }> = {
  floor: { texture: "concrete", specular: 0.03, power: 16 },
  wall: { texture: "panel", specular: 0.05, power: 24 },
  prop: { texture: "crate", specular: 0.04, power: 20 },
  accent: { texture: "metal", specular: 0.14, power: 48 },
  catwalk: { texture: "grate", specular: 0.1, power: 40 },
  hazard: { texture: "hazard", specular: 0.06, power: 24 },
  brick: { texture: "brick", specular: 0.02, power: 12 },
  frame: { texture: "frame", specular: 0.03, power: 14 },
  cladding: { texture: "cladding", specular: 0.18, power: 40 },
  spandrel: { texture: "spandrel", specular: 0.05, power: 20 },
  asphalt: { texture: "asphalt", specular: 0.02, power: 10 },
  rubble: { texture: "rubble", specular: 0.02, power: 10 },
  foliage: { texture: "foliage", specular: 0.0, power: 8 },
  graffiti: { texture: "graffiti", specular: 0.04, power: 18 },
};

/**
 * One texture repeat per this many metres, so texel density stays even.
 * Three metres keeps wall panels reading as panels; at one or two the seams
 * repeat often enough that a wall looks like bathroom tile.
 */
export const TEXEL_METRES = 3;

export type MaterialSet = Record<SurfaceKind, StandardMaterial>;

/** Hands out one material per surface kind and tint, making each on demand. */
export interface MaterialLibrary {
  /** `tint` is a hex string; omitting it gives the surface's plain material. */
  get(kind: SurfaceKind, tint?: string): StandardMaterial;
  textures: TextureSet;
}

export const createMaterials = (
  scene: Scene,
  style: MapStyle,
  seed: number,
  anisotropy = 1,
  relief = false,
): { materials: MaterialSet; textures: TextureSet; levels: TextureLevels } => {
  const { textures, levels } = createTextures(scene, style, seed, anisotropy);
  const reliefs = relief ? createReliefMaps(scene, textures, anisotropy) : {};
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
    // Relief is what lets a light find the shape of a surface rather than
    // just its colour: mortar courses take a shadow, a grating reads as
    // holes, asphalt roughens up underfoot.
    const bump = reliefs[config.texture];
    if (bump) material.bumpTexture = bump;
    material.useAlphaFromDiffuseTexture = false;
    // Materials are frozen because nothing about them changes at runtime;
    // this skips a per-frame dirty check on every draw.
    material.freeze();
    set[kind] = material;
  }
  return { materials: set, textures, levels };
};

/**
 * A library that adds tinted variants of the base materials as maps ask for
 * them.
 *
 * A tint multiplies the generated texture rather than replacing it, so a zone
 * takes on a colour while keeping the concrete, panelling or grating it is
 * made of. Variants are cached by kind and tint because the merge step asks
 * for the same one once per bucket.
 *
 * What the tint is multiplied by is the tint divided through the texture's
 * own average, not the tint itself. The texture is already painted in the
 * palette's colour for that surface, so multiplying a colour straight into
 * it compounds the two: a brick written as a dusty red arrived at half the
 * lightness, and every tinted surface in the level was darker and greyer
 * than anyone had chosen. Dividing first means a tint comes out as the
 * colour it says, with the texture supplying the grain and the grime around
 * it rather than a second helping of darkness.
 */
export const createMaterialLibrary = (
  scene: Scene,
  style: MapStyle,
  seed: number,
  anisotropy = 1,
  relief = false,
): MaterialLibrary => {
  const { materials, textures, levels } = createMaterials(
    scene,
    style,
    seed,
    anisotropy,
    relief,
  );
  const variants = new Map<string, StandardMaterial>();

  return {
    textures,
    get(kind, tint) {
      if (!tint) return materials[kind];
      const key = `${kind}|${tint}`;
      const existing = variants.get(key);
      if (existing) return existing;

      const base = materials[kind];
      const material = new StandardMaterial(`mat_${kind}_${tint.replace("#", "")}`, scene);
      material.diffuseTexture = base.diffuseTexture;
      material.ambientTexture = base.ambientTexture;
      material.bumpTexture = base.bumpTexture;
      // Divided through the texture's own average, so what lands on screen
      // is the tint rather than the tint times the palette. Held under a
      // ceiling because a tint far lighter than the surface it is painted on
      // would otherwise drive the texture's bright speckle past white and
      // flatten the grain it was asked to keep.
      const level = levels[SURFACES[kind].texture];
      const wanted = Color3.FromHexString(tint);
      const scaled = new Color3(
        Math.min(TINT_CEILING, wanted.r / level.r),
        Math.min(TINT_CEILING, wanted.g / level.g),
        Math.min(TINT_CEILING, wanted.b / level.b),
      );
      material.ambientColor = scaled;
      // diffuseColor multiplies the texture, which is what keeps the surface
      // reading as the material it is made of rather than as flat paint.
      material.diffuseColor = scaled;
      material.specularColor = base.specularColor.clone();
      material.specularPower = base.specularPower;
      material.useAlphaFromDiffuseTexture = false;
      material.freeze();
      variants.set(key, material);
      return material;
    },
  };
};
