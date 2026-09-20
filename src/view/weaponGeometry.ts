import type { WeaponId } from "../sim/weapons";

/**
 * The shapes the weapon viewmodels are built from, and the maths for asking
 * where they sit on the screen.
 *
 * Kept free of any engine import for two reasons. The weapon is the one object
 * a player looks at for the entire match, so its shape is worth describing
 * precisely and reading back; and the one rule the viewmodel has to obey —
 * that nothing but the sights may cover what the player is shooting at — can
 * then be checked against the actual geometry rather than against a remembered
 * number. The renderer builds its meshes from exactly these parts, so a test
 * that walks them is testing the weapon the player sees.
 */

const DEG_TO_RAD = Math.PI / 180;

/** How far in front of the eye the weapon is held when aiming, in metres. */
const AIM_DISTANCE = 0.30;

/**
 * How far below the line of sight a sight dot sits, at a given place along the
 * weapon, so that every dot lands at the same height on the screen.
 *
 * A pistol's rear dots are half as far from the eye as its front one. Dropping
 * them all by the same few millimetres would stack them down the screen in a
 * diagonal and make a sight picture that is aligned look crooked, so the drop
 * is an angle and the millimetres follow from where the dot is.
 */
const DOT_DROP_DEGREES = 0.45;
const dotDrop = (z: number): number => Math.tan(DOT_DROP_DEGREES * DEG_TO_RAD) * (AIM_DISTANCE + z);

/**
 * The surfaces a finish paints.
 *
 * A finish supplies three colours and nothing else, which is the whole design
 * of them. The other three are derived from those: `shadow` is the metal
 * darkened for recesses and slots, `highlight` is the body lifted for wear on
 * edges, and `optic` is the one colour a finish does not own, because a glowing
 * sight dot that changed colour with the paint would stop reading as a light.
 */
export type Tone = "body" | "metal" | "accent" | "shadow" | "highlight" | "optic";

export type Shape = "box" | "cylinder" | "ring" | "sphere";

export interface Part {
  shape: Shape;
  /** Centre of the part, in metres from the grip. */
  x: number;
  y: number;
  z: number;
  /**
   * The box this part fits inside, along its own axes.
   *
   * Every shape is described by its bounds rather than by its own parameters,
   * so one occlusion test covers all of them — and covers them cautiously,
   * since a cylinder or a ring only ever occupies less than its box.
   */
  width: number;
  height: number;
  depth: number;
  tone: Tone;
  /** Radians about the part's own centre, applied yaw, then pitch, then roll. */
  rotation?: { x?: number; y?: number; z?: number };
  /** Which way a cylinder runs, or which way a ring faces. Default forward. */
  axis?: "x" | "y" | "z";
  /** Sides on a cylinder or ring. Low numbers read as machined flats. */
  facets?: number;
  /** A cylinder's far-end diameter as a fraction of its near end. */
  taper?: number;
  /** A ring's wall thickness. */
  thickness?: number;
  /**
   * Marks the sight assembly.
   *
   * Aiming deliberately parks the sights on the screen centre — that is what
   * aiming is — so they are the one part of the weapon excused from the rule
   * that nothing may cover the crosshair.
   */
  role?: "sight";
  /**
   * Marks the reciprocating parts: bolt carrier, slide, pump.
   *
   * These are built onto their own node so they can travel backward as the
   * weapon fires, which is the single detail that tells a player at a glance
   * that the weapon is working rather than playing an animation at them.
   */
  group?: "bolt";
}

export interface SightLine {
  /** Height of the line of sight above the grip, in metres. */
  height: number;
  /** Where the rear sight sits along the weapon. */
  rearZ: number;
  /** Where the front sight sits. */
  frontZ: number;
}

export interface CounterMount {
  x: number;
  y: number;
  z: number;
  group?: "bolt";
}

/** The counter's face, in metres. Two to one, like its texture. */
export const COUNTER_SIZE = { width: 0.03, height: 0.015 };

export interface ModelSpec {
  parts: Part[];
  /**
   * The line the shooter looks along.
   *
   * Aiming lines this up with the screen centre, and both sights are built at
   * this exact height, so looking down the weapon puts the front post inside
   * the rear aperture with the target on top of it — the sight picture doing
   * the work rather than a crosshair drawn over the top of it.
   */
  sightLine: SightLine;
  /** Where the sight sits. Derived from the sight line, never written twice. */
  sight: { x: number; y: number; z: number };
  /** Where the muzzle flash sits, at the front of the barrel. */
  muzzle: { y: number; z: number };
  /**
   * Where the round counter sits: a small display on the back of the weapon,
   * facing the shooter. On a weapon whose whole top moves with the bolt, the
   * counter rides with it.
   */
  counter: CounterMount;
  /** How far the bolt, slide or pump travels back on firing, in metres. */
  boltTravel: number;
}

/* ------------------------------------------------------------------ *
 * Assemblies.
 *
 * The weapons are composed from these rather than listed part by part, so
 * that the pieces which have to agree with each other — both sights on one
 * line, teeth evenly along a rail, a magazine curving as one body — agree by
 * construction instead of by careful typing.
 * ------------------------------------------------------------------ */

const box = (part: Omit<Part, "shape">): Part => ({ shape: "box", ...part });

/**
 * A length of accessory rail: a base with slots cut across it.
 *
 * The teeth are what make a rail read as a rail rather than as a raised strip,
 * and they are the cheapest detail on the weapon — a run of small boxes that
 * merges into the same mesh as everything else it sits on.
 */
const rail = (fromZ: number, toZ: number, y: number, width = 0.030): Part[] => {
  const pitch = 0.0142;
  const count = Math.max(1, Math.floor((toZ - fromZ) / pitch));
  const parts: Part[] = [
    // The base ends where the teeth begin. Overlapping them by even a
    // couple of millimetres puts its sides in the same plane as theirs,
    // and the whole rail edge shimmers.
    box({
      x: 0,
      y: y - 0.007,
      z: (fromZ + toZ) / 2,
      width,
      height: 0.008,
      depth: toZ - fromZ,
      tone: "metal",
    }),
  ];
  for (let i = 0; i < count; i += 1) {
    parts.push(
      box({
        x: 0,
        y,
        z: fromZ + pitch * (i + 0.5),
        width,
        height: 0.006,
        depth: 0.0088,
        tone: "metal",
      }),
    );
  }
  return parts;
};

/** Machined slots along the side of a handguard, in the shadow tone. */
const slots = (fromZ: number, toZ: number, y: number, x: number, count: number): Part[] => {
  const parts: Part[] = [];
  const span = (toZ - fromZ) / count;
  for (let i = 0; i < count; i += 1) {
    for (const side of [-1, 1]) {
      parts.push(
        box({
          x: x * side,
          y,
          z: fromZ + span * (i + 0.5),
          width: 0.006,
          height: 0.012,
          depth: span * 0.55,
          tone: "shadow",
        }),
      );
    }
  }
  return parts;
};

/**
 * A rear aperture on its riser: look through the ring, not at it.
 *
 * The ring is drawn far larger than one on a real rifle. A true aperture is a
 * few millimetres across and sits a hand's width from the eye; at arm's length
 * on a phone screen it would be a smudge, so it is opened up until it reads as
 * a ring, which is the thing it is there to do.
 */
const rearAperture = (line: SightLine, outer = 0.030, wall = 0.0045): Part[] => {
  const { height: y, rearZ: z } = line;
  return [
    box({
      x: 0,
      y: y - outer / 2 - 0.009,
      z,
      width: 0.018,
      height: 0.020,
      depth: 0.013,
      tone: "metal",
      role: "sight",
    }),
    {
      shape: "ring",
      axis: "z",
      x: 0,
      y,
      z,
      width: outer,
      height: outer,
      depth: wall,
      thickness: wall,
      facets: 18,
      tone: "metal",
      role: "sight",
    },
  ];
};

/**
 * A front post with protective ears and a night dot.
 *
 * The post's tip sits exactly on the line of sight, so the target rests on top
 * of it rather than behind it.
 */
const frontPost = (line: SightLine, baseHeight: number): Part[] => {
  const { height: y, frontZ: z } = line;
  return [
    box({
      x: 0,
      y: y - 0.010 - baseHeight / 2,
      z,
      width: 0.016,
      height: baseHeight,
      depth: 0.018,
      tone: "metal",
      role: "sight",
    }),
    box({
      x: 0,
      y: y - 0.009,
      z,
      width: 0.0065,
      height: 0.018,
      depth: 0.0055,
      tone: "metal",
      role: "sight",
    }),
    {
      shape: "sphere",
      x: 0,
      y: y - dotDrop(z),
      z: z - 0.004,
      width: 0.0055,
      height: 0.0055,
      depth: 0.0055,
      tone: "optic",
      role: "sight",
    },
    ...[-1, 1].map((side) =>
      box({
        x: 0.016 * side,
        y: y - 0.004,
        z,
        width: 0.004,
        height: 0.028,
        depth: 0.008,
        tone: "metal",
        role: "sight",
      }),
    ),
  ];
};

/** A notch rear sight, for a weapon with no room for an aperture. */
const rearNotch = (line: SightLine): Part[] => {
  const { height: y, rearZ: z } = line;
  return [
    box({
      x: 0,
      y: y - 0.011,
      z,
      width: 0.030,
      height: 0.008,
      depth: 0.010,
      tone: "metal",
      role: "sight",
    }),
    ...[-1, 1].map((side) =>
      box({
        x: 0.0085 * side,
        y: y - 0.0065,
        z,
        width: 0.005,
        height: 0.013,
        depth: 0.009,
        tone: "metal",
        role: "sight",
      }),
    ),
    ...[-1, 1].map((side) => ({
      shape: "sphere" as const,
      x: 0.0085 * side,
      y: y - dotDrop(z),
      z: z - 0.004,
      width: 0.004,
      height: 0.004,
      depth: 0.004,
      tone: "optic" as const,
      role: "sight" as const,
    })),
  ];
};

/** A front blade, for the weapons carrying a notch rather than a ring. */
const frontBlade = (line: SightLine, baseHeight: number): Part[] => {
  const { height: y, frontZ: z } = line;
  return [
    box({
      x: 0,
      y: y - 0.009 - baseHeight / 2,
      z,
      width: 0.014,
      height: baseHeight,
      depth: 0.014,
      tone: "metal",
      role: "sight",
    }),
    box({
      x: 0,
      y: y - 0.008,
      z,
      width: 0.007,
      height: 0.016,
      depth: 0.005,
      tone: "metal",
      role: "sight",
    }),
    {
      shape: "sphere",
      x: 0,
      y: y - dotDrop(z),
      z: z - 0.003,
      width: 0.006,
      height: 0.006,
      depth: 0.006,
      tone: "optic",
      role: "sight",
    },
  ];
};

/**
 * A magazine, built from segments that each lean a little further than the
 * last so the body curves the way a loaded one does.
 */
const magazine = (
  topY: number,
  topZ: number,
  segments: number,
  segmentHeight: number,
  width: number,
  depth: number,
  curve: number,
  tone: Tone = "accent",
): Part[] => {
  const parts: Part[] = [];
  let y = topY;
  let z = topZ;
  for (let i = 0; i < segments; i += 1) {
    const lean = curve * i;
    y -= (segmentHeight * Math.cos(lean)) / (i === 0 ? 2 : 1);
    z += segmentHeight * Math.sin(lean) * (i === 0 ? 0.5 : 1);
    parts.push(
      box({
        x: 0,
        y,
        z,
        width,
        height: segmentHeight * 1.06,
        depth,
        tone,
        rotation: { x: -lean },
      }),
    );
  }
  // Floorplate: the one part of a magazine anybody ever looks at.
  parts.push(
    box({
      x: 0,
      y: y - segmentHeight / 2 - 0.004,
      z: z + segmentHeight * Math.sin(curve * segments) * 0.5,
      width: width + 0.006,
      height: 0.010,
      depth: depth + 0.006,
      tone: "shadow",
      rotation: { x: -curve * (segments - 1) },
    }),
  );
  return parts;
};

/** A pistol grip, leaning back under the receiver, with panelling. */
const pistolGrip = (
  x: number,
  y: number,
  z: number,
  height: number,
  lean: number,
  tone: Tone = "accent",
): Part[] => {
  const parts: Part[] = [
    box({
      x,
      y,
      z,
      width: 0.036,
      height,
      depth: 0.050,
      tone,
      rotation: { x: -lean },
    }),
    box({
      x,
      y: y - height / 2 - 0.004,
      z: z + Math.sin(lean) * height * 0.5,
      width: 0.040,
      height: 0.010,
      depth: 0.056,
      tone: "shadow",
      rotation: { x: -lean },
    }),
  ];
  // Chequering, as a run of ridges down both faces.
  for (let i = 0; i < 4; i += 1) {
    const t = (i + 0.5) / 4 - 0.5;
    parts.push(
      box({
        x,
        y: y - t * height * 0.8,
        z: z + Math.sin(lean) * t * height * 0.8 - 0.026,
        width: 0.030,
        height: 0.006,
        depth: 0.006,
        tone: "shadow",
        rotation: { x: -lean },
      }),
    );
  }
  return parts;
};

/** A trigger inside its guard. */
const trigger = (y: number, z: number, radius: number): Part[] => [
  {
    shape: "ring",
    axis: "x",
    x: 0,
    y,
    z,
    width: 0.010,
    height: radius * 2,
    depth: radius * 2,
    thickness: 0.006,
    facets: 16,
    tone: "metal",
  },
  box({
    x: 0,
    y: y + 0.006,
    z: z + 0.002,
    width: 0.008,
    height: 0.024,
    depth: 0.009,
    tone: "shadow",
    rotation: { x: 0.25 },
  }),
];

/** Grip serrations: the short ridges cut into a slide or a charging handle. */
const serrations = (
  x: number,
  y: number,
  fromZ: number,
  toZ: number,
  count: number,
  height: number,
  group?: "bolt",
): Part[] => {
  const parts: Part[] = [];
  const pitch = (toZ - fromZ) / count;
  for (let i = 0; i < count; i += 1) {
    for (const side of [-1, 1]) {
      parts.push(
        box({
          x: x * side,
          y,
          z: fromZ + pitch * (i + 0.5),
          width: 0.004,
          height,
          depth: pitch * 0.45,
          tone: "shadow",
          group,
        }),
      );
    }
  }
  return parts;
};

/**
 * A collapsible stock, closed up on its receiver extension.
 *
 * Kept short and mostly air. A stock is the one part of a weapon that sits
 * against the shooter, which in first person is behind the camera, so a full
 * extended one lands a few centimetres from the near plane and perspective
 * blows it up until it covers the screen. Collapsed, skeletonised, and with
 * its comb no higher than the tube it rides, it stays under the line of
 * sight and finishes the weapon off instead.
 */
const collapsedStock = (tubeY: number, backZ: number, frontZ: number): Part[] => {
  const length = frontZ - backZ;
  const middle = backZ + length / 2;
  return [
    // Cheek walls either side of the tube, with the tube showing between
    // them: this is what makes it read as a frame rather than a block.
    ...[-1, 1].map((side) =>
      box({
        x: 0.0205 * side,
        y: tubeY + 0.005,
        z: middle + 0.008,
        width: 0.008,
        height: 0.038,
        depth: length - 0.03,
        tone: "body",
      }),
    ),
    // The comb, stepped down towards the butt the way a real one tapers.
    box({
      x: 0,
      y: tubeY + 0.021,
      z: frontZ - 0.035,
      width: 0.031,
      height: 0.012,
      depth: 0.07,
      tone: "body",
    }),
    box({
      x: 0,
      y: tubeY + 0.017,
      z: backZ + 0.045,
      width: 0.031,
      height: 0.012,
      depth: 0.062,
      tone: "body",
    }),
    // Ridges across the comb, narrower than it so they read as something
    // laid on the cheek rest rather than bars painted over the whole stock.
    ...[0, 1].map((i) =>
      box({
        x: 0,
        y: tubeY + 0.026,
        z: backZ + 0.052 + i * 0.018,
        width: 0.025,
        height: 0.004,
        depth: 0.007,
        tone: "shadow",
      }),
    ),
    // The butt pad: rubber, taller than the rest, and the one part of the
    // stock the shooter actually meets.
    box({
      x: 0,
      y: tubeY - 0.004,
      z: backZ + 0.009,
      width: 0.046,
      height: 0.064,
      depth: 0.018,
      tone: "shadow",
    }),
    ...[-1, 1].map((side) =>
      box({
        x: 0,
        y: tubeY - 0.004 + 0.016 * side,
        z: backZ + 0.002,
        width: 0.048,
        height: 0.005,
        depth: 0.006,
        tone: "metal",
      }),
    ),
    // The underside: a strut back to the butt, the release lever under the
    // tube, and a loop for a sling.
    box({
      x: 0,
      y: tubeY - 0.019,
      z: middle - 0.004,
      width: 0.024,
      height: 0.016,
      depth: length - 0.05,
      tone: "body",
    }),
    box({
      x: 0,
      y: tubeY - 0.030,
      z: frontZ - 0.048,
      width: 0.018,
      height: 0.014,
      depth: 0.032,
      tone: "metal",
    }),
    {
      shape: "ring",
      axis: "x",
      x: -0.024,
      y: tubeY - 0.012,
      z: backZ + 0.042,
      width: 0.016,
      height: 0.016,
      depth: 0.006,
      thickness: 0.004,
      facets: 8,
      tone: "metal",
    },
    // The notches the stock locks into, along the underside of the tube.
    ...[0, 1, 2, 3].map((i) =>
      box({
        x: 0,
        y: tubeY - 0.017,
        z: frontZ - 0.012 - i * 0.016,
        width: 0.026,
        height: 0.005,
        depth: 0.006,
        tone: "shadow",
      }),
    ),
  ];
};

/* ------------------------------------------------------------------ *
 * The weapons.
 *
 * Local space runs from the rear of the receiver forward, with the origin at
 * the firing hand. Anything behind the receiver is close enough to the eye
 * that it has to earn its place: see `collapsedStock` for what a shoulder
 * stock has to be to fit in a first-person view at all.
 * ------------------------------------------------------------------ */

const ridgeline = (): ModelSpec => {
  const sightLine: SightLine = { height: 0.100, rearZ: 0.115, frontZ: 0.565 };
  const bore = 0.030;
  const parts: Part[] = [
    // Upper receiver, flat-topped, with the rail the sights ride on.
    box({ x: 0, y: 0.034, z: 0.245, width: 0.058, height: 0.056, depth: 0.31, tone: "body" }),
    // A raised rear deck, the full width of the receiver and in its tone, so
    // it is part of the receiver rather than a fitting on it. The rear sight
    // rises out of it; the round count is projected off its back face.
    box({ x: 0, y: 0.0705, z: 0.106, width: 0.058, height: 0.017, depth: 0.034, tone: "body" }),
    // Receiver extension, running back past the eye, with the stock riding
    // it. Without it the weapon presents a flat wall to the shooter down the
    // sights, and the whole lower half of the screen becomes a grey slab.
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: 0.030,
      z: 0.006,
      width: 0.036,
      height: 0.036,
      depth: 0.178,
      facets: 12,
      tone: "metal",
    },
    ...collapsedStock(0.030, -0.148, 0.012),
    {
      shape: "ring",
      axis: "z",
      x: 0,
      y: 0.030,
      z: 0.082,
      width: 0.048,
      height: 0.048,
      depth: 0.014,
      thickness: 0.009,
      facets: 12,
      tone: "shadow",
    },
    ...rail(0.100, 0.345, 0.069),
    ...rearAperture(sightLine),

    // The right-hand side: ejection port, deflector, forward assist.
    box({ x: 0.031, y: 0.040, z: 0.235, width: 0.008, height: 0.026, depth: 0.075, tone: "shadow" }),
    box({
      x: 0.032,
      y: 0.050,
      z: 0.175,
      width: 0.012,
      height: 0.018,
      depth: 0.022,
      tone: "body",
      rotation: { y: 0.35 },
    }),
    {
      shape: "cylinder",
      axis: "x",
      x: 0.033,
      y: 0.046,
      z: 0.165,
      width: 0.016,
      height: 0.013,
      depth: 0.013,
      facets: 10,
      tone: "metal",
    },

    // Bolt carrier and charging handle: these ride back when it fires.
    box({
      x: 0,
      y: 0.057,
      z: 0.105,
      width: 0.052,
      height: 0.011,
      depth: 0.034,
      tone: "metal",
      group: "bolt",
    }),
    box({
      x: -0.026,
      y: 0.057,
      z: 0.099,
      width: 0.014,
      height: 0.014,
      depth: 0.018,
      tone: "highlight",
      group: "bolt",
    }),
    box({
      x: 0.028,
      y: 0.040,
      z: 0.225,
      width: 0.010,
      height: 0.022,
      depth: 0.060,
      tone: "metal",
      group: "bolt",
    }),

    // Lower receiver, magwell and controls.
    // Its rear stands a few millimetres proud of the upper's; two faces in
    // one plane, right where the eye rests, is what the receiver used to be.
    box({ x: 0, y: -0.004, z: 0.1925, width: 0.048, height: 0.050, depth: 0.215, tone: "body" }),
    box({ x: 0, y: -0.031, z: 0.205, width: 0.042, height: 0.016, depth: 0.086, tone: "body" }),
    ...magazine(-0.036, 0.205, 3, 0.048, 0.024, 0.072, 0.13),
    ...trigger(-0.030, 0.140, 0.024),
    ...pistolGrip(0, -0.080, 0.078, 0.105, 0.30),
    {
      shape: "cylinder",
      axis: "x",
      x: -0.027,
      y: 0.008,
      z: 0.108,
      width: 0.014,
      height: 0.016,
      depth: 0.016,
      facets: 12,
      tone: "metal",
    },
    box({
      x: -0.032,
      y: 0.012,
      z: 0.116,
      width: 0.008,
      height: 0.009,
      depth: 0.026,
      tone: "highlight",
      rotation: { x: 0.5 },
    }),
    box({ x: 0.027, y: -0.002, z: 0.178, width: 0.008, height: 0.013, depth: 0.013, tone: "metal" }),
    box({ x: -0.027, y: -0.008, z: 0.158, width: 0.006, height: 0.014, depth: 0.032, tone: "metal" }),
    ...[0.118, 0.283].map((z) => ({
      shape: "cylinder" as const,
      axis: "x" as const,
      x: 0,
      y: 0.012,
      z,
      width: 0.052,
      height: 0.010,
      depth: 0.010,
      facets: 10,
      tone: "shadow" as const,
    })),

    // Handguard: an eight-sided tube with slots cut down both sides.
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: 0.032,
      z: 0.4775,
      width: 0.050,
      height: 0.050,
      depth: 0.165,
      facets: 8,
      tone: "body",
    },
    ...rail(0.405, 0.547, 0.062, 0.026),
    ...slots(0.410, 0.550, 0.030, 0.0245, 4),
    {
      shape: "ring",
      axis: "z",
      x: 0,
      y: 0.032,
      z: 0.398,
      width: 0.056,
      height: 0.056,
      depth: 0.010,
      thickness: 0.006,
      facets: 8,
      tone: "metal",
    },

    // Gas system, barrel and muzzle.
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: 0.052,
      z: 0.508,
      width: 0.009,
      height: 0.009,
      depth: 0.115,
      facets: 8,
      tone: "metal",
    },
    box({ x: 0, y: 0.046, z: 0.565, width: 0.030, height: 0.030, depth: 0.032, tone: "metal" }),
    ...frontPost(sightLine, 0.030),
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.585,
      width: 0.019,
      height: 0.019,
      depth: 0.060,
      facets: 14,
      tone: "metal",
    },
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.6375,
      width: 0.026,
      height: 0.026,
      depth: 0.045,
      facets: 6,
      tone: "metal",
    },
    {
      shape: "ring",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.657,
      width: 0.027,
      height: 0.027,
      depth: 0.006,
      thickness: 0.005,
      facets: 6,
      tone: "shadow",
    },
  ];
  return {
    parts,
    sightLine,
    sight: { x: 0, y: sightLine.height, z: sightLine.rearZ },
    muzzle: { y: bore, z: 0.665 },
    counter: { x: 0, y: 0.0705, z: 0.0884 },
    boltTravel: 0.016,
  };
};

const wasp = (): ModelSpec => {
  const sightLine: SightLine = { height: 0.086, rearZ: 0.085, frontZ: 0.395 };
  const bore = 0.026;
  const parts: Part[] = [
    // A compact stamped receiver, squarer and shorter than the rifle's.
    box({ x: 0, y: 0.028, z: 0.180, width: 0.052, height: 0.052, depth: 0.25, tone: "body" }),
    box({ x: 0, y: 0.028, z: 0.020, width: 0.036, height: 0.040, depth: 0.080, tone: "metal" }),
    // The rear deck the sight rises from, continuing the receiver's rear
    // face upward; the round count is projected off it.
    box({ x: 0, y: 0.0615, z: 0.075, width: 0.052, height: 0.015, depth: 0.040, tone: "body" }),
    {
      shape: "cylinder",
      axis: "x",
      x: 0.022,
      y: 0.028,
      z: -0.004,
      width: 0.022,
      height: 0.026,
      depth: 0.026,
      facets: 12,
      tone: "shadow",
    },
    ...rail(0.070, 0.265, 0.060, 0.026),
    ...rearAperture(sightLine, 0.026, 0.004),
    box({ x: 0.028, y: 0.034, z: 0.175, width: 0.008, height: 0.022, depth: 0.060, tone: "shadow" }),
    box({
      x: 0.026,
      y: 0.034,
      z: 0.165,
      width: 0.010,
      height: 0.018,
      depth: 0.046,
      tone: "metal",
      group: "bolt",
    }),
    box({
      x: 0,
      y: 0.050,
      z: 0.075,
      width: 0.046,
      height: 0.010,
      depth: 0.030,
      tone: "metal",
      group: "bolt",
    }),
    ...serrations(0.025, 0.030, 0.100, 0.150, 4, 0.024),

    // Magazine ahead of the grip, in the housing that doubles as a foregrip.
    box({ x: 0, y: -0.010, z: 0.140, width: 0.044, height: 0.044, depth: 0.16, tone: "body" }),
    ...[0.085, 0.115, 0.145].map((z) => ({
      shape: "cylinder" as const,
      axis: "x" as const,
      x: 0,
      y: -0.030,
      z,
      width: 0.046,
      height: 0.014,
      depth: 0.014,
      facets: 10,
      tone: "shadow" as const,
    })),
    {
      shape: "ring",
      axis: "x",
      x: -0.026,
      y: 0.006,
      z: 0.062,
      width: 0.008,
      height: 0.020,
      depth: 0.020,
      thickness: 0.004,
      facets: 10,
      tone: "metal",
    },
    ...magazine(-0.030, 0.150, 3, 0.042, 0.022, 0.058, 0.06),
    ...trigger(-0.026, 0.108, 0.022),
    ...pistolGrip(0, -0.072, 0.058, 0.096, 0.26),
    box({ x: -0.026, y: 0.004, z: 0.082, width: 0.008, height: 0.010, depth: 0.024, tone: "metal" }),

    // Barrel shroud, ported, with the front sight riding the end of it.
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: 0.028,
      z: 0.355,
      width: 0.044,
      height: 0.044,
      depth: 0.135,
      facets: 10,
      tone: "body",
    },
    ...slots(0.300, 0.400, 0.028, 0.0215, 3),
    {
      shape: "ring",
      axis: "z",
      x: 0,
      y: 0.028,
      z: 0.300,
      width: 0.050,
      height: 0.050,
      depth: 0.010,
      thickness: 0.006,
      facets: 10,
      tone: "metal",
    },
    ...frontPost(sightLine, 0.026),
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.420,
      width: 0.016,
      height: 0.016,
      depth: 0.045,
      facets: 12,
      tone: "metal",
    },
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.450,
      width: 0.023,
      height: 0.023,
      depth: 0.030,
      taper: 0.85,
      facets: 8,
      tone: "metal",
    },
  ];
  return {
    parts,
    sightLine,
    sight: { x: 0, y: sightLine.height, z: sightLine.rearZ },
    muzzle: { y: bore, z: 0.468 },
    counter: { x: 0, y: 0.0615, z: 0.0545 },
    boltTravel: 0.014,
  };
};

const breacher = (): ModelSpec => {
  const sightLine: SightLine = { height: 0.092, rearZ: 0.075, frontZ: 0.600 };
  const bore = 0.034;
  const parts: Part[] = [
    // Receiver, milled flat on top, with a big ghost ring behind it.
    box({ x: 0, y: 0.026, z: 0.170, width: 0.054, height: 0.058, depth: 0.25, tone: "body" }),
    // The rear deck over the tang, continuing the receiver's rear face
    // upward under the ghost ring; the round count is projected off it.
    box({ x: 0, y: 0.063, z: 0.066, width: 0.054, height: 0.016, depth: 0.042, tone: "body" }),
    // Receiver tang and the stub of a stock, rounded off rather than left as
    // a flat wall for the shooter to look at down the sights.
    box({ x: 0, y: 0.014, z: 0.012, width: 0.034, height: 0.042, depth: 0.078, tone: "body" }),
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: 0.020,
      z: -0.010,
      width: 0.038,
      height: 0.038,
      depth: 0.040,
      taper: 0.72,
      facets: 10,
      tone: "accent",
    },
    box({ x: 0, y: 0.036, z: 0.026, width: 0.022, height: 0.010, depth: 0.052, tone: "highlight" }),
    ...rail(0.060, 0.230, 0.062, 0.028),
    ...rearAperture(sightLine, 0.036, 0.005),
    box({ x: 0.029, y: 0.024, z: 0.165, width: 0.008, height: 0.028, depth: 0.070, tone: "shadow" }),
    box({ x: 0, y: -0.006, z: 0.150, width: 0.046, height: 0.020, depth: 0.090, tone: "shadow" }),
    ...trigger(-0.034, 0.110, 0.026),
    ...pistolGrip(0, -0.082, 0.060, 0.100, 0.28),
    box({ x: 0.026, y: 0.048, z: 0.085, width: 0.010, height: 0.010, depth: 0.014, tone: "highlight" }),

    // Barrel over a tube magazine, with the pump riding the tube.
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.430,
      width: 0.028,
      height: 0.028,
      depth: 0.330,
      facets: 14,
      tone: "metal",
    },
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: 0.004,
      z: 0.420,
      width: 0.024,
      height: 0.024,
      depth: 0.300,
      facets: 12,
      tone: "metal",
    },
    box({ x: 0, y: 0.018, z: 0.310, width: 0.020, height: 0.026, depth: 0.040, tone: "body" }),
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: 0.008,
      z: 0.400,
      width: 0.050,
      height: 0.050,
      depth: 0.130,
      facets: 10,
      tone: "accent",
      group: "bolt",
    },
    ...[0.350, 0.380, 0.410, 0.440].map((z) => ({
      shape: "ring" as const,
      axis: "z" as const,
      x: 0,
      y: 0.008,
      z,
      width: 0.054,
      height: 0.054,
      depth: 0.008,
      thickness: 0.006,
      facets: 10,
      tone: "shadow" as const,
      group: "bolt" as const,
    })),

    // Front bead on a tall blade, and a choked muzzle.
    ...frontBlade(sightLine, 0.032),
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.610,
      width: 0.032,
      height: 0.032,
      depth: 0.040,
      facets: 12,
      tone: "metal",
    },
    {
      shape: "ring",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.628,
      width: 0.033,
      height: 0.033,
      depth: 0.006,
      thickness: 0.006,
      facets: 12,
      tone: "shadow",
    },
  ];
  return {
    parts,
    sightLine,
    sight: { x: 0, y: sightLine.height, z: sightLine.rearZ },
    muzzle: { y: bore, z: 0.634 },
    counter: { x: 0, y: 0.063, z: 0.0445 },
    boltTravel: 0.030,
  };
};

const sidearm = (): ModelSpec => {
  const sightLine: SightLine = { height: 0.057, rearZ: 0.022, frontZ: 0.196 };
  const bore = 0.024;
  const parts: Part[] = [
    // Slide, which is the part that moves, so everything on it moves with it.
    box({
      x: 0,
      y: 0.024,
      z: 0.115,
      width: 0.034,
      height: 0.034,
      depth: 0.205,
      tone: "metal",
      group: "bolt",
    }),
    // A millimetre short of the slide at both ends, so its faces are not
    // the slide's faces.
    box({
      x: 0,
      y: 0.040,
      z: 0.115,
      width: 0.024,
      height: 0.008,
      depth: 0.203,
      tone: "metal",
      group: "bolt",
    }),
    ...serrations(0.017, 0.026, 0.030, 0.075, 5, 0.022, "bolt"),
    ...serrations(0.017, 0.026, 0.150, 0.190, 4, 0.022, "bolt"),
    box({
      x: 0.0145,
      y: 0.030,
      z: 0.150,
      width: 0.007,
      height: 0.018,
      depth: 0.050,
      tone: "shadow",
      group: "bolt",
    }),
    ...rearNotch(sightLine).map((part) => ({ ...part, group: "bolt" as const })),
    ...frontBlade(sightLine, 0.007).map((part) => ({ ...part, group: "bolt" as const })),
    {
      shape: "cylinder",
      axis: "z",
      x: 0,
      y: bore,
      z: 0.212,
      width: 0.014,
      height: 0.014,
      depth: 0.024,
      facets: 12,
      tone: "shadow",
      group: "bolt",
    },

    // Frame: rail, trigger, grip, magazine.
    box({ x: 0, y: -0.002, z: 0.090, width: 0.028, height: 0.022, depth: 0.150, tone: "body" }),
    ...rail(0.110, 0.160, -0.014, 0.020),
    ...trigger(-0.022, 0.072, 0.020),
    box({ x: -0.016, y: 0.004, z: 0.055, width: 0.006, height: 0.010, depth: 0.030, tone: "highlight" }),
    box({ x: 0.016, y: 0.002, z: 0.045, width: 0.006, height: 0.012, depth: 0.014, tone: "metal" }),
    ...pistolGrip(0, -0.064, 0.030, 0.100, 0.20, "body"),
    box({ x: 0, y: -0.016, z: 0.030, width: 0.034, height: 0.026, depth: 0.048, tone: "body" }),
  ];
  return {
    parts,
    sightLine,
    sight: { x: 0, y: sightLine.height, z: sightLine.rearZ },
    muzzle: { y: bore, z: 0.226 },
    counter: { x: 0, y: 0.026, z: 0.0119, group: "bolt" },
    boltTravel: 0.022,
  };
};

export const MODELS: Record<WeaponId, ModelSpec> = {
  ar: ridgeline(),
  smg: wasp(),
  shotgun: breacher(),
  pistol: sidearm(),
};

/* ------------------------------------------------------------------ *
 * Where the weapon is held, and what it covers from there.
 * ------------------------------------------------------------------ */

/**
 * Where the weapon rests in the hands.
 *
 * The z figure is what keeps the weapon in proportion. Its parts run from the
 * grip to two thirds of a metre ahead, so a small z puts the receiver level
 * with the eye, where perspective blows the near end up until it swallows the
 * screen. The y figure sets the line of sight a little below the middle of the
 * screen at the hip, which is what makes raising the sights read as raising
 * them.
 */
export const POSE = {
  /** Hip-fire rest pose, right of centre and low. */
  hip: { x: 0.13, y: -0.118, z: 0.40 },
  /** Pulled in and tilted when sprinting, so the sights are plainly unusable. */
  sprint: { x: 0.14, y: -0.173, z: 0.32 },
  sprintRoll: -0.42,
  sprintPitch: 0.30,
  sprintYaw: 0.34,
  /** Lowered and rolled during a reload. */
  reload: { x: 0.11, y: -0.253, z: 0.34 },
  reloadRoll: 0.55,
  reloadPitch: 0.42,
  /** Dropped out of frame while a swap is in progress. */
  swap: { x: 0.105, y: -0.423, z: 0.36 },
  swapPitch: 0.55,
  /** Distance the weapon sits at when aimed. */
  aimZ: AIM_DISTANCE,
} as const;

/**
 * Where the weapon is held at a given aim progress, from the hip at 0 to fully
 * down the sights at 1.
 *
 * Aiming cancels the sight's own offset rather than blending toward a guessed
 * pose, which is what lines every weapon's sights up on the screen centre
 * exactly. Shared with the renderer so a test of what the player can see is
 * looking at the pose the player actually gets.
 */
export const holdPosition = (
  spec: ModelSpec,
  ads: number,
): { x: number; y: number; z: number } => {
  const aim = Math.min(1, Math.max(0, ads));
  return {
    x: POSE.hip.x + (-spec.sight.x - POSE.hip.x) * aim,
    y: POSE.hip.y + (-spec.sight.y - POSE.hip.y) * aim,
    z: POSE.hip.z + (POSE.aimZ - POSE.hip.z) * aim,
  };
};

/**
 * Where the weapon is held: the position and rotation the viewmodel writes
 * onto the model root each frame, in the camera's own frame.
 */
export interface WeaponPose {
  x: number;
  y: number;
  z: number;
  /** Radians, as the node's rotation: negative pitches the muzzle up. */
  pitch: number;
  yaw: number;
  roll: number;
  /** How far the reciprocating parts have travelled back, in metres. */
  boltBack?: number;
}

type Vec = [number, number, number];

/** A tenth of a micrometre: the width of "exactly level with". */
const GRAZE = 1e-7;

/**
 * Undo a yaw-pitch-roll rotation — roll, then pitch, then yaw, in Babylon's
 * left-handed frame — to carry a ray into the rotated body's own space.
 */
const unrotate = (v: Vec, yaw: number, pitch: number, roll: number): Vec => {
  let [x, y, z] = v;
  const cr = Math.cos(-roll);
  const sr = Math.sin(-roll);
  [x, y] = [x * cr - y * sr, x * sr + y * cr];
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  return [x, y, z];
};

/**
 * Does the ray straight out of the middle of the screen strike this part?
 *
 * The ray is carried into the part's own frame rather than the part's corners
 * being carried out of it: in there the box is axis aligned and the test is
 * three slabs. Shapes are tested as the box they fit inside, which can only
 * ever be cautious — a cylinder, a ring or a sphere occupies less than its box,
 * never more.
 */
const rayHitsPart = (part: Part, pose: WeaponPose, view: Vec = [0, 0, 1]): boolean => {
  const model = {
    origin: unrotate([-pose.x, -pose.y, -pose.z], pose.yaw, pose.pitch, pose.roll),
    direction: unrotate(view, pose.yaw, pose.pitch, pose.roll),
  };

  const back = part.group === "bolt" ? (pose.boltBack ?? 0) : 0;
  const centre: Vec = [part.x, part.y, part.z - back];
  const spin = part.rotation;
  const origin: Vec = [
    model.origin[0] - centre[0],
    model.origin[1] - centre[1],
    model.origin[2] - centre[2],
  ];
  const local = spin
    ? unrotate(origin, spin.y ?? 0, spin.x ?? 0, spin.z ?? 0)
    : origin;
  const direction = spin
    ? unrotate(model.direction, spin.y ?? 0, spin.x ?? 0, spin.z ?? 0)
    : model.direction;

  const half: Vec = [part.width / 2, part.height / 2, part.depth / 2];
  if (part.shape === "ring") return rayThroughRing(part, local, direction, half);

  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = local[axis];
    const d = direction[axis];
    if (Math.abs(d) < 1e-9) {
      // Running parallel to this pair of faces: either between them or past
      // them. Exactly level with one counts as past, because a ray grazing a
      // surface sees over it — which is the whole sight picture, the target
      // sitting on the tip of a post that is precisely on the line of sight.
      if (o <= -half[axis] + GRAZE || o >= half[axis] - GRAZE) return false;
      continue;
    }
    const t1 = (-half[axis] - o) / d;
    const t2 = (half[axis] - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return false;
  }
  return far >= near;
};

/**
 * A ring is the one shape whose hole matters.
 *
 * Everything else is tested as the box it fits inside, which can only be
 * cautious. A ring tested that way would be a disc, and the rear aperture —
 * the part a player looks *through* — would count as covering exactly the
 * thing it exists to frame. So this crosses the ray with the ring's plane and
 * asks how far out it lands. A ray running along the ring's plane rather than
 * through it falls back to the box, which is cautious again.
 */
const rayThroughRing = (part: Part, origin: Vec, direction: Vec, half: Vec): boolean => {
  const axis = part.axis ?? "z";
  const normal = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const across: [number, number] = normal === 0 ? [1, 2] : normal === 1 ? [0, 2] : [0, 1];
  if (Math.abs(direction[normal]) < 1e-6) {
    return (
      Math.abs(origin[normal]) <= half[normal] &&
      Math.abs(origin[across[0]]) <= half[across[0]] &&
      Math.abs(origin[across[1]]) <= half[across[1]]
    );
  }

  const t = -origin[normal] / direction[normal];
  if (t < 0) return false;
  const a = origin[across[0]] + direction[across[0]] * t;
  const b = origin[across[1]] + direction[across[1]] * t;
  const radius = Math.hypot(a, b);
  const outer = Math.max(half[across[0]], half[across[1]]);
  const inner = Math.max(0, outer - (part.thickness ?? 0.004));
  return radius >= inner && radius <= outer;
};

/**
 * Is any solid part of the weapon sitting on the screen centre?
 *
 * The sights are exempt, because putting them there is the whole point of
 * aiming. Everything else covering that point means the player has lost sight
 * of what they are shooting at.
 */
export const coversCentre = (
  spec: ModelSpec,
  pose: WeaponPose,
  options: { includeSights?: boolean; offsetDegrees?: [number, number] } = {},
): boolean => {
  // Looking a little off the centre answers what the sight picture frames,
  // rather than only what lies on the aim point itself. The ray is tilted, not
  // the weapon: turning the weapon would swing it about the grip and move it
  // as well as aim it.
  const [across, up] = options.offsetDegrees ?? [0, 0];
  const view: Vec =
    across === 0 && up === 0
      ? [0, 0, 1]
      : [Math.tan(across * DEG_TO_RAD), Math.tan(up * DEG_TO_RAD), 1];
  return spec.parts.some(
    (part) => (options.includeSights || part.role !== "sight") && rayHitsPart(part, pose, view),
  );
};

/** The largest muzzle rise the search below will look for, in degrees. */
const SEARCH_LIMIT_DEGREES = 60;

/**
 * How much further the muzzle could rise from this pose before the weapon
 * covers the crosshair, in degrees.
 *
 * This is the headroom a shot has to spend. It is measured rather than
 * asserted because it depends on the whole pose — how far the weapon has been
 * pulled back, how high it is held, which weapon it is — and every one of
 * those is a number somebody may reasonably want to change.
 */
export const riseHeadroomDegrees = (spec: ModelSpec, pose: WeaponPose): number => {
  const at = (degrees: number): boolean =>
    coversCentre(spec, { ...pose, pitch: pose.pitch - degrees * DEG_TO_RAD });

  if (at(0)) return 0;
  if (!at(SEARCH_LIMIT_DEGREES)) return Number.POSITIVE_INFINITY;

  let clear = 0;
  let covered = SEARCH_LIMIT_DEGREES;
  for (let i = 0; i < 40; i += 1) {
    const middle = (clear + covered) / 2;
    if (at(middle)) covered = middle;
    else clear = middle;
  }
  return clear;
};

const HEADROOM_SAMPLES = 64;
const HEADROOM_CACHE = new WeakMap<ModelSpec, Float64Array>();

/**
 * How far a weapon's muzzle can rise from its rest pose, at a given point in
 * the aim, before its body reaches the crosshair.
 *
 * This is the number recoil has to live inside, and it is a property of the
 * weapon's own shape: a long barrel under a low sight has almost none, a
 * stubby one with a raised post has plenty. From the hip it is unbounded,
 * because the weapon is held off to the side and never passes in front of the
 * crosshair at all. Deriving it rather than writing it down means a change to
 * a model changes the recoil budget with it, instead of quietly spending
 * clearance that is no longer there.
 *
 * Sampled and cached, because it is wanted every frame and depends on nothing
 * that changes within one. The aim is rounded upward to the next sample: the
 * weapon rises and centres as it comes up, so a later point in the aim always
 * has less room, and rounding that way can only be cautious.
 */
export const headroomDegrees = (spec: ModelSpec, ads: number): number => {
  let samples = HEADROOM_CACHE.get(spec);
  if (!samples) {
    samples = new Float64Array(HEADROOM_SAMPLES + 1).fill(Number.NaN);
    HEADROOM_CACHE.set(spec, samples);
  }
  const aim = Math.min(1, Math.max(0, ads));
  const index = Math.ceil(aim * HEADROOM_SAMPLES);
  const known = samples[index];
  if (!Number.isNaN(known)) return known;

  const rest = holdPosition(spec, index / HEADROOM_SAMPLES);
  const measured = riseHeadroomDegrees(spec, { ...rest, pitch: 0, yaw: 0, roll: 0 });
  samples[index] = measured;
  return measured;
};

/** The headroom a weapon has with the sights fully up, where it is tightest. */
export const aimedHeadroomDegrees = (spec: ModelSpec): number => headroomDegrees(spec, 1);
