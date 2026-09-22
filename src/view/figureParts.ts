import type { Team } from "../sim/bots";
import type { Vec3 } from "../sim/vec3";

/**
 * What a combatant is made of, as boxes, before anything draws them.
 *
 * Kept away from the renderer so the shape can be reasoned about and tested
 * without an engine: the only question this file answers is where the blocks
 * go, and the only question that matters about that is whether you can tell
 * the two sides apart at the range they shoot each other from.
 *
 * Colour alone did not answer it. Both sides had the same helmet, the same
 * box torso, the same pack and the same outline, so at distance, in shade,
 * behind cover, or on a screen held at arm's length in sunlight, the only
 * cue was a hue — and a hue is the first thing distance, fog and a dark
 * corner take away. So the two sides now carry different kit, and the
 * difference is in the outline rather than the paint:
 *
 * Blue is heavy and top-weighted. A wide domed helmet with a shelf at the
 * back, square pauldrons on the shoulders, a tall pack standing up behind
 * them, and a stub of antenna leaning back off it.
 *
 * Rust is light and bottom-weighted. A narrow bump helmet with a peak out
 * front and a mount on the side, a scarf filling in the neck, a flat pack,
 * and the weight carried at the belt: hip pouches and a bedroll across the
 * small of the back.
 *
 * Nothing here moves the hitboxes, which live in the shared simulation and
 * decide every shot. The antenna leans back and out so it is plainly beside
 * the head rather than part of it, because the one thing worse than two
 * sides that look alike is a silhouette that invites a shot which passes
 * through it.
 */

export interface Part {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  tone: "body" | "trim" | "gear";
  /** Radians about the part's own centre, yaw then pitch. */
  yaw?: number;
  pitch?: number;
}

export const HEAD_HEIGHT = 1.62;
export const HIP_HEIGHT = 0.92;
/** How tall a standing figure is, for the shadow it lays. */
export const FIGURE_HEIGHT = 1.72;

const box = (part: Part): Part => part;

/**
 * A limb: a box laid from one point to another, which is how arms are put
 * on the rifle without working the angles out by hand.
 */
const limb = (from: Vec3, to: Vec3, thickness: number, tone: Part["tone"]): Part => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    z: (from.z + to.z) / 2,
    width: thickness,
    height: thickness,
    depth: length,
    tone,
    yaw: Math.atan2(dx, dz),
    pitch: -Math.atan2(dy, Math.hypot(dx, dz)),
  };
};

/** Torso, arms, gear and rifle: the same on both sides. */
const TORSO: Part[] = [
  // Belt and hips.
  box({ x: 0, y: 0.98, z: 0, width: 0.42, height: 0.16, depth: 0.26, tone: "gear" }),
  // Torso, with the plate carrier on the front.
  box({ x: 0, y: 1.26, z: 0, width: 0.44, height: 0.4, depth: 0.26, tone: "body" }),
  box({ x: 0, y: 1.25, z: 0.15, width: 0.34, height: 0.32, depth: 0.06, tone: "trim" }),
  // Shoulders and neck.
  box({ x: -0.28, y: 1.4, z: 0, width: 0.16, height: 0.14, depth: 0.24, tone: "body" }),
  box({ x: 0.28, y: 1.4, z: 0, width: 0.16, height: 0.14, depth: 0.24, tone: "body" }),
  box({ x: 0, y: 1.48, z: 0, width: 0.12, height: 0.08, depth: 0.12, tone: "body" }),
  // Arms: upper arm from the shoulder to the elbow, forearm to the hand.
  limb({ x: 0.3, y: 1.38, z: 0 }, { x: 0.28, y: 1.14, z: 0.1 }, 0.13, "body"),
  limb({ x: 0.28, y: 1.14, z: 0.1 }, { x: 0.16, y: 1.22, z: 0.22 }, 0.11, "body"),
  limb({ x: -0.3, y: 1.38, z: 0 }, { x: -0.2, y: 1.18, z: 0.22 }, 0.13, "body"),
  limb({ x: -0.2, y: 1.18, z: 0.22 }, { x: 0.02, y: 1.28, z: 0.48 }, 0.11, "body"),
  // Hands.
  box({ x: 0.16, y: 1.22, z: 0.24, width: 0.1, height: 0.1, depth: 0.1, tone: "gear" }),
  box({ x: 0.02, y: 1.29, z: 0.5, width: 0.1, height: 0.1, depth: 0.1, tone: "gear" }),
  // The rifle, across the chest and out.
  box({ x: 0.08, y: 1.3, z: 0.38, width: 0.06, height: 0.09, depth: 0.5, tone: "gear" }),
  box({ x: 0.08, y: 1.31, z: 0.74, width: 0.035, height: 0.035, depth: 0.24, tone: "gear" }),
  box({ x: 0.08, y: 1.21, z: 0.34, width: 0.045, height: 0.14, depth: 0.07, tone: "gear" }),
  box({ x: 0.08, y: 1.3, z: 0.08, width: 0.05, height: 0.09, depth: 0.16, tone: "gear" }),
  box({ x: 0.08, y: 1.36, z: 0.3, width: 0.03, height: 0.04, depth: 0.05, tone: "gear" }),
];

/** The head itself, on the hitbox. A helmet goes over it per side. */
const SKULL: Part[] = [
  box({ x: 0, y: HEAD_HEIGHT, z: 0, width: 0.22, height: 0.24, depth: 0.22, tone: "body" }),
];

/** Blue: the weight is high. Pauldrons, a standing pack, an antenna. */
const HEAVY_KIT: Part[] = [
  // A pack that stands up behind the shoulders rather than sitting between
  // them: from the side this is the whole read.
  box({ x: 0, y: 1.32, z: -0.2, width: 0.32, height: 0.44, depth: 0.18, tone: "gear" }),
  box({ x: 0, y: 1.32, z: -0.29, width: 0.2, height: 0.3, depth: 0.05, tone: "trim" }),
  // Antenna, leaning back and out over the shoulder. Thin enough to cost
  // nothing, tall enough to break the head's outline from across a street,
  // and far enough off the head that nobody aims at it.
  box({
    x: -0.16,
    y: 1.68,
    z: -0.26,
    width: 0.03,
    height: 0.38,
    depth: 0.03,
    tone: "gear",
    pitch: 0.3,
  }),
  // Square pauldrons: the shoulders go from a slope to a shelf.
  box({ x: -0.35, y: 1.39, z: 0, width: 0.15, height: 0.22, depth: 0.3, tone: "body" }),
  box({ x: 0.35, y: 1.39, z: 0, width: 0.15, height: 0.22, depth: 0.3, tone: "body" }),
];

const HEAVY_HELMET: Part[] = [
  // Wide and domed, sitting low over the head.
  box({ x: 0, y: HEAD_HEIGHT + 0.1, z: -0.01, width: 0.33, height: 0.15, depth: 0.3, tone: "trim" }),
  // A shelf at the back, where the counterweight and the straps go.
  box({ x: 0, y: HEAD_HEIGHT + 0.03, z: -0.17, width: 0.26, height: 0.09, depth: 0.08, tone: "trim" }),
  // Brim, straight across.
  box({ x: 0, y: HEAD_HEIGHT + 0.04, z: 0.15, width: 0.29, height: 0.06, depth: 0.08, tone: "trim" }),
  box({ x: 0, y: HEAD_HEIGHT - 0.03, z: 0.1, width: 0.18, height: 0.1, depth: 0.03, tone: "gear" }),
];

/** Rust: the weight is low. Hip pouches, a bedroll, a flat pack. */
const LIGHT_KIT: Part[] = [
  // Pouches on the belt, which widen the waist instead of the shoulders.
  box({ x: -0.26, y: 0.98, z: 0.02, width: 0.15, height: 0.21, depth: 0.23, tone: "gear" }),
  box({ x: 0.26, y: 0.98, z: 0.02, width: 0.15, height: 0.21, depth: 0.23, tone: "gear" }),
  // A bedroll across the small of the back: wide, low, and horizontal,
  // where the other side's mass is narrow, high and vertical.
  box({ x: 0, y: 1.07, z: -0.19, width: 0.54, height: 0.15, depth: 0.15, tone: "gear" }),
  // What is left on the back is flat.
  box({ x: 0, y: 1.28, z: -0.15, width: 0.26, height: 0.26, depth: 0.07, tone: "gear" }),
  // A strap over one shoulder and down to the opposite hip.
  limb({ x: -0.19, y: 1.44, z: 0.08 }, { x: 0.19, y: 1.03, z: 0.12 }, 0.07, "trim"),
];

const LIGHT_HELMET: Part[] = [
  // A bump helmet: narrow, and taller than it is wide.
  box({ x: 0, y: HEAD_HEIGHT + 0.11, z: 0, width: 0.22, height: 0.18, depth: 0.25, tone: "trim" }),
  // A peak out the front, which is the whole silhouette from the side.
  box({ x: 0, y: HEAD_HEIGHT + 0.09, z: 0.19, width: 0.16, height: 0.05, depth: 0.16, tone: "trim" }),
  // A mount on one side, which breaks the symmetry the other side keeps.
  box({ x: 0.12, y: HEAD_HEIGHT + 0.11, z: 0.03, width: 0.06, height: 0.07, depth: 0.11, tone: "gear" }),
  // A scarf filling the gap between helmet and shoulders, so the head reads
  // as one mass where the other side's reads as two.
  box({ x: 0, y: HEAD_HEIGHT - 0.13, z: 0.01, width: 0.27, height: 0.11, depth: 0.25, tone: "trim" }),
];

/** One leg, built about its hip so it can swing. */
const leg = (team: Team): Part[] => [
  box({ x: 0, y: -0.2, z: 0, width: 0.17, height: 0.4, depth: 0.2, tone: "body" }),
  box({ x: 0, y: -0.58, z: 0.01, width: 0.15, height: 0.4, depth: 0.17, tone: "body" }),
  box({ x: 0, y: -0.85, z: 0.05, width: 0.19, height: 0.14, depth: 0.3, tone: "gear" }),
  ...(team === "a"
    ? // Knee pads and a thigh pouch, to carry the heavy read all the way down.
      [
        box({ x: 0, y: -0.4, z: 0.11, width: 0.16, height: 0.15, depth: 0.06, tone: "gear" }),
        box({ x: 0.02, y: -0.32, z: -0.02, width: 0.13, height: 0.18, depth: 0.16, tone: "gear" }),
      ]
    : // A tall boot instead, and nothing on the knee.
      [box({ x: 0, y: -0.72, z: 0.02, width: 0.17, height: 0.16, depth: 0.19, tone: "gear" })]),
];

/**
 * How far out from the middle each hip sits.
 *
 * The stance is part of the outline and it is free: one side stands narrow
 * under all that weight, the other stands loose. Over most of a metre of
 * leg it is worth more to telling the two apart than any single piece of
 * kit on the figure.
 */
export const hipOffset = (team: Team): number => (team === "a" ? 0.1 : 0.16);

/** Every block one figure is built from, grouped as it is drawn. */
export const figureParts = (team: Team): { body: Part[]; head: Part[]; leg: Part[] } => ({
  body: [...TORSO, ...(team === "a" ? HEAVY_KIT : LIGHT_KIT)],
  head: [...SKULL, ...(team === "a" ? HEAVY_HELMET : LIGHT_HELMET)],
  leg: leg(team),
});
