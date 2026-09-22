import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import type { SurfaceTextureId, TexturePalette } from "./textures";

/**
 * Painted textures, for the retro look.
 *
 * These are not the modern textures shrunk. Shrinking was the mistake: the
 * modern set is photographic — fields of speckle, grime blotches, dust
 * passes — and photographic detail at sixty-four texels is not a period
 * texture, it is mush. The era these are after had an artist draw every
 * tile by hand at this size, and what they drew is nothing like grime.
 *
 * Four rules, taken from what those tiles actually did:
 *
 * Flat colour. A brick is one colour, not a cloud of forty. Areas read
 * because they are areas.
 *
 * A drawn edge. Every motif has a dark line on one side and a light line on
 * the other — a painted bevel, the cheapest way to say "this brick stands
 * proud of the mortar" when you have no normal map and no per-pixel light.
 * It is the single most recognisable thing about the look.
 *
 * Big motifs. A brick is sixteen texels across, not four. Detail that does
 * not survive to the screen was never worth the texels.
 *
 * Deliberate irregularity. Not noise — chosen variation. Every fourth brick
 * a different shade, one plank darker than its neighbours, a crack drawn
 * where a crack would be. Noise reads as dirt; variation reads as painted.
 *
 * They are drawn at their own size rather than shrunk, so every line is one
 * texel wide and lands where it was put.
 */

/** Texels across one repeat. Big enough for a brick to be a brick. */
export const RETRO_TEXTURE_SIZE = 64;

/** A small deterministic generator, so a surface looks the same every load. */
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

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

/** A colour the painters can lighten, darken and saturate. */
class Paint {
  constructor(
    readonly r: number,
    readonly g: number,
    readonly b: number,
  ) {}

  static of(hex: string): Paint {
    const value = parseInt(hex.replace("#", ""), 16);
    return new Paint((value >> 16) & 255, (value >> 8) & 255, value & 255);
  }

  /** Toward white above one, toward black below. */
  shade(factor: number): Paint {
    if (factor >= 1) {
      const t = Math.min(1, factor - 1);
      return new Paint(
        this.r + (255 - this.r) * t,
        this.g + (255 - this.g) * t,
        this.b + (255 - this.b) * t,
      );
    }
    return new Paint(this.r * factor, this.g * factor, this.b * factor);
  }

  /** Push the channels away from the colour's own lightness. */
  vivid(factor: number): Paint {
    const lum = this.r * 0.299 + this.g * 0.587 + this.b * 0.114;
    return new Paint(
      lum + (this.r - lum) * factor,
      lum + (this.g - lum) * factor,
      lum + (this.b - lum) * factor,
    );
  }

  css(): string {
    return `rgb(${clampByte(this.r)},${clampByte(this.g)},${clampByte(this.b)})`;
  }
}

/**
 * How much more colourful a painted texture is than the palette it comes
 * from. The palette was chosen for a washed-out modern grade; the era it is
 * being redrawn for had no such reservations.
 */
const VIVID = 1.55;

type Context = CanvasRenderingContext2D;

const fill = (context: Context, colour: Paint): void => {
  context.fillStyle = colour.css();
  context.fillRect(0, 0, RETRO_TEXTURE_SIZE, RETRO_TEXTURE_SIZE);
};

/**
 * A block with a painted bevel: lit along the top and left, shaded along
 * the bottom and right.
 *
 * This is the primitive nearly everything below is built from. A brick, a
 * paving stone, a plank, a metal panel and a crate slat are all this with
 * different numbers.
 */
const plate = (
  context: Context,
  x: number,
  y: number,
  width: number,
  height: number,
  colour: Paint,
  lit = 1.3,
  shaded = 0.72,
): void => {
  context.fillStyle = colour.css();
  context.fillRect(x, y, width, height);
  context.fillStyle = colour.shade(lit).css();
  context.fillRect(x, y, width, 1);
  context.fillRect(x, y, 1, height);
  context.fillStyle = colour.shade(shaded).css();
  context.fillRect(x, y + height - 1, width, 1);
  context.fillRect(x + width - 1, y, 1, height);
};

/** A drawn line, one texel wide, wrapped at the edges. */
const scratch = (
  context: Context,
  x: number,
  y: number,
  dx: number,
  dy: number,
  length: number,
  colour: string,
): void => {
  context.fillStyle = colour;
  for (let i = 0; i < length; i += 1) {
    const px = Math.round(x + dx * i) % RETRO_TEXTURE_SIZE;
    const py = Math.round(y + dy * i) % RETRO_TEXTURE_SIZE;
    context.fillRect((px + RETRO_TEXTURE_SIZE) % RETRO_TEXTURE_SIZE, (py + RETRO_TEXTURE_SIZE) % RETRO_TEXTURE_SIZE, 1, 1);
  }
};

type RetroPainter = (context: Context, palette: TexturePalette, random: () => number) => void;

const S = RETRO_TEXTURE_SIZE;

const PAINTERS: Record<SurfaceTextureId, RetroPainter> = {
  /** Paving: big slabs with a drawn joint and a chipped corner or two. */
  concrete: (context, palette, random) => {
    const base = Paint.of(palette.concrete).vivid(VIVID);
    fill(context, base.shade(0.7));
    const half = S / 2;
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        // Every slab a slightly different age, chosen rather than noised.
        const age = [1, 0.92, 1.06, 0.96][(row * 2 + column) % 4];
        plate(context, column * half + 1, row * half + 1, half - 2, half - 2, base.shade(age));
      }
    }
    // Cracks, drawn where a slab would crack: from an edge, inward.
    context.fillStyle = base.shade(0.55).css();
    for (let i = 0; i < 3; i += 1) {
      const x = Math.floor(random() * S);
      const y = Math.floor(random() * S);
      scratch(context, x, y, random() < 0.5 ? 1 : 0.4, random() < 0.5 ? 0.4 : 1, 5 + random() * 7, base.shade(0.55).css());
    }
  },

  /** Sheet panelling: tall panels, a rivet at each corner. */
  panel: (context, palette) => {
    const base = Paint.of(palette.panel).vivid(VIVID);
    fill(context, base.shade(0.62));
    const wide = S / 2;
    for (let column = 0; column < 2; column += 1) {
      plate(context, column * wide + 1, 1, wide - 2, S - 2, base.shade(column === 0 ? 1 : 0.94));
      context.fillStyle = base.shade(1.45).css();
      for (const y of [5, S - 6]) {
        context.fillRect(column * wide + 4, y, 2, 2);
        context.fillRect(column * wide + wide - 6, y, 2, 2);
      }
    }
  },

  /** Crate: planks with a drawn grain and an iron band. */
  crate: (context, palette, random) => {
    const base = Paint.of(palette.crate).vivid(VIVID);
    fill(context, base.shade(0.5));
    const planks = 4;
    const height = S / planks;
    for (let i = 0; i < planks; i += 1) {
      plate(context, 1, i * height + 1, S - 2, height - 2, base.shade([1, 0.9, 1.05, 0.95][i]));
      // Grain: two long lines along the plank, not a field of noise.
      const grain = base.shade(0.74).css();
      for (let g = 0; g < 2; g += 1) {
        const y = i * height + 3 + Math.floor(random() * (height - 5));
        scratch(context, 2 + random() * 8, y, 1, 0, S - 8, grain);
      }
    }
    // The band across the middle, which is what says crate rather than floor.
    const iron = Paint.of("#4b4640");
    plate(context, 0, S / 2 - 3, S, 6, iron, 1.5, 0.6);
  },

  /** Plate steel: big panels, a weld line, a rivet row. */
  metal: (context, palette) => {
    const base = Paint.of(palette.metal).vivid(VIVID);
    fill(context, base.shade(0.6));
    plate(context, 1, 1, S - 2, S / 2 - 2, base);
    plate(context, 1, S / 2 + 1, S - 2, S / 2 - 2, base.shade(0.93));
    context.fillStyle = base.shade(1.5).css();
    for (let x = 4; x < S - 2; x += 8) context.fillRect(x, S / 2 - 3, 2, 2);
  },

  /** Grating: a drawn lattice with the dark underneath showing through. */
  grate: (context, palette) => {
    const base = Paint.of(palette.grate).vivid(VIVID);
    fill(context, Paint.of("#14161a"));
    const pitch = S / 4;
    for (let i = 0; i < 4; i += 1) {
      plate(context, 0, i * pitch, S, 4, base, 1.4, 0.6);
      plate(context, i * pitch, 0, 4, S, base.shade(0.88), 1.3, 0.6);
    }
  },

  /** Hazard stripes, drawn as bars with a bevel rather than painted on. */
  hazard: (context, palette) => {
    const warn = Paint.of(palette.hazard).vivid(VIVID);
    const dark = Paint.of(palette.hazardStripe);
    fill(context, warn);
    context.save();
    for (let i = -S; i < S * 2; i += 16) {
      context.fillStyle = dark.css();
      context.beginPath();
      context.moveTo(i, 0);
      context.lineTo(i + 8, 0);
      context.lineTo(i + 8 + S, S);
      context.lineTo(i + S, S);
      context.closePath();
      context.fill();
    }
    context.restore();
  },

  /**
   * Brick: courses of big, individually shaded bricks with drawn mortar.
   *
   * The one texture that most decides whether a wall reads as painted. Four
   * shades on a repeating pattern rather than a random one, because a
   * random brick wall reads as static and a patterned one reads as laid.
   */
  brick: (context, palette) => {
    const base = Paint.of(palette.brick).vivid(VIVID);
    const mortar = Paint.of("#b9b2a4");
    fill(context, mortar);
    const courses = 8;
    const height = S / courses;
    const length = 16;
    const shades = [1, 0.87, 1.12, 0.94, 1.05, 0.8];
    let n = 0;
    for (let row = 0; row < courses; row += 1) {
      const offset = row % 2 === 0 ? 0 : -length / 2;
      for (let x = offset; x < S; x += length) {
        plate(context, x + 1, row * height + 1, length - 2, height - 2, base.shade(shades[n % shades.length]));
        n += 1;
      }
    }
  },

  /** Structural concrete: board-marked, the way poured concrete is. */
  frame: (context, palette) => {
    const base = Paint.of(palette.frame).vivid(VIVID);
    fill(context, base.shade(0.66));
    const boards = 8;
    const height = S / boards;
    for (let i = 0; i < boards; i += 1) {
      plate(context, 0, i * height, S, height - 1, base.shade([1, 0.95, 1.04, 0.98][i % 4]), 1.18, 0.82);
    }
  },

  /** Cladding: corrugated sheet, drawn as lit and shaded ribs. */
  cladding: (context, palette) => {
    const base = Paint.of(palette.cladding).vivid(VIVID);
    fill(context, base);
    for (let x = 0; x < S; x += 8) {
      context.fillStyle = base.shade(1.35).css();
      context.fillRect(x, 0, 2, S);
      context.fillStyle = base.shade(0.66).css();
      context.fillRect(x + 5, 0, 3, S);
    }
  },

  /** Painted spandrel: flat colour, with the paint flaked off in patches. */
  spandrel: (context, palette, random) => {
    const base = Paint.of(palette.spandrel).vivid(VIVID);
    const under = Paint.of(palette.brick).vivid(VIVID).shade(0.8);
    fill(context, base);
    // Flakes: drawn blocks of the brick beneath, not a noise field.
    for (let i = 0; i < 7; i += 1) {
      const x = Math.floor(random() * S);
      const y = Math.floor(random() * S);
      const w = 3 + Math.floor(random() * 7);
      const h = 2 + Math.floor(random() * 5);
      context.fillStyle = under.css();
      context.fillRect(x, y, w, h);
      context.fillStyle = base.shade(0.7).css();
      context.fillRect(x, y, w, 1);
    }
    plate(context, 0, 0, S, S, base, 1.2, 0.85);
  },

  /** Road: dark, with a drawn kerb line and a few patched repairs. */
  asphalt: (context, palette, random) => {
    const base = Paint.of(palette.asphalt).vivid(VIVID);
    fill(context, base);
    // Patches, drawn as rectangles a shade off: a road is a history of digs.
    for (let i = 0; i < 4; i += 1) {
      const x = Math.floor(random() * S);
      const y = Math.floor(random() * S);
      const w = 8 + Math.floor(random() * 18);
      const h = 6 + Math.floor(random() * 14);
      plate(context, x, y, w, h, base.shade(0.86 + random() * 0.3), 1.12, 0.9);
    }
    const crack = base.shade(0.6).css();
    for (let i = 0; i < 4; i += 1) {
      scratch(context, random() * S, random() * S, 0.9, random() < 0.5 ? 0.5 : -0.5, 10 + random() * 14, crack);
    }
  },

  /** Rubble: drawn chunks of broken slab, stacked and outlined. */
  rubble: (context, palette, random) => {
    const base = Paint.of(palette.rubble).vivid(VIVID);
    const brick = Paint.of(palette.brick).vivid(VIVID);
    fill(context, base.shade(0.5));
    for (let i = 0; i < 46; i += 1) {
      const w = 5 + Math.floor(random() * 11);
      const h = 4 + Math.floor(random() * 8);
      const x = Math.floor(random() * S);
      const y = Math.floor(random() * S);
      // A few broken bricks in the heap, not a heap of bricks: at a
      // quarter of them in full colour the rubble read as a traffic cone.
      const chunk =
        random() < 0.14
          ? brick.shade(0.62 + random() * 0.22)
          : base.shade(0.85 + random() * 0.35);
      plate(context, x, y, w, h, chunk, 1.25, 0.65);
    }
  },

  /**
   * Leaves: drawn clumps with a lit top and a dark underside.
   *
   * Cut out at the edges rather than filled, because this texture is worn
   * by a canopy and a canopy with a hard rectangular edge is a hedge.
   */
  foliage: (context, palette, random) => {
    const base = Paint.of(palette.foliage).vivid(VIVID);
    fill(context, base.shade(0.42));
    for (let clump = 0; clump < 18; clump += 1) {
      const cx = random() * S;
      const cy = random() * S;
      const size = 5 + random() * 8;
      const lit = base.shade(0.8 + random() * 0.55);
      context.fillStyle = lit.css();
      context.beginPath();
      context.ellipse(cx, cy, size, size * 0.8, 0, 0, Math.PI * 2);
      context.fill();
      // The drawn highlight along the top of each clump.
      context.fillStyle = lit.shade(1.4).css();
      context.beginPath();
      context.ellipse(cx - size * 0.2, cy - size * 0.35, size * 0.5, size * 0.3, 0, 0, Math.PI * 2);
      context.fill();
    }
  },

  /** A tagged wall: flat shapes with a fat outline, over flat concrete. */
  graffiti: (context, palette, random) => {
    const base = Paint.of(palette.graffiti).vivid(VIVID);
    fill(context, base.shade(0.9));
    plate(context, 0, 0, S, S, base, 1.15, 0.85);
    const paints = ["#e2402f", "#2f6fd0", "#e8c53a", "#e8e4dc"];
    for (let i = 0; i < 5; i += 1) {
      const x = Math.floor(random() * S);
      const y = Math.floor(random() * S);
      const w = 8 + Math.floor(random() * 16);
      const h = 6 + Math.floor(random() * 12);
      context.fillStyle = "#1d1a1c";
      context.fillRect(x - 1, y - 1, w + 2, h + 2);
      context.fillStyle = paints[Math.floor(random() * paints.length)];
      context.fillRect(x, y, w, h);
    }
  },
};

/** What each painted surface averages out to, for normalising tints. */
const meanColour = (context: Context): { r: number; g: number; b: number } => {
  const { data } = context.getImageData(0, 0, S, S);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const pixels = data.length / 4;
  return {
    r: Math.max(0.02, r / pixels / 255),
    g: Math.max(0.02, g / pixels / 255),
    b: Math.max(0.02, b / pixels / 255),
  };
};

/**
 * Draw the painted set for one palette.
 *
 * Bilinear, with mip maps: the console this is after filtered its textures,
 * and a drawn line softened by the filter is the look. Nearest sampling is
 * a different machine.
 */
export const createRetroTextures = (
  scene: Scene,
  palette: TexturePalette,
  seed = 1337,
): {
  textures: Record<SurfaceTextureId, Texture>;
  levels: Record<SurfaceTextureId, { r: number; g: number; b: number }>;
} => {
  const textures = {} as Record<SurfaceTextureId, Texture>;
  const levels = {} as Record<SurfaceTextureId, { r: number; g: number; b: number }>;
  let offset = 0;
  for (const [id, paint] of Object.entries(PAINTERS) as [SurfaceTextureId, RetroPainter][]) {
    const texture = new DynamicTexture(`retro_${id}`, { width: S, height: S }, scene, true);
    const context = texture.getContext() as unknown as Context;
    context.imageSmoothingEnabled = false;
    paint(context, palette, makeRandom(seed + offset));
    levels[id] = meanColour(context);
    offset += 7919;
    texture.update();
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.WRAP_ADDRESSMODE;
    textures[id] = texture;
  }
  return { textures, levels };
};
