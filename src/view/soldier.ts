import type { Team } from "../sim/bots";
import type { Vec3 } from "../sim/vec3";
import { bakeAmbient, buildSkin, flatten, type Loft, type Ring, type Skin } from "./loft";

/**
 * A soldier, built to the shape of a person.
 *
 * The figure this replaces was thirty boxes: a box torso, a box head, a box
 * helmet, box legs. It read as what it was. This one is lofted — a
 * cross-section swept along a line and changed as it travels — so a thigh
 * narrows into a knee, a ribcage widens into shoulders, a skull is an egg
 * and not a cube, and the outline that reaches the screen at twenty metres
 * is a person's.
 *
 * Everything in it is original work built from numbers in this file: real
 * proportions for a soldier of one metre eighty, a plate carrier with
 * magazine pouches, a helmet with a mount on the front, gloves, knee pads
 * and boots. No part of it is taken from, named after, or modelled on
 * anybody else's game.
 *
 * Both sides wear the same kit. What tells them apart is the colour of the
 * uniform, the carrier and the helmet, and nothing else — which is what was
 * asked for, and is worth knowing about: at distance, in shade or in fog,
 * colour is the first cue to go, and there is no longer a second one behind
 * it. `tests/teamContrast.test.ts` is what keeps the colours far enough
 * apart to carry that on their own.
 *
 * The geometry is laid out standing, holding a rifle across the chest, and
 * that pose is the skeleton's rest. Bones deviate from it rather than from
 * a spread-eagled T, which keeps the shoulders and hips from folding badly
 * when they move.
 *
 * It is built at two levels of detail from the same numbers. The full one
 * is above. The low one is the same soldier as a console of the late
 * nineties would have drawn them: a few hundred polygons, six sides to a
 * limb, the small kit left off, the head and hands a size up so they read
 * at the resolution the retro look renders at, and every face lit flat.
 */

/** Where each joint sits when the figure is at rest, and what it hangs from. */
export interface BoneSpec {
  name: string;
  /** Index of the parent in this table, or -1 for the root. */
  parent: number;
  /** The joint's position, in the figure's own space. */
  at: Vec3;
}

const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/**
 * The skeleton.
 *
 * Seventeen bones: enough for a spine that bends, shoulders and hips that
 * swing, elbows and knees, and ankles that keep the feet flat. Fewer than
 * that and a walk reads as a mannequin being rocked; many more and the
 * matrices stop fitting in the uniforms a weak phone gives a shader.
 *
 * Left and right are the figure's own. The rifle is carried on the right.
 */
export const BONES: BoneSpec[] = [
  { name: "root", parent: -1, at: at(0, 0, 0) },
  { name: "pelvis", parent: 0, at: at(0, 0.94, 0) },
  { name: "spine", parent: 1, at: at(0, 1.1, 0) },
  { name: "chest", parent: 2, at: at(0, 1.26, 0) },
  { name: "head", parent: 3, at: at(0, 1.47, 0) },
  { name: "armR", parent: 3, at: at(0.185, 1.43, 0) },
  { name: "foreR", parent: 5, at: at(0.235, 1.18, 0.075) },
  { name: "handR", parent: 6, at: at(0.175, 1.215, 0.235) },
  { name: "armL", parent: 3, at: at(-0.185, 1.43, 0) },
  { name: "foreL", parent: 8, at: at(-0.185, 1.155, 0.17) },
  { name: "handL", parent: 9, at: at(-0.025, 1.275, 0.385) },
  { name: "thighR", parent: 1, at: at(0.095, 0.93, 0) },
  { name: "shinR", parent: 11, at: at(0.095, 0.5, 0.015) },
  { name: "footR", parent: 12, at: at(0.095, 0.1, 0) },
  { name: "thighL", parent: 1, at: at(-0.095, 0.93, 0) },
  { name: "shinL", parent: 14, at: at(-0.095, 0.5, 0.015) },
  { name: "footL", parent: 15, at: at(-0.095, 0.1, 0) },
];

/** Look a bone up by name, so the shape below reads as anatomy. */
const B: Record<string, number> = Object.fromEntries(BONES.map((bone, index) => [bone.name, index]));

/** How tall the figure stands, for the shadow it lays on the ground. */
export const FIGURE_HEIGHT = 1.8;

/**
 * What a soldier is made of, in colours.
 *
 * The uniform, the carrier and the helmet take the team's colour. The
 * webbing, the boots, the gloves and the weapon do not: gear that is the
 * same on both sides is what stops two coloured figures reading as two
 * coloured shapes rather than as two soldiers.
 */
export interface SoldierPalette {
  uniform: string;
  /** The uniform where it is not in the light: trousers, under the arms. */
  uniformDeep: string;
  carrier: string;
  helmet: string;
  /** Webbing, pouches, straps, sling. */
  gear: string;
  glove: string;
  boot: string;
  skin: string;
  /** The glass on the helmet mount, which catches a little light. */
  lens: string;
  weapon: string;
  weaponDark: string;
}

export const TEAM_PALETTES: Record<Team, SoldierPalette> = {
  a: {
    uniform: "#3f6fbe",
    uniformDeep: "#2d5290",
    carrier: "#27406b",
    helmet: "#37619f",
    gear: "#2b2a2c",
    glove: "#232427",
    boot: "#1f2023",
    skin: "#b98a66",
    lens: "#39d1ef",
    weapon: "#5b5f66",
    weaponDark: "#34363b",
  },
  b: {
    uniform: "#c2452f",
    uniformDeep: "#963425",
    carrier: "#6f2b1f",
    helmet: "#ad3d2a",
    gear: "#2b2a2c",
    glove: "#232427",
    boot: "#1f2023",
    skin: "#b98a66",
    lens: "#ecb13c",
    weapon: "#5b5f66",
    weaponDark: "#34363b",
  },
};

/** How much of the figure is built. */
export type Detail = "full" | "low";

interface DetailLevel {
  /** Points round the torso, the head, the helmet. */
  sides: number;
  /** Points round a limb. */
  limbSides: number;
  /** Points round a pouch or a pad. */
  blockSides: number;
  /** Rings along a limb. */
  steps: number;
  /** The small kit: goggles, straps, pouches, the holster, the radio. */
  kit: boolean;
  /**
   * Head, hands and boots, sized up.
   *
   * Not for legibility — for the idiom. The figures of this era were
   * caricatures: a head a quarter of the body's height rather than an
   * eighth, hands and feet you could see from across a room, and a torso
   * that got out of their way. A realistic figure at low polygon counts
   * reads as a badly-made realistic figure; a caricature at low polygon
   * counts reads as a character.
   */
  headScale: number;
  handScale: number;
  bootScale: number;
  /** How much the team's colours are pushed, away from the modern wash. */
  vivid: number;
  /** One normal per face rather than one per vertex. */
  flat: boolean;
}

const DETAIL: Record<Detail, DetailLevel> = {
  full: {
    sides: 12,
    limbSides: 8,
    blockSides: 8,
    steps: 4,
    kit: true,
    headScale: 1,
    handScale: 1,
    bootScale: 1,
    vivid: 1,
    flat: false,
  },
  low: {
    sides: 8,
    limbSides: 6,
    blockSides: 4,
    steps: 2,
    kit: false,
    headScale: 1.42,
    handScale: 1.7,
    bootScale: 1.3,
    vivid: 1.5,
    flat: true,
  },
};

/** Push a colour away from its own lightness, for the bolder palette. */
const vividHex = (hex: string, factor: number): string => {
  if (factor === 1) return hex;
  const value = parseInt(hex.replace("#", ""), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  const lum = channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114;
  const pushed = channels.map((c) =>
    Math.max(0, Math.min(255, Math.round(lum + (c - lum) * factor))),
  );
  return `#${pushed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
};

const vividPalette = (palette: SoldierPalette, factor: number): SoldierPalette => {
  const out = { ...palette };
  for (const key of Object.keys(out) as (keyof SoldierPalette)[]) {
    out[key] = vividHex(out[key], factor);
  }
  return out;
};

/** A ring, with the fields that are the same nearly everywhere filled in. */
const ring = (
  x: number,
  y: number,
  z: number,
  across: number,
  through: number,
  round: number,
  bone: number,
  extra: Partial<Ring> = {},
): Ring => ({ at: at(x, y, z), across, through, round, bone, ...extra });

/**
 * The same loft grown about a point, rather than each ring about itself.
 *
 * Growing the rings alone makes a part fatter without making it bigger,
 * which is what the first attempt at the caricature did: a head that came
 * out as a broad face on the same small skull, and a boot that got wider
 * without getting longer. A part's size is in where its rings sit as much
 * as in how wide they are, so both have to move, and they move about a
 * point that keeps the part attached to the rest of the figure: a head
 * about its own middle, so it settles down into the shoulders the way a
 * caricature's does; a boot about the ankle it hangs from.
 */
const grown = (loft: Loft, factor: number, pivot: Vec3): Loft => ({
  ...loft,
  rings: loft.rings.map((r) => ({
    ...r,
    across: r.across * factor,
    through: r.through * factor,
    at: {
      x: pivot.x + (r.at.x - pivot.x) * factor,
      y: pivot.y + (r.at.y - pivot.y) * factor,
      z: pivot.z + (r.at.z - pivot.z) * factor,
    },
  })),
});

/** Where the head is grown from: the middle of the head hitbox. */
const HEAD_PIVOT = at(0, 1.62, 0);

/** A straight run between two joints, narrowing as it goes. */
const limb = (
  from: Vec3,
  to: Vec3,
  fromSize: number,
  toSize: number,
  bone: number,
  child: number,
  colour: string,
  options: { squash?: number; steps: number; sides: number },
): Loft => {
  const steps = options.steps;
  const squash = options.squash ?? 1;
  const rings: Ring[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const size = fromSize + (toSize - fromSize) * t;
    // The last stretch before the joint is shared with the bone past it, so
    // the surface bends there instead of opening a gap.
    const blend = t < 0.62 ? 0 : ((t - 0.62) / 0.38) * 0.5;
    rings.push(
      ring(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        from.z + (to.z - from.z) * t,
        size,
        size * squash,
        1,
        bone,
        { blendBone: child, blend, shade: 1 - 0.05 * t },
      ),
    );
  }
  return { rings, sides: options.sides, colour, capStart: false, capEnd: false };
};

/** A small rounded block, for pouches, pads and the weapon. */
const block = (
  centre: Vec3,
  half: Vec3,
  bone: number,
  colour: string,
  round: number,
  sides: number,
): Loft => ({
  rings: [
    ring(centre.x, centre.y, centre.z - half.z, half.x * 0.86, half.y * 0.86, round, bone, {
      shade: 0.9,
    }),
    ring(centre.x, centre.y, centre.z - half.z * 0.72, half.x, half.y, round, bone),
    ring(centre.x, centre.y, centre.z + half.z * 0.72, half.x, half.y, round, bone),
    ring(centre.x, centre.y, centre.z + half.z, half.x * 0.86, half.y * 0.86, round, bone, {
      shade: 1.05,
    }),
  ],
  sides,
  colour,
});

/** Every loft the figure is made of, standing at rest. */
const lofts = (p: SoldierPalette, d: DetailLevel): Loft[] => {
  const out: Loft[] = [];
  const bone = (name: string): number => B[name];
  const blk = (centre: Vec3, half: Vec3, on: number, colour: string, round = 0.35): Loft =>
    block(centre, half, on, colour, round, d.blockSides);

  // Hips and belly. Widest at the hip bone, drawn in at the waist: the one
  // taper that does most of the work of reading as a body rather than a bin.
  out.push({
    colour: p.uniformDeep,
    sides: d.sides,
    rings: [
      ring(0, 0.85, 0.005, 0.145, 0.105, 0.78, bone("pelvis"), { shade: 0.88 }),
      ring(0, 0.94, 0.005, 0.155, 0.112, 0.78, bone("pelvis")),
      ring(0, 1.02, 0.004, 0.148, 0.108, 0.8, bone("pelvis"), {
        blendBone: bone("spine"),
        blend: 0.45,
      }),
      ring(0, 1.1, 0.003, 0.138, 0.1, 0.8, bone("spine")),
      ring(0, 1.18, 0.002, 0.142, 0.103, 0.78, bone("spine"), {
        blendBone: bone("chest"),
        blend: 0.5,
      }),
    ],
    capEnd: false,
  });

  // Ribcage into shoulders.
  out.push({
    colour: p.uniform,
    sides: d.sides,
    rings: [
      ring(0, 1.18, 0.002, 0.142, 0.103, 0.78, bone("spine"), {
        blendBone: bone("chest"),
        blend: 0.5,
      }),
      ring(0, 1.26, 0, 0.158, 0.112, 0.76, bone("chest")),
      ring(0, 1.35, -0.002, 0.168, 0.116, 0.74, bone("chest")),
      ring(0, 1.42, -0.004, 0.191, 0.118, 0.68, bone("chest")),
      ring(0, 1.47, -0.006, 0.176, 0.107, 0.72, bone("chest"), { shade: 1.04 }),
    ],
    capStart: false,
  });

  // Neck, and the hollow at its base.
  out.push({
    colour: p.skin,
    sides: d.limbSides,
    rings: [
      ring(0, 1.43, 0.004, 0.058, 0.058, 1, bone("chest"), {
        blendBone: bone("head"),
        blend: 0.4,
        shade: 0.74,
      }),
      ring(0, 1.49, 0.006, 0.054, 0.055, 1, bone("head"), { shade: 0.84 }),
      ring(0, 1.53, 0.008, 0.056, 0.058, 1, bone("head"), { shade: 0.9 }),
    ],
    capStart: false,
    capEnd: false,
  });

  // The head, in three bands, because a bare skin-coloured egg under a
  // helmet reads as a mannequin at any distance and as a pale blob at the
  // ones that matter. Lower face covered, a strip of skin at the eyes, and
  // a crown that only ever shows under the brim. Scaled as one, so the low
  // figure's bigger head is the same head.
  const head: Loft[] = [];
  head.push({
    colour: p.gear,
    sides: d.sides,
    rings: [
      ring(0, 1.495, 0.014, 0.055, 0.062, 1, bone("head"), { shade: 0.72 }),
      ring(0, 1.535, 0.016, 0.071, 0.086, 0.95, bone("head"), { shade: 0.86 }),
      ring(0, 1.575, 0.011, 0.079, 0.096, 1, bone("head"), { shade: 1.0 }),
      ring(0, 1.6, 0.008, 0.081, 0.098, 1, bone("head"), { shade: 1.05 }),
    ],
    capEnd: false,
  });
  // The eyes.
  head.push({
    colour: p.skin,
    sides: d.sides,
    rings: [
      ring(0, 1.6, 0.008, 0.0805, 0.0975, 1, bone("head"), { shade: 0.88 }),
      ring(0, 1.628, 0.005, 0.0815, 0.0985, 1, bone("head"), { shade: 0.96 }),
    ],
    capStart: false,
    capEnd: false,
  });
  // The crown, all but hidden by the shell that goes over it next.
  head.push({
    colour: p.gear,
    sides: d.sides,
    rings: [
      ring(0, 1.628, 0.005, 0.0815, 0.0985, 1, bone("head"), { shade: 0.8 }),
      ring(0, 1.68, 0, 0.076, 0.09, 1, bone("head"), { shade: 0.9 }),
      ring(0, 1.72, -0.006, 0.062, 0.072, 1, bone("head"), { shade: 1 }),
      ring(0, 1.745, -0.008, 0.04, 0.046, 1, bone("head")),
    ],
    capStart: false,
  });
  // Helmet: a shell over the skull with a brim, sitting low at the back.
  head.push({
    colour: p.helmet,
    sides: d.sides,
    rings: [
      ring(0, 1.625, -0.012, 0.098, 0.122, 1, bone("head"), { shade: 0.86 }),
      ring(0, 1.645, -0.01, 0.103, 0.126, 1, bone("head")),
      ring(0, 1.69, -0.008, 0.099, 0.118, 1, bone("head")),
      ring(0, 1.74, -0.01, 0.086, 0.1, 1, bone("head"), { shade: 1.06 }),
      ring(0, 1.782, -0.012, 0.05, 0.056, 1, bone("head"), { shade: 1.1 }),
    ],
    capStart: false,
  });
  // The rim, which is what makes it a helmet rather than a bald head.
  head.push({
    colour: p.helmet,
    sides: d.sides,
    rings: [
      ring(0, 1.612, -0.012, 0.094, 0.118, 1, bone("head"), { shade: 0.7 }),
      ring(0, 1.628, -0.012, 0.106, 0.131, 1, bone("head"), { shade: 0.78 }),
      ring(0, 1.648, -0.011, 0.104, 0.128, 1, bone("head"), { shade: 0.95 }),
    ],
    capStart: false,
    capEnd: false,
  });
  if (d.kit) {
    // Goggles pushed up on the brow, which is what the strip of skin is
    // under, and a mount with its glass above them.
    head.push(
      blk(at(0, 1.617, 0.082), at(0.062, 0.017, 0.022), bone("head"), p.gear, 0.55),
      blk(at(0, 1.616, 0.096), at(0.042, 0.011, 0.01), bone("head"), p.lens, 0.7),
      blk(at(0, 1.655, 0.108), at(0.03, 0.026, 0.022), bone("head"), p.gear, 0.3),
      blk(at(0, 1.652, 0.128), at(0.021, 0.017, 0.008), bone("head"), p.lens, 0.6),
    );
    // Ear covers, which break the round of the shell from the front.
    for (const side of [-1, 1]) {
      head.push(
        blk(at(side * 0.098, 1.628, 0.005), at(0.014, 0.03, 0.038), bone("head"), p.gear, 0.55),
      );
    }
  }
  for (const loft of head) out.push(grown(loft, d.headScale, HEAD_PIVOT));

  // Plate carrier, over the chest and round the ribs. Boxier than the body
  // under it, and standing off it, which is what a carrier looks like.
  out.push({
    colour: p.carrier,
    sides: d.sides,
    rings: [
      ring(0, 1.1, 0.004, 0.152, 0.116, 0.42, bone("spine"), { shade: 0.84 }),
      ring(0, 1.18, 0.003, 0.162, 0.124, 0.4, bone("spine"), {
        blendBone: bone("chest"),
        blend: 0.5,
      }),
      ring(0, 1.28, 0.001, 0.174, 0.13, 0.38, bone("chest")),
      ring(0, 1.38, -0.002, 0.196, 0.13, 0.38, bone("chest")),
      ring(0, 1.44, -0.004, 0.176, 0.12, 0.48, bone("chest"), { shade: 1.05 }),
    ],
  });
  if (d.kit) {
    // Straps over the shoulders.
    for (const side of [-1, 1]) {
      out.push({
        colour: p.gear,
        sides: 6,
        rings: [
          ring(side * 0.085, 1.41, 0.12, 0.034, 0.016, 0.5, bone("chest")),
          ring(side * 0.105, 1.465, 0.03, 0.038, 0.018, 0.5, bone("chest"), { shade: 1.08 }),
          ring(side * 0.1, 1.435, -0.09, 0.034, 0.016, 0.5, bone("chest"), { shade: 0.86 }),
        ],
      });
    }
    // Magazine pouches across the front, a radio on one side, a pack behind.
    for (const x of [-0.078, 0, 0.078]) {
      out.push(blk(at(x, 1.17, 0.156), at(0.034, 0.055, 0.03), bone("spine"), p.gear, 0.28));
    }
    out.push(blk(at(-0.1, 1.32, 0.142), at(0.032, 0.046, 0.026), bone("chest"), p.gear, 0.3));
    out.push(blk(at(0, 1.29, -0.15), at(0.07, 0.06, 0.026), bone("chest"), p.gear, 0.3));
  } else {
    // One row of pouches as a single block: the read at range is a dark
    // band across the chest, and that is what this is.
    out.push(blk(at(0, 1.17, 0.152), at(0.112, 0.055, 0.028), bone("spine"), p.gear, 0.28));
  }

  // Belt and hip pouches.
  out.push({
    colour: p.gear,
    sides: d.sides,
    rings: [
      ring(0, 0.955, 0.004, 0.152, 0.111, 0.7, bone("pelvis"), { shade: 0.82 }),
      ring(0, 0.985, 0.004, 0.159, 0.116, 0.7, bone("pelvis")),
      ring(0, 1.015, 0.004, 0.151, 0.111, 0.72, bone("pelvis"), { shade: 0.92 }),
    ],
    capStart: false,
    capEnd: false,
  });
  if (d.kit) {
    for (const side of [-1, 1]) {
      out.push(
        blk(at(side * 0.15, 0.96, -0.03), at(0.03, 0.05, 0.045), bone("pelvis"), p.gear, 0.3),
      );
    }
    // Holster on the strong side.
    out.push(blk(at(0.135, 0.78, 0.02), at(0.032, 0.075, 0.042), bone("thighR"), p.gear, 0.3));
  }

  // Arms. Upper arm to elbow, elbow to wrist, then a glove.
  const arm = (suffix: "R" | "L", shoulder: Vec3, elbow: Vec3, wrist: Vec3): void => {
    out.push(
      // A cap over the shoulder joint, so the arm meets the body in a curve.
      {
        colour: p.uniform,
        sides: d.sides,
        rings: [
          ring(shoulder.x * 0.66, 1.445, -0.004, 0.07, 0.076, 1, bone("chest"), { shade: 1.02 }),
          ring(shoulder.x * 1.05, 1.432, -0.002, 0.078, 0.082, 1, bone(`arm${suffix}`), {
            blendBone: bone("chest"),
            blend: 0.4,
          }),
          ring(shoulder.x * 1.12, 1.385, 0, 0.07, 0.072, 1, bone(`arm${suffix}`), { shade: 0.96 }),
        ],
        capStart: false,
        capEnd: false,
      },
      limb(shoulder, elbow, 0.062, 0.047, bone(`arm${suffix}`), bone(`fore${suffix}`), p.uniform, {
        steps: d.steps,
        sides: d.limbSides,
      }),
      limb(elbow, wrist, 0.048, 0.036, bone(`fore${suffix}`), bone(`hand${suffix}`), p.uniformDeep, {
        steps: Math.max(2, d.steps - 1),
        sides: d.limbSides,
      }),
      blk(
        wrist,
        at(0.036 * d.handScale, 0.036 * d.handScale, 0.05 * d.handScale),
        bone(`hand${suffix}`),
        p.glove,
        0.65,
      ),
    );
  };
  arm("R", at(0.185, 1.43, 0), at(0.235, 1.18, 0.075), at(0.175, 1.215, 0.235));
  arm("L", at(-0.185, 1.43, 0), at(-0.185, 1.155, 0.17), at(-0.025, 1.275, 0.385));

  // Legs. Thigh to knee, a pad on the knee, shin to ankle, and a boot.
  for (const suffix of ["R", "L"] as const) {
    const side = suffix === "R" ? 1 : -1;
    const hip = at(side * 0.095, 0.93, 0);
    const knee = at(side * 0.095, 0.5, 0.015);
    const ankle = at(side * 0.095, 0.1, 0);
    out.push(
      limb(hip, knee, 0.088, 0.062, bone(`thigh${suffix}`), bone(`shin${suffix}`), p.uniformDeep, {
        steps: d.steps,
        sides: d.limbSides,
        squash: 0.94,
      }),
      blk(
        at(side * 0.095, 0.505, 0.062),
        at(0.055, 0.058, 0.026),
        bone(`shin${suffix}`),
        p.gear,
        0.45,
      ),
      limb(knee, ankle, 0.062, 0.045, bone(`shin${suffix}`), bone(`foot${suffix}`), p.uniformDeep, {
        steps: Math.max(2, d.steps - 1),
        sides: d.limbSides,
        squash: 0.92,
      }),
      // The boot, swept forward from the heel to the toe, grown about the
      // ankle so that sizing it up lengthens it rather than only fattening it.
      grown(
        {
          colour: p.boot,
          sides: d.limbSides,
          rings: [
            ring(side * 0.095, 0.088, -0.072, 0.048, 0.055, 0.5, bone(`foot${suffix}`), {
              shade: 0.82,
            }),
            ring(side * 0.095, 0.062, -0.03, 0.055, 0.062, 0.45, bone(`foot${suffix}`)),
            ring(side * 0.095, 0.05, 0.05, 0.056, 0.05, 0.4, bone(`foot${suffix}`)),
            ring(side * 0.095, 0.042, 0.115, 0.047, 0.042, 0.45, bone(`foot${suffix}`), {
              shade: 1.04,
            }),
          ],
        },
        d.bootScale,
        at(side * 0.095, 0.1, 0),
      ),
    );
    if (d.kit) {
      // The boot's upper, around the ankle.
      out.push({
        colour: p.boot,
        sides: d.limbSides,
        rings: [
          ring(side * 0.095, 0.1, -0.012, 0.055, 0.056, 0.7, bone(`foot${suffix}`), { shade: 0.9 }),
          ring(side * 0.095, 0.165, -0.008, 0.052, 0.054, 0.8, bone(`foot${suffix}`), {
            blendBone: bone(`shin${suffix}`),
            blend: 0.5,
          }),
        ],
        capEnd: false,
      });
    }
  }

  // The rifle, carried in the right hand with the left on the foregrip.
  const gun = bone("handR");
  out.push(
    blk(at(0.09, 1.268, 0.3), at(0.028, 0.042, 0.19), gun, p.weapon, 0.25),
    blk(at(0.09, 1.238, 0.16), at(0.024, 0.062, 0.055), gun, p.weaponDark, 0.3),
    blk(at(0.09, 1.272, 0.56), at(0.017, 0.019, 0.13), gun, p.weaponDark, 0.7),
    blk(at(0.09, 1.262, 0.06), at(0.026, 0.05, 0.085), gun, p.weapon, 0.35),
  );
  if (d.kit) {
    out.push(
      blk(at(0.09, 1.31, 0.29), at(0.014, 0.016, 0.07), gun, p.weaponDark, 0.4),
      blk(at(0.09, 1.252, 0.45), at(0.022, 0.026, 0.09), gun, p.weaponDark, 0.5),
    );
  }

  return out;
};

/** One soldier's mesh, at rest, in a team's colours, at a level of detail. */
export const soldierSkin = (team: Team, detail: Detail = "full"): Skin => {
  const level = DETAIL[detail];
  const skin = buildSkin(lofts(vividPalette(TEAM_PALETTES[team], level.vivid), level));
  // A body occludes itself, and one key plus one fill will not find that on
  // a curved surface. Baked in, so it costs nothing to draw.
  bakeAmbient(skin, 0.68);
  return level.flat ? flatten(skin) : skin;
};
