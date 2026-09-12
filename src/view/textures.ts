import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Surface textures, drawn at load rather than downloaded.
 *
 * Every pattern here is generated from noise and simple shapes. That keeps the
 * download at zero bytes of art, lets each map carry its own palette by
 * passing different colours through the same generators, and means the game
 * ships without depending on anyone else's texture library.
 */

export type SurfaceTextureId =
  | "concrete"
  | "panel"
  | "crate"
  | "metal"
  | "grate"
  | "hazard";

export interface TexturePalette {
  /** Base colour each generator tints toward. */
  concrete: string;
  panel: string;
  crate: string;
  metal: string;
  grate: string;
  hazard: string;
  /** Second hazard colour, for the stripes. */
  hazardStripe: string;
}

/** A small deterministic generator, so a map looks the same every load. */
const makeRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const SIZE = 256;

/** Scatter fine grain over whatever has already been drawn. */
const speckle = (
  context: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  alpha: number,
  maxRadius: number,
): void => {
  for (let i = 0; i < count; i += 1) {
    const shade = Math.floor(random() * 255);
    context.fillStyle = `rgba(${shade},${shade},${shade},${alpha})`;
    const radius = random() * maxRadius + 0.4;
    context.beginPath();
    context.arc(random() * SIZE, random() * SIZE, radius, 0, Math.PI * 2);
    context.fill();
  }
};

/** Soft blotches, which is what stops a flat fill reading as plastic. */
const blotches = (
  context: CanvasRenderingContext2D,
  random: () => number,
  count: number,
  colour: string,
  maxRadius: number,
): void => {
  for (let i = 0; i < count; i += 1) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    const radius = random() * maxRadius + maxRadius * 0.3;
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, colour);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
};

type Painter = (
  context: CanvasRenderingContext2D,
  palette: TexturePalette,
  random: () => number,
) => void;

const PAINTERS: Record<SurfaceTextureId, Painter> = {
  concrete: (context, palette, random) => {
    context.fillStyle = palette.concrete;
    context.fillRect(0, 0, SIZE, SIZE);
    blotches(context, random, 26, "rgba(0,0,0,0.055)", 52);
    blotches(context, random, 14, "rgba(255,255,255,0.035)", 40);
    speckle(context, random, 2600, 0.05, 1.3);
    // Expansion joints, which give a floor its sense of scale.
    context.strokeStyle = "rgba(0,0,0,0.16)";
    context.lineWidth = 1.4;
    context.beginPath();
    context.moveTo(0, SIZE / 2);
    context.lineTo(SIZE, SIZE / 2);
    context.moveTo(SIZE / 2, 0);
    context.lineTo(SIZE / 2, SIZE);
    context.stroke();
  },

  panel: (context, palette, random) => {
    context.fillStyle = palette.panel;
    context.fillRect(0, 0, SIZE, SIZE);
    blotches(context, random, 16, "rgba(0,0,0,0.05)", 46);
    speckle(context, random, 1200, 0.035, 1);
    // One seam across the middle of each axis, drawn softly. Strong seams at
    // a tight repeat are what make a wall read as tile rather than panelling.
    const step = SIZE / 2;
    for (let i = 0; i <= SIZE; i += step) {
      context.fillStyle = "rgba(0,0,0,0.12)";
      context.fillRect(0, i, SIZE, 1.4);
      context.fillRect(i, 0, 1.4, SIZE);
      context.fillStyle = "rgba(255,255,255,0.04)";
      context.fillRect(0, i + 1.4, SIZE, 1);
      context.fillRect(i + 1.4, 0, 1, SIZE);
    }
    // A little vertical shading, so large walls are not one flat value.
    const shade = context.createLinearGradient(0, 0, 0, SIZE);
    shade.addColorStop(0, "rgba(255,255,255,0.05)");
    shade.addColorStop(1, "rgba(0,0,0,0.09)");
    context.fillStyle = shade;
    context.fillRect(0, 0, SIZE, SIZE);
    // Fixings at the corners of each panel.
    context.fillStyle = "rgba(0,0,0,0.22)";
    for (const x of [step * 0.25, step * 0.75, step * 1.25, step * 1.75]) {
      for (const y of [step * 0.25, step * 0.75, step * 1.25, step * 1.75]) {
        context.beginPath();
        context.arc(x, y, 1.8, 0, Math.PI * 2);
        context.fill();
      }
    }
  },

  crate: (context, palette, random) => {
    context.fillStyle = palette.crate;
    context.fillRect(0, 0, SIZE, SIZE);
    // Slats, with grain running along them.
    const slats = 5;
    const height = SIZE / slats;
    for (let i = 0; i < slats; i += 1) {
      const shade = 0.04 + random() * 0.05;
      context.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
      context.fillRect(0, i * height, SIZE, height);
      context.fillStyle = "rgba(0,0,0,0.22)";
      context.fillRect(0, i * height, SIZE, 1.5);
      context.fillStyle = "rgba(255,255,255,0.05)";
      context.fillRect(0, i * height + 1.5, SIZE, 1);
    }
    context.strokeStyle = "rgba(0,0,0,0.07)";
    context.lineWidth = 1;
    for (let i = 0; i < 70; i += 1) {
      const y = random() * SIZE;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(SIZE / 3, y + random() * 4 - 2, (SIZE * 2) / 3, y + random() * 4 - 2, SIZE, y);
      context.stroke();
    }
    // Banding straps across the box.
    context.fillStyle = "rgba(0,0,0,0.26)";
    context.fillRect(SIZE * 0.18, 0, 5, SIZE);
    context.fillRect(SIZE * 0.78, 0, 5, SIZE);
  },

  metal: (context, palette, random) => {
    context.fillStyle = palette.metal;
    context.fillRect(0, 0, SIZE, SIZE);
    // Brushed streaks along one axis.
    for (let i = 0; i < 900; i += 1) {
      const y = random() * SIZE;
      const alpha = random() * 0.05;
      context.fillStyle = random() > 0.5
        ? `rgba(255,255,255,${alpha.toFixed(3)})`
        : `rgba(0,0,0,${alpha.toFixed(3)})`;
      context.fillRect(0, y, SIZE, random() * 1.6 + 0.4);
    }
    blotches(context, random, 8, "rgba(0,0,0,0.07)", 44);
  },

  grate: (context, palette, random) => {
    context.fillStyle = palette.grate;
    context.fillRect(0, 0, SIZE, SIZE);
    // An open grid, drawn as shadow rather than as holes, since the mesh is solid.
    const cell = SIZE / 8;
    context.fillStyle = "rgba(0,0,0,0.42)";
    for (let i = 0; i < 8; i += 1) {
      for (let j = 0; j < 8; j += 1) {
        context.fillRect(i * cell + cell * 0.2, j * cell + cell * 0.2, cell * 0.6, cell * 0.6);
      }
    }
    context.fillStyle = "rgba(255,255,255,0.08)";
    for (let i = 0; i <= 8; i += 1) {
      context.fillRect(i * cell - 1, 0, 2, SIZE);
      context.fillRect(0, i * cell - 1, SIZE, 2);
    }
    speckle(context, random, 400, 0.05, 1);
  },

  hazard: (context, palette, random) => {
    context.fillStyle = palette.hazard;
    context.fillRect(0, 0, SIZE, SIZE);
    // Diagonal warning stripes, scuffed so they do not look printed.
    context.save();
    context.fillStyle = palette.hazardStripe;
    context.translate(SIZE / 2, SIZE / 2);
    context.rotate(-Math.PI / 4);
    context.translate(-SIZE, -SIZE);
    const band = SIZE / 5;
    for (let i = 0; i < 12; i += 1) {
      if (i % 2 === 0) context.fillRect(0, i * band, SIZE * 2, band);
    }
    context.restore();
    blotches(context, random, 18, "rgba(0,0,0,0.14)", 40);
    speckle(context, random, 900, 0.06, 1.2);
  },
};

export type TextureSet = Record<SurfaceTextureId, Texture>;

/** Draw every surface texture for one palette. */
export const createTextures = (
  scene: Scene,
  palette: TexturePalette,
  seed = 1337,
  anisotropy = 1,
): TextureSet => {
  const set = {} as TextureSet;
  let offset = 0;
  for (const [id, paint] of Object.entries(PAINTERS) as [SurfaceTextureId, Painter][]) {
    const texture = new DynamicTexture(
      `tex_${id}`,
      { width: SIZE, height: SIZE },
      scene,
      true,
    );
    const context = texture.getContext() as unknown as CanvasRenderingContext2D;
    paint(context, palette, makeRandom(seed + offset));
    offset += 7919;
    texture.update();
    // Wrapping is what lets one small texture cover a forty metre floor.
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    // Anisotropy is close to free on a GPU and expensive without one, so it
    // follows the quality tier rather than being fixed.
    texture.anisotropicFilteringLevel = anisotropy;
    set[id] = texture;
  }
  return set;
};
