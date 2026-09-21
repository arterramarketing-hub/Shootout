import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";
import { createNoiseField, type NoiseField } from "./noise";

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
  | "hazard"
  | "brick"
  | "frame"
  | "cladding"
  | "spandrel"
  | "asphalt"
  | "rubble"
  | "foliage"
  | "graffiti";

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
  /** The ruin set. */
  brick: string;
  frame: string;
  cladding: string;
  spandrel: string;
  asphalt: string;
  rubble: string;
  foliage: string;
  graffiti: string;
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

/** A colour the painters can scale, since the canvas only takes strings. */
class Color {
  constructor(
    readonly r: number,
    readonly g: number,
    readonly b: number,
  ) {}

  static parse(hex: string): Color {
    const value = parseInt(hex.replace("#", ""), 16);
    return new Color((value >> 16) & 255, (value >> 8) & 255, value & 255);
  }

  scaled(factor: number): Color {
    const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
    return new Color(clampByte(this.r * factor), clampByte(this.g * factor), clampByte(this.b * factor));
  }

  css(): string {
    return `rgb(${this.r},${this.g},${this.b})`;
  }
}

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

  brick: (context, palette, random) => {
    /*
     * Running bond, drawn coarse. One repeat covers three metres of wall, so
     * a true course of seventy-five millimetres would be six pixels tall and
     * turn to noise at any distance. Twenty courses per repeat is a brick
     * twice life size, which at a game's viewing distances is what brick
     * looks like.
     */
    context.fillStyle = "#c9bfae";
    context.fillRect(0, 0, SIZE, SIZE);
    const courses = 20;
    const courseHeight = SIZE / courses;
    const brickWidth = SIZE / 8;
    const mortar = 1.6;
    const base = Color.parse(palette.brick);
    for (let row = 0; row < courses; row += 1) {
      const offset = row % 2 === 0 ? 0 : brickWidth / 2;
      for (let i = -1; i < 9; i += 1) {
        const x = i * brickWidth + offset;
        const y = row * courseHeight;
        // Every brick fired a little differently from its neighbour.
        const shade = 0.88 + random() * 0.22;
        context.fillStyle = base.scaled(shade).css();
        context.fillRect(x + mortar / 2, y + mortar / 2, brickWidth - mortar, courseHeight - mortar);
        if (random() < 0.08) {
          // A spalled face, gone pale where the skin has broken off.
          context.fillStyle = "rgba(220,200,180,0.55)";
          context.fillRect(x + mortar, y + mortar, (brickWidth - mortar * 2) * random(), courseHeight - mortar * 2);
        }
      }
    }
    // Decades of dust and lime bloom, which is what stops old brick reading
    // as new brick: the colour is there, but it is under a film.
    context.fillStyle = "rgba(196,188,176,0.22)";
    context.fillRect(0, 0, SIZE, SIZE);
    blotches(context, random, 12, "rgba(0,0,0,0.18)", 60);
    blotches(context, random, 8, "rgba(235,225,210,0.10)", 44);
    speckle(context, random, 2200, 0.07, 1.1);
    // Soot and water running down from the top.
    for (let i = 0; i < 9; i += 1) {
      const x = random() * SIZE;
      const streak = context.createLinearGradient(0, 0, 0, SIZE * (0.4 + random() * 0.6));
      streak.addColorStop(0, "rgba(0,0,0,0.22)");
      streak.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = streak;
      context.fillRect(x, 0, 2 + random() * 5, SIZE);
    }
  },

  frame: (context, palette, random) => {
    // Structural concrete: cast against boards, stained by decades of rain
    // running down it, rust bleeding from the bars where the cover has gone.
    context.fillStyle = palette.frame;
    context.fillRect(0, 0, SIZE, SIZE);
    blotches(context, random, 30, "rgba(0,0,0,0.07)", 56);
    blotches(context, random, 18, "rgba(255,255,255,0.05)", 48);
    speckle(context, random, 3200, 0.06, 1.4);
    // Board marks from the formwork, faint and horizontal.
    context.fillStyle = "rgba(0,0,0,0.07)";
    for (let y = 0; y < SIZE; y += SIZE / 6) context.fillRect(0, y, SIZE, 1.2);
    // Water streaks.
    for (let i = 0; i < 14; i += 1) {
      const x = random() * SIZE;
      const length = SIZE * (0.3 + random() * 0.7);
      const streak = context.createLinearGradient(0, 0, 0, length);
      streak.addColorStop(0, "rgba(20,20,25,0.26)");
      streak.addColorStop(1, "rgba(20,20,25,0)");
      context.fillStyle = streak;
      context.fillRect(x, 0, 1.5 + random() * 4, length);
    }
    // Rust where the reinforcement shows through.
    for (let i = 0; i < 5; i += 1) {
      const x = random() * SIZE;
      const y = random() * SIZE;
      const length = 20 + random() * 60;
      const rust = context.createLinearGradient(0, y, 0, y + length);
      rust.addColorStop(0, "rgba(150,70,30,0.55)");
      rust.addColorStop(1, "rgba(150,70,30,0)");
      context.fillStyle = rust;
      context.fillRect(x, y, 3 + random() * 3, length);
    }
  },

  cladding: (context, palette, random) => {
    // Corrugated sheet, ribs running vertically, rust creeping up from the
    // bottom edge where the water sits.
    context.fillStyle = palette.cladding;
    context.fillRect(0, 0, SIZE, SIZE);
    const ribs = 14;
    const ribWidth = SIZE / ribs;
    for (let i = 0; i < ribs; i += 1) {
      const x = i * ribWidth;
      const shade = context.createLinearGradient(x, 0, x + ribWidth, 0);
      shade.addColorStop(0, "rgba(0,0,0,0.30)");
      shade.addColorStop(0.35, "rgba(255,255,255,0.10)");
      shade.addColorStop(0.65, "rgba(255,255,255,0.04)");
      shade.addColorStop(1, "rgba(0,0,0,0.34)");
      context.fillStyle = shade;
      context.fillRect(x, 0, ribWidth, SIZE);
    }
    speckle(context, random, 900, 0.05, 1);
    for (let i = 0; i < 12; i += 1) {
      const x = random() * SIZE;
      const rust = context.createLinearGradient(0, SIZE, 0, SIZE - 30 - random() * 90);
      rust.addColorStop(0, "rgba(140,60,25,0.5)");
      rust.addColorStop(1, "rgba(140,60,25,0)");
      context.fillStyle = rust;
      context.fillRect(x, 0, 6 + random() * 14, SIZE);
    }
    // A horizontal lap joint, where one sheet overlaps the next.
    context.fillStyle = "rgba(0,0,0,0.28)";
    context.fillRect(0, SIZE / 2, SIZE, 2);
    context.fillStyle = "rgba(255,255,255,0.08)";
    context.fillRect(0, SIZE / 2 + 2, SIZE, 1.2);
  },

  spandrel: (context, palette, random) => {
    // A painted panel that has been outside for forty years: the paint is
    // still there in the middle and gone at the edges, showing the render.
    context.fillStyle = "#b8ad9c";
    context.fillRect(0, 0, SIZE, SIZE);
    speckle(context, random, 1200, 0.05, 1.2);
    const paint = Color.parse(palette.spandrel);
    context.fillStyle = paint.css();
    context.fillRect(0, 0, SIZE, SIZE);
    // Peel it back in small ragged flakes, thickest along the edges where
    // the water gets in, and in a few larger bald patches.
    for (let i = 0; i < 140; i += 1) {
      const x = random() * SIZE;
      const edge = random() < 0.7;
      const y = edge ? (random() < 0.5 ? random() * SIZE * 0.18 : SIZE - random() * SIZE * 0.22) : random() * SIZE;
      const w = 2 + random() * 9;
      const h = 2 + random() * 6;
      context.fillStyle = `rgba(178,168,152,${(0.5 + random() * 0.5).toFixed(2)})`;
      context.fillRect(x, y, w, h);
    }
    for (let i = 0; i < 4; i += 1) {
      const x = random() * SIZE;
      const y = random() * SIZE;
      context.fillStyle = "rgba(178,168,152,0.85)";
      context.beginPath();
      context.moveTo(x, y);
      for (let k = 0; k < 7; k += 1) {
        context.lineTo(x + (random() - 0.5) * 40, y + (random() - 0.5) * 26);
      }
      context.closePath();
      context.fill();
    }
    blotches(context, random, 14, "rgba(0,0,0,0.12)", 50);
    blotches(context, random, 8, "rgba(255,255,255,0.10)", 36);
    for (let i = 0; i < 8; i += 1) {
      const x = random() * SIZE;
      const streak = context.createLinearGradient(0, 0, 0, SIZE * (0.5 + random() * 0.5));
      streak.addColorStop(0, "rgba(0,0,0,0.2)");
      streak.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = streak;
      context.fillRect(x, 0, 2 + random() * 4, SIZE);
    }
  },

  asphalt: (context, palette, random) => {
    context.fillStyle = palette.asphalt;
    context.fillRect(0, 0, SIZE, SIZE);
    speckle(context, random, 5000, 0.07, 1.2);
    blotches(context, random, 20, "rgba(0,0,0,0.10)", 60);
    blotches(context, random, 10, "rgba(255,255,255,0.05)", 50);
    // Cracks, wandering.
    context.strokeStyle = "rgba(0,0,0,0.35)";
    context.lineWidth = 1.2;
    for (let i = 0; i < 7; i += 1) {
      let x = random() * SIZE;
      let y = random() * SIZE;
      context.beginPath();
      context.moveTo(x, y);
      for (let step = 0; step < 12; step += 1) {
        x += (random() - 0.5) * 30;
        y += (random() - 0.5) * 30;
        context.lineTo(x, y);
      }
      context.stroke();
    }
    // Grass in the cracks, where nothing has driven for years.
    for (let i = 0; i < 40; i += 1) {
      context.fillStyle = `rgba(70,95,40,${(0.2 + random() * 0.4).toFixed(2)})`;
      context.fillRect(random() * SIZE, random() * SIZE, 1 + random() * 3, 1 + random() * 3);
    }
  },

  rubble: (context, palette, random) => {
    // Broken slab and brick, heaped. Drawn as overlapping shards.
    context.fillStyle = palette.rubble;
    context.fillRect(0, 0, SIZE, SIZE);
    const base = Color.parse(palette.rubble);
    for (let i = 0; i < 420; i += 1) {
      const x = random() * SIZE;
      const y = random() * SIZE;
      const w = 3 + random() * 12;
      const h = 2 + random() * 8;
      const brickish = random() < 0.18;
      const colour = brickish
        ? Color.parse("#7a5a4c").scaled(0.85 + random() * 0.3)
        : base.scaled(0.92 + random() * 0.16);
      context.save();
      context.translate(x, y);
      context.rotate(random() * Math.PI);
      context.fillStyle = colour.css();
      context.fillRect(-w / 2, -h / 2, w, h);
      context.fillStyle = "rgba(0,0,0,0.25)";
      context.fillRect(-w / 2, h / 2 - 2, w, 2);
      context.restore();
    }
    // Dust settles over everything, and takes the contrast down with it.
    context.fillStyle = "rgba(160,152,138,0.30)";
    context.fillRect(0, 0, SIZE, SIZE);
    speckle(context, random, 2400, 0.07, 1.2);
    blotches(context, random, 14, "rgba(0,0,0,0.12)", 50);
  },

  foliage: (context, palette, random) => {
    // Leaf mass: layers of small dabs in a few greens, dark underneath and
    // lit on top, with gaps that let the darkness through.
    context.fillStyle = "#26361c";
    context.fillRect(0, 0, SIZE, SIZE);
    const base = Color.parse(palette.foliage);
    // Clumps first, then leaves on the clumps: a canopy is not an even
    // scatter, it is masses with dark air between them.
    for (let clump = 0; clump < 14; clump += 1) {
      const cx = random() * SIZE;
      const cy = random() * SIZE;
      const spread = 18 + random() * 30;
      const lit = 0.7 + random() * 0.6;
      for (let i = 0; i < 70; i += 1) {
        const angle = random() * Math.PI * 2;
        const distance = Math.sqrt(random()) * spread;
        const x = cx + Math.cos(angle) * distance;
        const y = cy + Math.sin(angle) * distance;
        const size = 2 + random() * 5;
        // Leaves at the top of a clump catch the light; underneath is shade.
        const shade = lit * (0.75 + random() * 0.6) * (y < cy ? 1.2 : 0.85);
        context.fillStyle = base.scaled(shade).css();
        context.beginPath();
        context.ellipse(x, y, size, size * 0.55, angle, 0, Math.PI * 2);
        context.fill();
      }
    }
    blotches(context, random, 10, "rgba(0,0,0,0.3)", 44);
    blotches(context, random, 6, "rgba(255,250,200,0.10)", 30);
  },

  graffiti: (context, palette, random) => {
    /*
     * A tagged wall. Shapes only — fat outlined blobs, bars and rings in a
     * few loud colours over the concrete — because letters would be
     * somebody's words, and this level's walls say nothing in particular.
     */
    context.fillStyle = palette.graffiti;
    context.fillRect(0, 0, SIZE, SIZE);
    speckle(context, random, 1600, 0.05, 1.3);
    blotches(context, random, 16, "rgba(0,0,0,0.10)", 50);
    // Throw-ups in chrome and black, the way most of them are, with one
    // colour piece somewhere on the wall. Faded: the sun has had them.
    const paints = ["#d8d6cf", "#d8d6cf", "#2a2729", "#c9c3b8", random() < 0.5 ? "#c74a3d" : "#3a6fb5"];
    const baseline = SIZE * 0.5 + (random() - 0.5) * SIZE * 0.3;
    let x = random() * SIZE * 0.2;
    for (let i = 0; i < 4 && x < SIZE; i += 1) {
      const colour = paints[Math.floor(random() * paints.length)];
      // Wide and low: a row of round ones reads as a row of eyes from across
      // the street, and a wall full of eyes is not the mood.
      const w = 48 + random() * 50;
      const h = 22 + random() * 26;
      const y = baseline + (random() - 0.5) * 12;
      context.globalAlpha = 0.55 + random() * 0.35;
      context.lineWidth = 3 + random() * 3;
      context.strokeStyle = "#1b191c";
      context.fillStyle = colour;
      context.beginPath();
      // A fat rounded letterform with no letter in it.
      context.moveTo(x, y);
      context.quadraticCurveTo(x + w * 0.5, y - h * 0.7, x + w, y - h * 0.1);
      context.quadraticCurveTo(x + w * 1.1, y + h * 0.5, x + w * 0.5, y + h * 0.55);
      context.quadraticCurveTo(x - w * 0.15, y + h * 0.4, x, y);
      context.closePath();
      context.fill();
      context.stroke();
      // A stroke through it now and then, the way a piece gets crossed out.
      if (random() < 0.3) {
        context.strokeStyle = "#1b191c";
        context.lineWidth = 2.5;
        context.beginPath();
        context.moveTo(x - 4, y + h * 0.3);
        context.lineTo(x + w + 4, y - h * 0.2);
        context.stroke();
      }
      x += w * (0.75 + random() * 0.3);
    }
    context.globalAlpha = 1;
    // Drips under the thicker paint.
    context.fillStyle = "rgba(20,19,22,0.5)";
    for (let i = 0; i < 20; i += 1) {
      context.fillRect(random() * SIZE, SIZE * 0.4 + random() * SIZE * 0.4, 1.5, 8 + random() * 30);
    }
  },
};

/**
 * How worn each surface is, and how much of that wear stands proud.
 *
 * The painters above lay down what a surface is made of. This is what has
 * happened to it since: weather at every scale, dirt where dirt collects,
 * and the relief that all of it casts once there is a light on it.
 */
interface Finish {
  /** How deep the mottling cuts, as a fraction of the surface's colour. */
  wear: number;
  /** Cells of the broadest swell across one repeat: fewer is wider. */
  cells: number;
  /** How much relief the normal map takes from the paint. Zero for none. */
  relief: number;
}

const FINISHES: Record<SurfaceTextureId, Finish> = {
  concrete: { wear: 0.16, cells: 3, relief: 1.1 },
  panel: { wear: 0.1, cells: 4, relief: 1 },
  crate: { wear: 0.12, cells: 3, relief: 0.9 },
  metal: { wear: 0.13, cells: 4, relief: 0.7 },
  grate: { wear: 0.06, cells: 4, relief: 1.4 },
  hazard: { wear: 0.09, cells: 3, relief: 0.5 },
  brick: { wear: 0.13, cells: 3, relief: 1.5 },
  frame: { wear: 0.18, cells: 3, relief: 1 },
  cladding: { wear: 0.1, cells: 5, relief: 1.2 },
  spandrel: { wear: 0.16, cells: 3, relief: 0.8 },
  asphalt: { wear: 0.15, cells: 3, relief: 1 },
  rubble: { wear: 0.2, cells: 4, relief: 1.3 },
  // Leaves are their own shape; relief on them reads as crumpled foil.
  foliage: { wear: 0.18, cells: 6, relief: 0 },
  graffiti: { wear: 0.1, cells: 3, relief: 0.4 },
};

/**
 * Put a surface through some weather.
 *
 * Two fields over the top of the paint: one that swells light and dark at
 * every scale, and one that only ever darkens, for the dirt that gathers in
 * the places dirt gathers. Between them they break up the flat fill that
 * makes a generated texture read as plastic, and they are broad enough to
 * disguise where one repeat of the tile ends and the next begins.
 */
const weather = (
  context: CanvasRenderingContext2D,
  mottle: NoiseField,
  grime: NoiseField,
  finish: Finish,
): void => {
  if (finish.wear <= 0) return;
  const image = context.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const swell = 1 + (mottle.fbm(x, y, finish.cells, 5) - 0.5) * 2 * finish.wear;
      const dirt = 1 - Math.max(0, grime.fbm(x, y, finish.cells * 2, 4) - 0.56) * finish.wear * 2.6;
      const factor = swell * dirt;
      const i = (y * SIZE + x) * 4;
      data[i] = Math.max(0, Math.min(255, data[i] * factor));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] * factor));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] * factor));
    }
  }
  context.putImageData(image, 0, 0);
};

/**
 * Blur a field, wrapping at the edges so the result still tiles.
 *
 * Separable, and each axis carries a running total rather than adding up the
 * window again at every pixel: the cost is a few operations per pixel
 * instead of forty, which is the difference between this being free at load
 * and it being a pause on a phone.
 */
const blurWrapped = (source: Float32Array, radius: number): Float32Array => {
  const span = radius * 2 + 1;
  const across = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    const row = y * SIZE;
    let total = 0;
    for (let k = -radius; k <= radius; k += 1) total += source[row + ((k + SIZE) % SIZE)];
    for (let x = 0; x < SIZE; x += 1) {
      across[row + x] = total / span;
      total += source[row + ((x + 1 + radius) % SIZE)] - source[row + ((x - radius + SIZE) % SIZE)];
    }
  }
  const done = new Float32Array(SIZE * SIZE);
  for (let x = 0; x < SIZE; x += 1) {
    let total = 0;
    for (let k = -radius; k <= radius; k += 1) total += across[((k + SIZE) % SIZE) * SIZE + x];
    for (let y = 0; y < SIZE; y += 1) {
      done[y * SIZE + x] = total / span;
      total +=
        across[((y + 1 + radius) % SIZE) * SIZE + x] - across[((y - radius + SIZE) % SIZE) * SIZE + x];
    }
  }
  return done;
};

/**
 * Turn a painted surface into the relief that goes with it.
 *
 * The paint is the only record of what the surface is shaped like, so the
 * relief is read back out of it: what is dark is taken to be low. That is
 * true of the things that matter — mortar courses, panel seams, the holes in
 * a grating, cracks in asphalt — and false of a stain, which is dark and
 * flat. So only the fine detail is kept: the paint is blurred and subtracted
 * first, which leaves the edges and throws away the blotches.
 */
const reliefMap = (
  scene: Scene,
  id: SurfaceTextureId,
  albedo: CanvasRenderingContext2D,
  relief: number,
  anisotropy: number,
): Texture => {
  const painted = albedo.getImageData(0, 0, SIZE, SIZE).data;
  const height = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const p = i * 4;
    height[i] = (painted[p] * 0.299 + painted[p + 1] * 0.587 + painted[p + 2] * 0.114) / 255;
  }
  const broad = blurWrapped(height, 9);
  for (let i = 0; i < height.length; i += 1) height[i] -= broad[i];

  const texture = new DynamicTexture(`nrm_${id}`, { width: SIZE, height: SIZE }, scene, true);
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const image = context.createImageData(SIZE, SIZE);
  const data = image.data;
  const at = (x: number, y: number): number =>
    height[((y + SIZE) % SIZE) * SIZE + ((x + SIZE) % SIZE)];

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      // Sobel: the slope of the surface at this texel, in texture space.
      const dx =
        at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const nx = -dx * relief * 7;
      const ny = -dy * relief * 7;
      const length = Math.hypot(nx, ny, 1);
      const i = (y * SIZE + x) * 4;
      data[i] = ((nx / length) * 0.5 + 0.5) * 255;
      data[i + 1] = ((ny / length) * 0.5 + 0.5) * 255;
      data[i + 2] = (1 / length) * 0.5 * 255 + 127.5;
      data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  texture.update();
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = anisotropy;
  return texture;
};

export type TextureSet = Record<SurfaceTextureId, Texture>;
/** The relief that goes with each surface, where it has any. */
export type ReliefSet = Partial<Record<SurfaceTextureId, Texture>>;
/**
 * What colour each surface averages out to, nought to one per channel.
 *
 * A tint is applied by multiplying it into the texture, and the texture is
 * already painted in the palette's own colour for that surface. So a tint
 * picked as a dusty brick came out at about half the lightness it was
 * written as, and everything a map tinted arrived darker and greyer than
 * anybody chose. Knowing what the texture averages is what lets a tint be
 * divided through it and mean what it says.
 */
export type TextureLevels = Record<SurfaceTextureId, { r: number; g: number; b: number }>;

/** The average colour of a painted texture, for normalising tints against. */
const meanColour = (
  context: CanvasRenderingContext2D,
): { r: number; g: number; b: number } => {
  const { data } = context.getImageData(0, 0, SIZE, SIZE);
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const pixels = data.length / 4;
  // Never zero: a tint is divided by this, and a surface painted pure black
  // would otherwise take every tint to infinity.
  return {
    r: Math.max(0.02, r / pixels / 255),
    g: Math.max(0.02, g / pixels / 255),
    b: Math.max(0.02, b / pixels / 255),
  };
};

/** Draw every surface texture for one palette. */
export const createTextures = (
  scene: Scene,
  palette: TexturePalette,
  seed = 1337,
  anisotropy = 1,
): { textures: TextureSet; levels: TextureLevels } => {
  const set = {} as TextureSet;
  const levels = {} as TextureLevels;
  const mottle = createNoiseField(seed ^ 0x5bf03635, SIZE);
  const grime = createNoiseField(seed ^ 0x27d4eb2f, SIZE);
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
    weather(context, mottle, grime, FINISHES[id]);
    levels[id] = meanColour(context);
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
  return { textures: set, levels };
};

/**
 * The relief for a set of surfaces already painted.
 *
 * Kept apart from the paint because it costs a second texture and a heavier
 * shader per surface, which is worth it on a machine that can afford it and
 * is the first thing to drop on one that cannot.
 */
export const createReliefMaps = (
  scene: Scene,
  textures: TextureSet,
  anisotropy = 1,
): ReliefSet => {
  const set: ReliefSet = {};
  for (const [id, texture] of Object.entries(textures) as [SurfaceTextureId, Texture][]) {
    const { relief } = FINISHES[id];
    if (relief <= 0) continue;
    const context = (texture as DynamicTexture).getContext() as unknown as CanvasRenderingContext2D;
    set[id] = reliefMap(scene, id, context, relief, anisotropy);
  }
  return set;
};
