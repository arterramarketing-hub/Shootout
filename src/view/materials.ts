import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import type { SurfaceKind } from "../maps/types";

/**
 * Greybox palette. Flat, desaturated and value-separated so that geometry
 * reads clearly before any art exists. Hue is doing no work here; only
 * lightness separates the surfaces, which is what makes a greybox readable.
 */
const PALETTE: Record<SurfaceKind, { diffuse: string; specular: number }> = {
  floor: { diffuse: "#55585e", specular: 0.02 },
  wall: { diffuse: "#7c8087", specular: 0.02 },
  prop: { diffuse: "#9a8d76", specular: 0.03 },
  accent: { diffuse: "#464c54", specular: 0.05 },
  catwalk: { diffuse: "#696e76", specular: 0.04 },
};

export type MaterialSet = Record<SurfaceKind, StandardMaterial>;

export const createMaterials = (scene: Scene): MaterialSet => {
  const set = {} as MaterialSet;
  for (const [kind, config] of Object.entries(PALETTE) as [
    SurfaceKind,
    { diffuse: string; specular: number },
  ][]) {
    const material = new StandardMaterial(`mat_${kind}`, scene);
    const diffuse = Color3.FromHexString(config.diffuse);
    material.diffuseColor = diffuse;
    material.specularColor = new Color3(config.specular, config.specular, config.specular);
    // Ambient response is what lets the scene's ambient colour reach this
    // surface; leaving it black is why an unlit wall turns pure black.
    material.ambientColor = diffuse;
    // A little emissive keeps the darkest faces legible in a greybox, where
    // readability matters more than lighting realism.
    material.emissiveColor = diffuse.scale(0.05);
    // Materials are frozen because nothing about them changes at runtime;
    // this skips a per-frame dirty check on every draw.
    material.freeze();
    set[kind] = material;
  }
  return set;
};
