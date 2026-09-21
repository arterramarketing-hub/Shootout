import { createRandom } from "../sim/random";
import type { BoxBrush } from "./types";

/**
 * What is outside the level.
 *
 * A map that ends at its own walls reads as a diagram of a place. Standing in
 * the street at Boulevard Works you could see over the fence at either end
 * and there was nothing there: haze, and then the sky. The fight is the same
 * either way, which is exactly why this is worth doing — it costs the player
 * nothing and it is most of what the level feels like.
 *
 * So: the street carries on. There is a boulevard across the end of it with
 * traffic signals nobody maintains, a row of two-storey storefronts with
 * their windows boarded, vacant lots between them where whole blocks came
 * down and the trees came back, and behind all of that the things that are
 * visible for miles in a city built on manufacturing — stacks, silos, a
 * water tower on legs, a freeway on piers, and the long blind flank of
 * another plant.
 *
 * None of it is solid. `BrushWorld` skips a brush with `solid: false`
 * outright, so none of this is in the physics, in the nav bake, or in a
 * bullet's way; it is geometry and nothing else. It all merges into the
 * level's existing meshes by surface and tint, so the whole backdrop costs a
 * handful of draw calls rather than one per building.
 *
 * Everything here is generic early-twentieth-century American industrial
 * building stock — brick blocks, steel sheds, concrete silos. It is nowhere
 * in particular and copies nothing.
 */

/** How far out the backdrop reaches. The far clip is 220 m. */
const REACH = 150;

/**
 * The tints, from near to far.
 *
 * Distance is fog's job, not paint's, so these are not faded by hand — they
 * are simply the colours the buildings are. What they do carry is variety:
 * a backdrop of one brick is a wallpaper, and the eye reads wallpaper as
 * flat however far away it is.
 *
 * They follow the level's own split: concrete, steel and road are cool, the
 * brick and the boarding are warm, the overgrowth is green. A backdrop in a
 * different colour family from the foreground reads as a painted flat behind
 * the level rather than as more of the same city.
 */
const TONE = {
  roadDark: "#45494f",
  kerb: "#9ea4a9",
  brickRed: "#9b5c50",
  brickBuff: "#ac8f72",
  brickDark: "#7e4c44",
  concrete: "#a5acb1",
  concreteDark: "#7c858d",
  sheet: "#848f94",
  sheetRust: "#996d56",
  steel: "#525960",
  board: "#7e6b58",
  glassDark: "#2d3339",
  weeds: "#687e4e",
  dirt: "#887863",
  timber: "#706051",
  tank: "#929ba0",
} as const;

export interface Outskirts {
  brushes: BoxBrush[];
}

/**
 * Build the backdrop.
 *
 * `edge` is how far the level itself reaches in each direction; nothing here
 * comes inside it. `roadWest`/`roadEast` line the outside street up with the
 * one the player stands in, so the two read as the same road.
 */
export const buildOutskirts = (options: {
  seed: number;
  edge: { x: number; z: number };
  roadWest: number;
  roadEast: number;
}): Outskirts => {
  const { seed, edge, roadWest, roadEast } = options;
  const random = createRandom(seed);
  const brushes: BoxBrush[] = [];

  /** Everything out here is scenery, so nothing out here is solid. */
  const box = (brush: BoxBrush): void => {
    brushes.push({ ...brush, solid: false });
  };

  const span = (
    kind: BoxBrush["kind"],
    x1: number,
    x2: number,
    y1: number,
    y2: number,
    z1: number,
    z2: number,
    extra: Partial<BoxBrush> = {},
  ): void => {
    box({
      kind,
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      z: (z1 + z2) / 2,
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
      depth: Math.abs(z2 - z1),
      ...extra,
    });
  };

  /* ---------------------------------------------------------------- *
   * Keeping things off each other.
   *
   * Two ground surfaces at the same height overlapping each other flicker,
   * exactly as they do inside the level, and out here the layout is rolled
   * rather than drawn, so it has to be checked rather than eyeballed. Every
   * road and every lot claims its footprint, and a roll that lands on
   * something already claimed is simply dropped: a backdrop with a gap in
   * it costs nothing, a backdrop that strobes costs everything.
   * ---------------------------------------------------------------- */

  interface Rect {
    x1: number;
    x2: number;
    z1: number;
    z2: number;
  }
  const claimed: Rect[] = [];
  const claim = (x: number, z: number, width: number, depth: number): boolean => {
    const rect = {
      x1: x - width / 2,
      x2: x + width / 2,
      z1: z - depth / 2,
      z2: z + depth / 2,
    };
    for (const other of claimed) {
      if (
        rect.x1 < other.x2 - 0.01 &&
        other.x1 < rect.x2 - 0.01 &&
        rect.z1 < other.z2 - 0.01 &&
        other.z1 < rect.z2 - 0.01
      ) {
        return false;
      }
    }
    claimed.push(rect);
    return true;
  };
  // The level itself is claimed first, so nothing out here reaches into it.
  claimed.push({ x1: -edge.x, x2: edge.x, z1: -edge.z, z2: edge.z });

  /* ---------------------------------------------------------------- *
   * The ground everything stands on.
   * ---------------------------------------------------------------- */

  /**
   * One slab of dirt under the whole backdrop, tucked under the level's own
   * floor so the two never meet at a shared surface. Without it every
   * building out here stands on the sky.
   */
  span("rubble", -REACH, REACH, -1.2, -0.08, -REACH, REACH, { tint: TONE.dirt });

  /* ---------------------------------------------------------------- *
   * The roads.
   * ---------------------------------------------------------------- */

  /** A road surface with kerbs down both sides and a dashed line down it. */
  const road = (
    along: "x" | "z",
    from: number,
    to: number,
    centre: number,
    halfWidth: number,
  ): void => {
    const lo = centre - halfWidth;
    const hi = centre + halfWidth;
    if (along === "x") {
      span("asphalt", from, to, -0.06, 0.02, lo, hi, { tint: TONE.roadDark });
      span("floor", from, to, -0.06, 0.16, lo - 2.4, lo, { tint: TONE.kerb });
      span("floor", from, to, -0.06, 0.16, hi, hi + 2.4, { tint: TONE.kerb });
      for (let x = from + 3; x < to - 3; x += 9) {
        span("floor", x, x + 3.6, 0.02, 0.05, centre - 0.16, centre + 0.16, {
          tint: "#c9c2ae",
        });
      }
    } else {
      span("asphalt", lo, hi, -0.06, 0.02, from, to, { tint: TONE.roadDark });
      span("floor", lo - 2.4, lo, -0.06, 0.16, from, to, { tint: TONE.kerb });
      span("floor", hi, hi + 2.4, -0.06, 0.16, from, to, { tint: TONE.kerb });
      for (let z = from + 3; z < to - 3; z += 9) {
        span("floor", centre - 0.16, centre + 0.16, 0.02, 0.05, z, z + 3.6, {
          tint: "#c9c2ae",
        });
      }
    }
  };

  const roadCentre = (roadWest + roadEast) / 2;
  const roadHalf = (roadEast - roadWest) / 2;
  /** The cross boulevards, one past each end of the level's own street. */
  const CROSS = { north: edge.z + 30, south: -(edge.z + 30) };
  const CROSS_HALF = 7;
  const KERB = 2.4;

  // The boulevards first, so the level's own street stops short of them
  // rather than laying a second road surface over the junction.
  for (const centre of [CROSS.north, CROSS.south, CROSS.north + 58]) {
    const half = centre === CROSS.north + 58 ? 6 : CROSS_HALF;
    claim(0, centre, REACH * 1.6, (half + KERB) * 2);
    road("x", -REACH * 0.8, REACH * 0.8, centre, half);
  }
  // The level's street, carried out to each of them.
  for (const sign of [1, -1]) {
    const from = sign * (edge.z + 0.05);
    const to = sign * (CROSS.north - CROSS_HALF - KERB);
    claim(roadCentre, (from + to) / 2, (roadHalf + KERB) * 2, Math.abs(to - from));
    road("z", Math.min(from, to), Math.max(from, to), roadCentre, roadHalf);
  }

  /* ---------------------------------------------------------------- *
   * Street furniture: what tells you a road is a road from 40 m away.
   * ---------------------------------------------------------------- */

  /** A utility pole with a crossarm. There is nothing strung between them. */
  const pole = (x: number, z: number, height = 9): void => {
    box({ kind: "prop", x, y: height / 2, z, width: 0.28, height, depth: 0.28, tint: TONE.timber });
    box({
      kind: "prop",
      x,
      y: height - 0.9,
      z,
      width: 2.4,
      height: 0.16,
      depth: 0.16,
      tint: TONE.timber,
    });
    box({
      kind: "prop",
      x,
      y: height - 1.9,
      z,
      width: 1.8,
      height: 0.14,
      depth: 0.14,
      tint: TONE.timber,
    });
  };

  /** A mast arm over the road with a dead signal head on the end of it. */
  const signal = (x: number, z: number, reach: number): void => {
    box({ kind: "accent", x, y: 3.1, z, width: 0.22, height: 6.2, depth: 0.22, tint: TONE.steel });
    box({
      kind: "accent",
      x: x + reach / 2,
      y: 6.0,
      z,
      width: Math.abs(reach),
      height: 0.16,
      depth: 0.16,
      tint: TONE.steel,
    });
    box({
      kind: "accent",
      x: x + reach,
      y: 5.4,
      z,
      width: 0.34,
      height: 1.0,
      depth: 0.3,
      tint: TONE.steel,
    });
  };

  /** A hoarding on two legs, with nothing on it. */
  const billboard = (x: number, z: number, yaw: number): void => {
    for (const side of [-1, 1]) {
      box({
        kind: "accent",
        x: x + Math.cos(yaw) * 3.4 * side,
        y: 4,
        z: z - Math.sin(yaw) * 3.4 * side,
        width: 0.3,
        height: 8,
        depth: 0.3,
        tint: TONE.steel,
      });
    }
    box({
      kind: "cladding",
      x,
      y: 9.6,
      z,
      width: 12,
      height: 4.4,
      depth: 0.3,
      yaw,
      tint: TONE.tank,
    });
    box({
      kind: "accent",
      x,
      y: 7.2,
      z,
      width: 12,
      height: 0.2,
      depth: 0.5,
      yaw,
      tint: TONE.steel,
    });
  };

  /* ---------------------------------------------------------------- *
   * Buildings.
   * ---------------------------------------------------------------- */

  /**
   * A block of storefronts: brick, two or three floors, a parapet above the
   * top windows, and the ground floor boarded.
   *
   * The window bands are what make it read as a building rather than a
   * brick. They are recessed strips of dark, one band per floor, and they
   * cost two brushes each because the whole run of windows on one elevation
   * is one strip — nobody at this distance counts panes.
   */
  const terrace = (
    x: number,
    z: number,
    width: number,
    depth: number,
    storeys: number,
    tint: string,
    facing: "north" | "south" | "east" | "west",
  ): void => {
    if (!claim(x, z, width + 2, depth + 2)) return;
    const storey = 4.1;
    const height = storeys * storey;
    box({ kind: "brick", x, y: height / 2, z, width, height, depth, tint });
    // The parapet: a brick wall standing above the roof, which is what gives
    // a flat-roofed block its square-shouldered silhouette.
    box({
      kind: "brick",
      x,
      y: height + 0.55,
      z,
      width: width + 0.3,
      height: 1.1,
      depth: depth + 0.3,
      tint,
    });
    // A cornice under it, one course proud.
    box({
      kind: "spandrel",
      x,
      y: height - 0.35,
      z,
      width: width + 0.5,
      height: 0.35,
      depth: depth + 0.5,
      tint: "#b6a892",
    });

    const front = facing === "north" || facing === "south";
    const sign = facing === "north" || facing === "east" ? 1 : -1;
    const bandWidth = front ? width - 1.6 : depth - 1.6;
    for (let floor = 1; floor < storeys; floor += 1) {
      const y = floor * storey + storey * 0.55;
      const common = { kind: "spandrel" as const, tint: TONE.glassDark };
      if (front) {
        box({
          ...common,
          x,
          y,
          z: z + (sign * (depth / 2 + 0.08)),
          width: bandWidth,
          height: 2.0,
          depth: 0.16,
        });
      } else {
        box({
          ...common,
          x: x + sign * (width / 2 + 0.08),
          y,
          z,
          width: 0.16,
          height: 2.0,
          depth: bandWidth,
        });
      }
    }
    // The ground floor, boarded over.
    if (front) {
      box({
        kind: "prop",
        x,
        y: 1.9,
        z: z + sign * (depth / 2 + 0.08),
        width: bandWidth,
        height: 2.6,
        depth: 0.16,
        tint: TONE.board,
      });
    } else {
      box({
        kind: "prop",
        x: x + sign * (width / 2 + 0.08),
        y: 1.9,
        z,
        width: 0.16,
        height: 2.6,
        depth: bandWidth,
        tint: TONE.board,
      });
    }
  };

  /**
   * A shed: a long steel-clad hall with a sawtooth roof.
   *
   * The sawtooth is the reason a daylight factory looks like one. Each tooth
   * is a low box with a taller glazed face leaning back off it, and a run of
   * them along a roofline is unmistakable from a long way off.
   */
  const shed = (
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    tint: string,
  ): void => {
    if (!claim(x, z, width + 3, depth + 3)) return;
    box({ kind: "cladding", x, y: height / 2, z, width, height, depth, tint });
    const teeth = Math.max(2, Math.round(depth / 9));
    const pitchDepth = depth / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const zi = z - depth / 2 + pitchDepth * (i + 0.5);
      box({
        kind: "cladding",
        x,
        y: height + 1.1,
        z: zi,
        width,
        height: 2.2,
        depth: pitchDepth * 0.55,
        tint,
      });
      box({
        kind: "spandrel",
        x,
        y: height + 1.9,
        z: zi + pitchDepth * 0.32,
        width: width - 0.6,
        height: 2.6,
        depth: 0.3,
        pitch: 0.5,
        tint: TONE.glassDark,
      });
    }
  };

  /**
   * A chimney: brick, square, stepped in as it rises.
   *
   * Six stacked boxes each a little narrower than the last read as a taper
   * from anywhere further away than the base, and a stack is never nearer
   * than that.
   */
  const stack = (x: number, z: number, height: number, base: number): void => {
    const steps = 6;
    for (let i = 0; i < steps; i += 1) {
      const t = i / steps;
      const size = base * (1 - t * 0.45);
      box({
        kind: "brick",
        x,
        y: (height * (i + 0.5)) / steps,
        z,
        width: size,
        height: height / steps + 0.2,
        depth: size,
        tint: TONE.brickDark,
      });
    }
    // The cap, which flares back out.
    box({
      kind: "frame",
      x,
      y: height + 0.5,
      z,
      width: base * 0.72,
      height: 1.0,
      depth: base * 0.72,
      tint: TONE.concreteDark,
    });
  };

  /** A row of silos with the headhouse standing over one end of it. */
  const silos = (x: number, z: number, count: number, radius: number, height: number): void => {
    for (let i = 0; i < count; i += 1) {
      const xi = x + i * radius * 1.94;
      // Three boxes turned against each other stand in for a cylinder well
      // enough at two hundred metres and cost a twelfth of one.
      for (const [yaw, scale] of [[0, 1], [Math.PI / 3, 1], [-Math.PI / 3, 1]] as const) {
        box({
          kind: "frame",
          x: xi,
          y: height / 2,
          z,
          width: radius * 2 * scale,
          height,
          depth: radius * 1.16,
          yaw,
          tint: TONE.concrete,
        });
      }
    }
    const runWidth = (count - 1) * radius * 1.94 + radius * 2;
    box({
      kind: "frame",
      x: x + ((count - 1) * radius * 1.94) / 2,
      y: height + 5,
      z,
      width: runWidth * 0.36,
      height: 10,
      depth: radius * 2.3,
      tint: TONE.concreteDark,
    });
  };

  /** A tank on four legs, with a catwalk round it. */
  const waterTower = (x: number, z: number, legHeight: number): void => {
    for (const dx of [-1, 1]) {
      for (const dz of [-1, 1]) {
        box({
          kind: "accent",
          x: x + dx * 2.6,
          y: legHeight / 2,
          z: z + dz * 2.6,
          width: 0.34,
          height: legHeight,
          depth: 0.34,
          yaw: dx * dz * 0.06,
          tint: TONE.steel,
        });
      }
    }
    for (const y of [legHeight * 0.4, legHeight * 0.75]) {
      box({ kind: "accent", x, y, z, width: 5.6, height: 0.16, depth: 0.16, tint: TONE.steel });
      box({ kind: "accent", x, y, z, width: 0.16, height: 0.16, depth: 5.6, tint: TONE.steel });
    }
    for (const [yaw] of [[0], [Math.PI / 3], [-Math.PI / 3]] as const) {
      box({
        kind: "cladding",
        x,
        y: legHeight + 4,
        z,
        width: 8,
        height: 8,
        depth: 4.6,
        yaw,
        tint: TONE.tank,
      });
    }
    box({
      kind: "cladding",
      x,
      y: legHeight + 8.8,
      z,
      width: 4,
      height: 2.2,
      depth: 4,
      tint: TONE.tank,
    });
    box({
      kind: "accent",
      x,
      y: legHeight + 0.2,
      z,
      width: 9.4,
      height: 0.14,
      depth: 9.4,
      tint: TONE.steel,
    });
  };

  /**
   * A freeway on piers: a deck, a parapet down each side, and bents under it.
   *
   * A city that took a road through itself has one of these in the middle
   * distance of every view, and the long horizontal of it does more to set
   * the scale of everything else than any single building.
   */
  const viaduct = (z: number, from: number, to: number, height: number): void => {
    span("frame", from, to, height, height + 1.0, z - 9, z + 9, { tint: TONE.concrete });
    for (const side of [-1, 1]) {
      span("frame", from, to, height + 1.0, height + 2.0, z + side * 8.4, z + side * 9.0, {
        tint: TONE.concreteDark,
      });
    }
    for (let x = from + 12; x < to; x += 26) {
      for (const side of [-1, 1]) {
        box({
          kind: "frame",
          x,
          y: height / 2,
          z: z + side * 5.5,
          width: 2.0,
          height,
          depth: 2.0,
          tint: TONE.concreteDark,
        });
      }
      box({
        kind: "frame",
        x,
        y: height - 0.7,
        z,
        width: 2.2,
        height: 1.4,
        depth: 14,
        tint: TONE.concreteDark,
      });
    }
  };

  /**
   * A vacant lot: the foundations of whatever was here, and everything that
   * has grown up through them since.
   */
  const lot = (x: number, z: number, width: number, depth: number): void => {
    if (!claim(x, z, width, depth)) return;
    span("rubble", x - width / 2, x + width / 2, -0.06, 0.12, z - depth / 2, z + depth / 2, {
      tint: TONE.dirt,
    });
    // The slab of the building that stood here, cracked through.
    const slabW = width * 0.55;
    const slabD = depth * 0.55;
    span("frame", x - slabW / 2, x + slabW / 2, 0.05, 0.28, z - slabD / 2, z + slabD / 2, {
      tint: TONE.concrete,
    });
    const clumps = 4 + Math.floor(random.next() * 4);
    for (let i = 0; i < clumps; i += 1) {
      const cx = x + random.range(-width / 2, width / 2);
      const cz = z + random.range(-depth / 2, depth / 2);
      const size = random.range(1.6, 4.2);
      box({
        kind: "foliage",
        x: cx,
        y: size * 0.4,
        z: cz,
        width: size,
        height: size * 0.8,
        depth: size * 0.9,
        yaw: random.next() * Math.PI,
        tint: TONE.weeds,
      });
    }
    // A volunteer tree or two, because they always come back first.
    for (let i = 0; i < 2; i += 1) {
      const tx = x + random.range(-width / 2, width / 2);
      const tz = z + random.range(-depth / 2, depth / 2);
      const height = random.range(6, 10);
      box({ kind: "prop", x: tx, y: height * 0.4, z: tz, width: 0.5, height: height * 0.8, depth: 0.5, tint: TONE.timber });
      for (let c = 0; c < 4; c += 1) {
        const size = height * random.range(0.3, 0.5);
        box({
          kind: "foliage",
          x: tx + random.range(-1.6, 1.6),
          y: height * 0.8 + random.range(-1, 1),
          z: tz + random.range(-1.6, 1.6),
          width: size,
          height: size * 0.8,
          depth: size,
          yaw: random.next() * Math.PI,
          tint: TONE.weeds,
        });
      }
    }
  };
  /* ---------------------------------------------------------------- *
   * The composition.
   *
   * Ordered from the fence outward, because that is the order the player
   * meets it in: a block of empty ground past the fence, a boulevard to
   * read across, and a horizon behind all of it.
   * ---------------------------------------------------------------- */

  for (const facing of ["north", "south"] as const) {
    const sign = facing === "north" ? 1 : -1;
    const cross = sign > 0 ? CROSS.north : CROSS.south;
    const near = sign * (edge.z + 17);
    const far = cross + sign * 26;
    const opposite = facing === "north" ? "south" : "north";

    // Past the fence: the blocks that came down. This is the first thing
    // the player sees down the street, and it is mostly sky and weeds.
    lot(roadWest - 17, near, 22, 16);
    lot(roadEast + 17, near, 22, 16);
    lot(roadWest - 42, near, 24, 16);
    lot(roadEast + 42, near, 24, 16);

    // The junction, with the signals still on their masts.
    signal(roadWest - 1.5, cross - sign * 9, 9);
    signal(roadEast + 1.5, cross + sign * 9, -9);
    for (const x of [18, 32, 48, 66, 88]) {
      pole(x, cross + sign * 11, 8.5 + (x % 3));
      pole(-x, cross + sign * 11, 8.5 + (x % 4));
    }

    // The far side of the boulevard: storefronts, and gaps where they are
    // not. The roll is checked against everything already placed, so a
    // block that would land on the road or on its neighbour is simply not
    // there.
    let x = -88;
    while (x < 88) {
      const width = random.range(12, 24);
      if (random.next() < 0.36) {
        lot(x + width / 2, far, width, 22);
      } else {
        terrace(
          x + width / 2,
          far,
          width,
          random.range(16, 22),
          random.next() < 0.3 ? 3 : 2,
          random.next() < 0.5 ? TONE.brickRed : TONE.brickBuff,
          opposite,
        );
      }
      x += width + random.range(3, 8);
    }
  }

  // East and west of the plant, past the wings: the same blocks again, seen
  // over the roofs from the bridge and from the upper floors.
  for (const side of [-1, 1] as const) {
    for (const z of [-100, -80, -24, 4, 30, 78, 100]) {
      const x = side * (edge.x + random.range(16, 26));
      if (random.next() < 0.42) {
        lot(x, z, 26, 22);
      } else {
        terrace(
          x,
          z,
          random.range(18, 28),
          random.range(16, 24),
          random.next() < 0.35 ? 4 : 2,
          random.next() < 0.5 ? TONE.brickDark : TONE.brickBuff,
          side > 0 ? "west" : "east",
        );
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * The horizon.
   * ---------------------------------------------------------------- */

  // Another plant to the north-west, presenting its blind flank.
  shed(-78, 84, 56, 36, 13, TONE.sheet);
  shed(-26, 116, 52, 32, 11, TONE.sheetRust);
  stack(-50, 76, 58, 7.5);
  stack(-40, 82, 41, 5.2);

  // Silos and water towers: the two shapes that say this is a place that
  // made things, and the ones that survive longest after it stopped.
  silos(36, 98, 5, 4.8, 28);
  waterTower(34, 80, 26);
  waterTower(-92, 40, 22);

  // A freeway on piers across the far northern view, and a shed and a stack
  // out east, so there is something at more than one distance in each
  // direction rather than one flat band of buildings.
  viaduct(118, -90, 90, 12);
  shed(88, 20, 32, 54, 16, TONE.sheet);
  stack(94, -16, 46, 6);

  // The southern view looks the other way, to taller blocks further off:
  // one end of the street gives onto industry and the other onto downtown.
  for (const [x, z, w, d, storeys] of [
    [-22, -98, 26, 26, 9],
    [12, -110, 30, 28, 12],
    [46, -100, 24, 24, 7],
    [-58, -110, 28, 26, 10],
    [76, -114, 26, 26, 8],
    [-92, -100, 22, 22, 6],
  ] as const) {
    terrace(x, z, w, d, storeys, TONE.brickDark, "north");
  }

  billboard(-34, -60, 0.18);
  billboard(46, 66, -0.22);

  return { brushes };
};
