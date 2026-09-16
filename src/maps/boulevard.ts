import { createRandom } from "../sim/random";
import type { BoxBrush, MapDefinition, MapStyle, SpawnPoint, TargetPlacement } from "./types";

/**
 * Boulevard Works: a derelict reinforced-concrete auto plant, in daylight.
 *
 * Two wings of an exposed concrete frame face each other across a street,
 * joined by an enclosed bridge at second-floor height. The east wing wraps a
 * courtyard the fight is built around. Everything above the ground floor is
 * reached over collapsed floor slabs — the building's own ruin is the ramp
 * system — and the brick spandrels under every window are chest-high cover.
 *
 * Three lanes. The street: open, long, lethal. The bridge: the high ground
 * that connects the wings, dominant and exposed at both ends. The interiors:
 * a forest of columns and short lanes, where the shotgun earns its keep.
 *
 * Nothing here copies any real building. It is built in the idiom of the
 * early-twentieth-century daylight factory — the concrete frame, brick infill,
 * steel sash, sawtooth roofs — which belongs to no one.
 */

/* ------------------------------------------------------------------ *
 * Dimensions. Everything is derived from these.
 * ------------------------------------------------------------------ */

/** Floor-to-floor height. */
const STOREY = 4.3;
/** Levels, as the top surface of each floor slab. */
const L0 = 0;
const L1 = STOREY;
const L2 = STOREY * 2;
const ROOF = STOREY * 3;
const BAY = 6;
const SLAB = 0.3;
const COLUMN = 0.6;
const BEAM = { width: 0.45, depth: 0.55 };
/**
 * The ground slabs are far thicker than they look. Rubble and fallen slabs
 * lie on them at angles, and a capsule pushed out of a tilted box can be
 * pushed downward; a thin floor lets it through, a thick one does not.
 */
const GROUND = 1.6;
/** Brick under every window, from slab to sill. Chest high: this is cover. */
const SPANDREL = { height: 0.95, thickness: 0.32 };

/** The street runs north to south between these. */
const ROAD = { west: -8, east: 8 };
const KERB = 2;
/** The bridge spans the street at second-floor height. */
const BRIDGE = { south: -4.5, north: 4.5, floor: L2, roof: L2 + 3.4 };

/* ------------------------------------------------------------------ *
 * Palette. Zones are told apart by what they are built of, not by paint.
 * ------------------------------------------------------------------ */

const TINT = {
  /** The painted spandrels down the east wing, the one splash of colour. */
  paint: undefined,
  /** Dark steel: the bridge girders, sash remnants, the car. */
  steel: "#4d4b48",
  /** Weathered timber and the courtyard's rust-streaked concrete. */
  courtyard: "#c9b9a4",
  /** The tower's older, darker brick. */
  tower: "#8d5d4f",
  car: "#5c5060",
  barrel: "#b56a3c",
} as const;

const brushes: BoxBrush[] = [];
const random = createRandom(0x0b0e1e);

const box = (brush: BoxBrush): void => {
  brushes.push(brush);
};

/** A box from its extents rather than its centre, which walls prefer. */
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

/* ------------------------------------------------------------------ *
 * The frame.
 * ------------------------------------------------------------------ */

interface Block {
  x1: number;
  x2: number;
  z1: number;
  z2: number;
  /** Levels whose slab this block carries, as slab-top heights. */
  floors: number[];
  /** Top of the block: a roof slab, or nothing for a block open to the sky. */
  roof: number | null;
}

/** Columns at every grid intersection, full height. */
const columns = (block: Block, top: number): void => {
  for (let x = block.x1; x <= block.x2 + 1e-6; x += BAY) {
    for (let z = block.z1; z <= block.z2 + 1e-6; z += BAY) {
      span("frame", x - COLUMN / 2, x + COLUMN / 2, L0, top, z - COLUMN / 2, z + COLUMN / 2);
    }
  }
};

/**
 * Beams under a slab along every grid line, both directions, in one box per
 * line rather than one per bay. The frame reads the same and costs a tenth.
 */
const beams = (
  block: Block,
  level: number,
  hole?: { x1: number; x2: number; z1: number; z2: number },
): void => {
  const top = level - SLAB;
  const bottom = top - BEAM.depth;
  // A beam that crossed a hole went down with the slab it carried: split it
  // around the hole rather than leaving it hanging across the way up.
  for (let x = block.x1; x <= block.x2 + 1e-6; x += BAY) {
    const crosses = hole && x > hole.x1 && x < hole.x2;
    const runs = crosses ? [[block.z1, hole.z1], [hole.z2, block.z2]] : [[block.z1, block.z2]];
    for (const [z1, z2] of runs) {
      if (z2 - z1 < 1e-6) continue; // the hole reaches the edge: nothing left on that side
      span("frame", x - BEAM.width / 2, x + BEAM.width / 2, bottom, top, z1, z2);
    }
  }
  for (let z = block.z1; z <= block.z2 + 1e-6; z += BAY) {
    const crosses = hole && z > hole.z1 && z < hole.z2;
    const runs = crosses ? [[block.x1, hole.x1], [hole.x2, block.x2]] : [[block.x1, block.x2]];
    for (const [x1, x2] of runs) {
      if (x2 - x1 < 1e-6) continue;
      span("frame", x1, x2, bottom, top, z - BEAM.width / 2, z + BEAM.width / 2);
    }
  }
};

/** A floor slab covering a rectangle, top surface at `level`. */
const slab = (x1: number, x2: number, z1: number, z2: number, level: number, kind: BoxBrush["kind"] = "floor", tint?: string): void => {
  span(kind, x1, x2, level - SLAB, level, z1, z2, { tint });
};

type Infill = "open" | "sash" | "brick" | "paint" | "gone";

/**
 * What fills one bay of one storey between the columns.
 *
 * `open` is the common case: a brick spandrel and an empty opening above it
 * where the steel sash used to be. `sash` keeps a few bars of the window.
 * `brick` is bricked up solid. `paint` is a spandrel someone painted.
 * `gone` is a bay where even the brick has fallen out: a doorway.
 */
const facadeBay = (
  axis: "x" | "z",
  at: number,
  from: number,
  to: number,
  level: number,
  infill: Infill,
  tint?: string,
): void => {
  const t = SPANDREL.thickness / 2;
  const put = (kind: BoxBrush["kind"], y1: number, y2: number, a1: number, a2: number, extra: Partial<BoxBrush> = {}) => {
    if (axis === "z") span(kind, at - t, at + t, y1, y2, a1, a2, extra);
    else span(kind, a1, a2, y1, y2, at - t, at + t, extra);
  };
  const a1 = from + COLUMN / 2;
  const a2 = to - COLUMN / 2;
  const sill = level + SPANDREL.height;
  const head = level + STOREY - SLAB - BEAM.depth;

  if (infill === "gone") return;
  put(infill === "paint" ? "spandrel" : "brick", level, sill, a1, a2, { tint });
  if (infill === "brick") {
    put("brick", sill, head, a1, a2, { tint });
    return;
  }
  if (infill === "sash") {
    // What is left of a steel window: a few bars, and they stop nothing.
    const bars = 1 + Math.floor(random.next() * 3);
    for (let i = 1; i <= bars; i += 1) {
      const p = a1 + ((a2 - a1) * i) / (bars + 1);
      if (axis === "z") span("accent", at - 0.04, at + 0.04, sill, head, p - 0.04, p + 0.04, { tint: TINT.steel, solid: false });
      else span("accent", p - 0.04, p + 0.04, sill, head, at - 0.04, at + 0.04, { tint: TINT.steel, solid: false });
    }
    if (random.next() < 0.6) {
      const mid = (sill + head) / 2;
      put("accent", mid - 0.04, mid + 0.04, a1, a2, { tint: TINT.steel, solid: false });
    }
  }
};

/** Pick an infill for a bay by the odds of this facade. */
const pickInfill = (odds: Partial<Record<Infill, number>>): Infill => {
  const roll = random.next();
  let acc = 0;
  for (const [kind, weight] of Object.entries(odds) as [Infill, number][]) {
    acc += weight;
    if (roll < acc) return kind;
  }
  return "open";
};

/**
 * A whole facade: every bay of every storey along one line.
 *
 * `force` overrides the roll for particular bays — a doorway at ground level
 * here, a painted run there — so the composition is chosen, not rolled.
 */
const facade = (
  axis: "x" | "z",
  at: number,
  from: number,
  to: number,
  levels: number[],
  odds: Partial<Record<Infill, number>>,
  force: (bay: number, level: number) => Infill | undefined = () => undefined,
  tint?: string,
): void => {
  const count = Math.round((to - from) / BAY);
  for (let bay = 0; bay < count; bay += 1) {
    const a = from + bay * BAY;
    for (const level of levels) {
      const infill = force(bay, level) ?? pickInfill(odds);
      facadeBay(axis, at, a, a + BAY, level, infill, tint);
    }
  }
};

/** A collapsed slab lying as a ramp from one level up to another. */
const fallenSlab = (
  x1: number,
  x2: number,
  zLow: number,
  zHigh: number,
  low: number,
  high: number,
  kind: BoxBrush["kind"] = "floor",
): void => {
  const rise = high - low;
  const run = zHigh - zLow;
  const length = Math.hypot(run, rise);
  const angle = Math.atan2(rise, Math.abs(run));
  // The slab's top surface has to meet both floors, so its centre sits half a
  // thickness below the line between them.
  box({
    kind,
    x: (x1 + x2) / 2,
    y: (low + high) / 2 - (SLAB / 2) * Math.cos(angle),
    z: (zLow + zHigh) / 2,
    width: x2 - x1,
    height: SLAB,
    depth: length,
    pitch: run > 0 ? -angle : angle,
  });
};

/* ------------------------------------------------------------------ *
 * Props: what forty years leave behind.
 * ------------------------------------------------------------------ */

const rubblePile = (x: number, z: number, size: number, height: number): void => {
  for (let i = 0; i < 4; i += 1) {
    const dx = (random.next() - 0.5) * size * 0.8;
    const dz = (random.next() - 0.5) * size * 0.8;
    const w = size * (0.45 + random.next() * 0.5);
    const d = size * (0.45 + random.next() * 0.5);
    const h = height * (0.5 + random.next() * 0.6);
    box({
      kind: "rubble",
      x: x + dx,
      y: h / 2,
      z: z + dz,
      width: w,
      height: h,
      depth: d,
      yaw: random.next() * Math.PI,
      pitch: (random.next() - 0.5) * 0.35,
    });
  }
};

/** A broken slab leaning against something, as cover. */
const leaningSlab = (x: number, z: number, yaw: number, width = 4, tall = 2.6): void => {
  box({ kind: "floor", x, y: tall * 0.4, z, width, height: SLAB, depth: tall, yaw, pitch: 0.95, tint: TINT.courtyard });
};

/**
 * A tree, from a trunk and a crown of tilted blocks.
 *
 * Seven smaller masses at odd angles make a silhouette that breaks up the way
 * a canopy does; three big ones make a green cube on a stick. Only the
 * trunk and the heart of the crown are solid, so shots and players pass
 * through the leaves and stop at the wood.
 */
const tree = (x: number, z: number, height: number): void => {
  const trunk = 0.3 + height * 0.05;
  box({ kind: "prop", x, y: height * 0.4, z, width: trunk, height: height * 0.8, depth: trunk, tint: "#4e3d2f" });
  box({
    kind: "prop", x: x + trunk * 0.6, y: height * 0.62, z: z - trunk * 0.3,
    width: trunk * 0.5, height: height * 0.3, depth: trunk * 0.5, tint: "#4e3d2f",
    rotation: undefined, yaw: 0.4, pitch: 0.35, solid: false,
  } as BoxBrush);
  const crown = height * 0.5;
  const top = height * 0.72;
  for (let i = 0; i < 7; i += 1) {
    const size = crown * (i === 0 ? 0.9 : 0.45 + random.next() * 0.35);
    const angle = (i / 7) * Math.PI * 2 + random.next();
    const reach = i === 0 ? 0 : crown * (0.25 + random.next() * 0.3);
    box({
      kind: "foliage",
      x: x + Math.cos(angle) * reach,
      y: top + (random.next() - 0.35) * crown * 0.5,
      z: z + Math.sin(angle) * reach,
      width: size,
      height: size * (0.6 + random.next() * 0.3),
      depth: size * (0.7 + random.next() * 0.4),
      yaw: random.next() * Math.PI,
      pitch: (random.next() - 0.5) * 0.7,
      solid: i === 0,
    });
  }
};

const scrub = (x: number, z: number, size: number): void => {
  box({ kind: "foliage", x, y: size * 0.35, z, width: size, height: size * 0.7, depth: size * 0.8, yaw: random.next() * Math.PI, solid: false });
};

const barrel = (x: number, z: number, yaw = 0, fallen = false): void => {
  if (fallen) box({ kind: "hazard", x, y: 0.3, z, width: 0.6, height: 0.6, depth: 0.9, yaw, tint: TINT.barrel });
  else box({ kind: "hazard", x, y: 0.45, z, width: 0.6, height: 0.9, depth: 0.6, yaw, tint: TINT.barrel });
};

/**
 * A part of a vehicle, placed in the vehicle's own frame: `dx` along its
 * length, `dz` across it, turned with it.
 */
const vehiclePart = (
  x: number,
  z: number,
  yaw: number,
  kind: BoxBrush["kind"],
  dx: number,
  y: number,
  dz: number,
  width: number,
  height: number,
  depth: number,
  extra: Partial<BoxBrush> = {},
): void => {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  box({
    kind,
    x: x + dx * cos - dz * sin,
    y,
    z: z + dx * sin + dz * cos,
    width,
    height,
    depth,
    yaw,
    ...extra,
  });
};

/** A wheel: a tyre with a hub, or a bare rim where the tyre has gone. */
const wheel = (x: number, z: number, yaw: number, dx: number, dz: number, flat = false): void => {
  const y = flat ? 0.24 : 0.33;
  vehiclePart(x, z, yaw, "accent", dx, y, dz, 0.66, flat ? 0.48 : 0.66, 0.24, { tint: "#1c1b1d", solid: false });
  vehiclePart(x, z, yaw, "accent", dx, y, dz, 0.3, 0.3, 0.27, { tint: "#6d6a66", solid: false });
};

/** A car that has been here longer than anyone can remember. */
const car = (x: number, z: number, yaw: number): void => {
  const body = "#5a4f5c";
  const glass = "#1e2226";
  const p = (kind: BoxBrush["kind"], dx: number, y: number, dz: number, w: number, h: number, d: number, extra: Partial<BoxBrush> = {}) =>
    vehiclePart(x, z, yaw, kind, dx, y, dz, w, h, d, extra);
  // Sills, body, bonnet sloping down to the nose, boot behind.
  p("accent", 0, 0.3, 0, 4.4, 0.2, 1.9, { tint: "#2a2528" });
  p("accent", 0, 0.62, 0, 4.5, 0.48, 1.85, { tint: body });
  box({ kind: "accent", x: x + 1.55 * Math.cos(yaw), y: 0.93, z: z + 1.55 * Math.sin(yaw), width: 1.5, height: 0.1, depth: 1.75, yaw, pitch: 0, tint: body });
  p("accent", -1.6, 0.98, 0, 1.2, 0.3, 1.75, { tint: body });
  // The cabin: glass all round under a roof, with the pillars showing.
  p("accent", -0.1, 1.15, 0, 1.95, 0.42, 1.68, { tint: glass, solid: false });
  p("accent", -0.1, 1.4, 0, 2.05, 0.08, 1.74, { tint: body });
  for (const [dx, dz] of [[0.85, 0.8], [0.85, -0.8], [-1.05, 0.8], [-1.05, -0.8]]) {
    p("accent", dx, 1.15, dz, 0.08, 0.44, 0.08, { tint: body });
  }
  // Bumpers, lights, and the grille.
  p("accent", 2.32, 0.42, 0, 0.16, 0.18, 1.9, { tint: "#8c8a86" });
  p("accent", -2.32, 0.42, 0, 0.16, 0.18, 1.9, { tint: "#8c8a86" });
  p("accent", 2.24, 0.72, 0.62, 0.06, 0.16, 0.34, { tint: "#e9e4cf", solid: false });
  p("accent", 2.24, 0.72, -0.62, 0.06, 0.16, 0.34, { tint: "#e9e4cf", solid: false });
  p("accent", 2.24, 0.7, 0, 0.05, 0.22, 0.7, { tint: "#2a2528", solid: false });
  p("accent", -2.24, 0.72, 0.65, 0.05, 0.14, 0.3, { tint: "#7a2a22", solid: false });
  p("accent", -2.24, 0.72, -0.65, 0.05, 0.14, 0.3, { tint: "#7a2a22", solid: false });
  // Wheels, one of them flat.
  wheel(x, z, yaw, 1.45, 0.95);
  wheel(x, z, yaw, 1.45, -0.95);
  wheel(x, z, yaw, -1.45, 0.95, true);
  wheel(x, z, yaw, -1.45, -0.95);
  // Rust creeping up from the sills, as a band that breaks the flat paint.
  p("rubble", 0.4, 0.42, 0.93, 2.2, 0.16, 0.02, { solid: false });
  p("rubble", -0.6, 0.44, -0.93, 1.6, 0.14, 0.02, { solid: false });
};

/**
 * A box truck, stripped: a cab with its glass gone and the corrugated body
 * behind it, up on six wheels and going nowhere.
 */
const truck = (x: number, z: number, yaw: number): void => {
  const paint = "#7c6a58";
  const p = (kind: BoxBrush["kind"], dx: number, y: number, dz: number, w: number, h: number, d: number, extra: Partial<BoxBrush> = {}) =>
    vehiclePart(x, z, yaw, kind, dx, y, dz, w, h, d, extra);
  // Chassis rails and the body over them.
  p("accent", -0.6, 0.55, 0, 7.0, 0.3, 1.0, { tint: "#2a2528" });
  p("cladding", -1.8, 2.05, 0, 4.6, 2.5, 2.35);
  p("accent", -1.8, 3.35, 0, 4.7, 0.1, 2.45, { tint: "#2f2b28" });
  p("accent", -4.12, 1.6, 0, 0.1, 1.6, 2.0, { tint: "#2a2528", solid: false });
  // Cab: floor, a dashboard, the shell, the glass gone, a roof.
  p("accent", 2.3, 0.95, 0, 2.2, 0.5, 2.2, { tint: paint });
  p("accent", 1.7, 1.6, 0, 0.9, 0.8, 2.2, { tint: paint });
  p("accent", 2.3, 2.15, 0, 2.3, 0.1, 2.3, { tint: paint });
  for (const dz of [-1.06, 1.06]) p("accent", 2.3, 1.6, dz, 2.2, 0.8, 0.08, { tint: paint, solid: false });
  for (const [dx, dz] of [[3.35, 1.08], [3.35, -1.08], [1.25, 1.08], [1.25, -1.08]]) {
    p("accent", dx, 1.6, dz, 0.1, 0.9, 0.1, { tint: paint });
  }
  p("accent", 3.42, 0.9, 0, 0.16, 0.5, 2.2, { tint: "#8c8a86" });
  p("accent", 3.36, 1.2, 0.7, 0.06, 0.2, 0.4, { tint: "#e9e4cf", solid: false });
  p("accent", 3.36, 1.2, -0.7, 0.06, 0.2, 0.4, { tint: "#e9e4cf", solid: false });
  // Six wheels: singles at the front, pairs at the back.
  wheel(x, z, yaw, 2.4, 1.0);
  wheel(x, z, yaw, 2.4, -1.0);
  for (const dx of [-2.2, -3.1]) {
    wheel(x, z, yaw, dx, 1.05);
    wheel(x, z, yaw, dx, 0.78);
    wheel(x, z, yaw, dx, -1.05, dx === -3.1);
    wheel(x, z, yaw, dx, -0.78, dx === -3.1);
  }
};

/** A tag on a wall: a thin panel proud of the surface, in the graffiti texture. */
const tag = (axis: "x" | "z", at: number, a1: number, a2: number, y1: number, y2: number, side: 1 | -1): void => {
  const off = at + side * (SPANDREL.thickness / 2 + 0.015);
  if (axis === "z") span("graffiti", off - 0.01, off + 0.01, y1, y2, a1, a2, { solid: false });
  else span("graffiti", a1, a2, y1, y2, off - 0.01, off + 0.01, { solid: false });
};

/* ------------------------------------------------------------------ *
 * The street.
 * ------------------------------------------------------------------ */

span("asphalt", ROAD.west, ROAD.east, -GROUND, 0, -24, 24);
// Kerbs and pavements, a step up either side.
span("floor", ROAD.west - KERB, ROAD.west, -GROUND, 0.15, -24, 24);
span("floor", ROAD.east, ROAD.east + KERB, -GROUND, 0.15, -24, 24);
// The ends of the street are fenced off, and rubble has piled against the
// fence: this is the edge of the world, and it should look like a place that
// was closed rather than a place that stops.
for (const z of [-23.6, 23.6]) {
  span("catwalk", ROAD.west - KERB, ROAD.east + KERB, 0, 2.6, z - 0.06, z + 0.06, { tint: "#5c6166" });
  span("accent", ROAD.west - KERB, ROAD.east + KERB, 2.5, 2.7, z - 0.1, z + 0.1, { tint: TINT.steel });
  rubblePile(-3, z + Math.sign(-z) * 1.5, 4, 1.1);
  rubblePile(4, z + Math.sign(-z) * 1.8, 4, 0.9);
}

/* ------------------------------------------------------------------ *
 * West wing: the long block with the tower, blue's side.
 * ------------------------------------------------------------------ */

const west: Block = { x1: -32, x2: -8, z1: -24, z2: 24, floors: [L1], roof: ROOF };
columns(west, ROOF);
beams(west, L1, { x1: -20, x2: -14, z1: -14, z2: -4 });
// The bay the second floor fell from took its beams with it.
beams(west, L2, { x1: -14, x2: -8, z1: 12, z2: 22 });
beams(west, ROOF);

// Ground: a bare slab.
span("floor", west.x1, west.x2, -GROUND, L0, west.z1, west.z2);
// First floor: whole, except where it has come down — one bay near the middle
// has fallen as the ramp up from the ground, and a hole beside it is where
// the rest of it went.
slab(west.x1, west.x2, west.z1, -14, L1);
slab(west.x1, -20, -14, -4, L1);
slab(-14, west.x2, -14, -4, L1);
slab(west.x1, west.x2, -4, west.z2, L1);
fallenSlab(-20, -14.3, -14, -4, L0, L1); // up from the ground, landing on the edge at z=-4
// Second floor: only the bay along the street survives, and only around the
// bridge. This is the approach to the bridge and nothing else.
slab(-14, west.x2, -6, 6, L2);
slab(-14, west.x2, 6, 12, L2);
fallenSlab(-14 + 0.3, west.x2 - 0.3, 22, 12, L1, L2); // up from L1 at z=22 to L2 at z=12
// Roof, complete, with the parapet the columns carry.
slab(west.x1, west.x2, west.z1, west.z2, ROOF, "frame");
span("frame", west.x1, west.x2, ROOF, ROOF + 0.7, west.z1, west.z1 + 0.3);
span("frame", west.x1, west.x2, ROOF, ROOF + 0.7, west.z2 - 0.3, west.z2);
span("frame", west.x1, west.x1 + 0.3, ROOF, ROOF + 0.7, west.z1, west.z2);
span("frame", west.x2 - 0.3, west.x2, ROOF, ROOF + 0.7, west.z1, west.z2);

// Facades. The street side is the face people look at, so it gets the range:
// openings, a few bars of sash, one painted bay. The ground floor has two
// bays knocked through as doors. The outer edges are bricked solid — they are
// the edge of the map, and a wall with a view over nothing is a wall someone
// will try to climb out of.
facade("z", west.x2, west.z1, west.z2, [L0, L1, L2], { open: 0.6, sash: 0.25, brick: 0.1, paint: 0.05 }, (bay, level) => {
  if (level === L0 && (bay === 1 || bay === 5)) return "gone";
  if (level === L1 && bay === 6) return "paint";
  if (level === L2 && bay >= 3 && bay <= 4) return "gone"; // the bridge mouth
  return undefined;
});
facade("z", west.x1, west.z1, west.z2, [L0, L1, L2], { brick: 1 });
facade("x", west.z1, west.x1, west.x2, [L0, L1, L2], { brick: 1 });
facade("x", west.z2, west.x1, west.x2, [L0, L1, L2], { brick: 1 });
// Interior partitions on the ground floor: low brick walls where machine
// bays were, enough to break the sightline down the wing without sealing it.
for (const z of [-18, -6, 6, 18]) {
  span("brick", -26 + COLUMN / 2, -20 - COLUMN / 2, L0, L0 + 1.3, z - 0.16, z + 0.16);
}
tag("z", west.x2, -22, -19, 1.1, 3.0, -1);
tag("z", west.x2, 8, 11.5, 1.2, 2.8, -1);
tag("z", west.x2, 14, 17.5, L1 + 1.0, L1 + 3.0, -1);

// --- The tower. Brick, four storeys, a stair tower whose stair is long gone:
// it is solid, and it is the landmark for the whole west side.
const TOWER = { x1: -13, x2: -6.2, z1: -12, z2: -5, top: STOREY * 4 };
span("brick", TOWER.x1, TOWER.x2, L0, TOWER.top, TOWER.z1, TOWER.z2, { tint: TINT.tower });
span("frame", TOWER.x1 - 0.2, TOWER.x2 + 0.2, TOWER.top, TOWER.top + 0.6, TOWER.z1 - 0.2, TOWER.z2 + 0.2);
// Small windows punched in it, as dark recesses.
for (const level of [L0, L1, L2, ROOF]) {
  for (const z of [-10.4, -6.6]) {
    span("accent", TOWER.x2 - 0.02, TOWER.x2 + 0.05, level + 1.5, level + 3.0, z - 0.55, z + 0.55, { tint: "#2a3038", solid: false });
    span("frame", TOWER.x2 - 0.02, TOWER.x2 + 0.12, level + 1.35, level + 1.5, z - 0.7, z + 0.7, { solid: false });
  }
  for (const x of [-11.3, -7.9]) {
    span("accent", x - 0.55, x + 0.55, level + 1.5, level + 3.0, TOWER.z1 - 0.05, TOWER.z1 + 0.02, { tint: "#2a3038", solid: false });
    span("frame", x - 0.7, x + 0.7, level + 1.35, level + 1.5, TOWER.z1 - 0.12, TOWER.z1 + 0.02, { solid: false });
  }
}
// A painted panel on it, the way the real ones carry one.
span("spandrel", TOWER.x2 + 0.02, TOWER.x2 + 0.05, L1 + 0.2, L1 + 2.6, TOWER.z1 + 0.8, TOWER.z2 - 0.8, { solid: false });

/* ------------------------------------------------------------------ *
 * The bridge.
 * ------------------------------------------------------------------ */

{
  const x1 = ROAD.west - KERB - 0.3;
  const x2 = ROAD.east + KERB + 0.3;
  slab(x1, x2, BRIDGE.south, BRIDGE.north, BRIDGE.floor, "floor", "#cdc6b8");
  // Three girders carry it, black steel, seen from the street below.
  for (const z of [BRIDGE.south + 0.8, 0, BRIDGE.north - 0.8]) {
    span("accent", x1, x2, BRIDGE.floor - SLAB - 0.7, BRIDGE.floor - SLAB, z - 0.22, z + 0.22, { tint: TINT.steel });
  }
  // Corrugated walls both sides, with two window slots knocked through each,
  // and the roof.
  for (const [z1, z2] of [[BRIDGE.south, BRIDGE.south + 0.2], [BRIDGE.north - 0.2, BRIDGE.north]]) {
    const sill = BRIDGE.floor + 1.05;
    const head = BRIDGE.floor + 2.55;
    span("cladding", x1, x2, BRIDGE.floor, sill, z1, z2);
    span("cladding", x1, x2, head, BRIDGE.roof, z1, z2);
    // Piers between the slots, and a dark steel frame around each slot so it
    // reads as a window that has lost its glass rather than a gap in the
    // sheeting.
    for (const [a, b] of [[x1, -6.5], [-2.5, 2.5], [6.5, x2]]) span("cladding", a, b, sill, head, z1, z2);
    for (const [a, b] of [[-6.5, -2.5], [2.5, 6.5]]) {
      span("accent", a - 0.08, b + 0.08, sill - 0.08, sill, z1 - 0.02, z2 + 0.02, { tint: TINT.steel });
      span("accent", a - 0.08, b + 0.08, head, head + 0.08, z1 - 0.02, z2 + 0.02, { tint: TINT.steel });
      span("accent", a - 0.08, a, sill, head, z1 - 0.02, z2 + 0.02, { tint: TINT.steel });
      span("accent", b, b + 0.08, sill, head, z1 - 0.02, z2 + 0.02, { tint: TINT.steel });
    }
  }
  span("cladding", x1, x2, BRIDGE.roof, BRIDGE.roof + 0.3, BRIDGE.south, BRIDGE.north);
  // The plant's name once ran along the north face. Only the board is left.
  span("accent", x1 + 2, x2 - 2, BRIDGE.floor + 2.4, BRIDGE.floor + 3.1, BRIDGE.north + 0.02, BRIDGE.north + 0.1, { tint: "#d8d2c4", solid: false });
}

/* ------------------------------------------------------------------ *
 * East block: a ring of frame around the courtyard, rust's side.
 * ------------------------------------------------------------------ */

const bar: Block = { x1: 8, x2: 14, z1: -24, z2: 24, floors: [L1], roof: ROOF };
const rear: Block = { x1: 26, x2: 32, z1: -24, z2: 24, floors: [L1], roof: ROOF };
const north: Block = { x1: 14, x2: 26, z1: 12, z2: 24, floors: [L1], roof: ROOF };
const south: Block = { x1: 14, x2: 26, z1: -24, z2: -12, floors: [L1], roof: ROOF };
const COURT = { x1: 14, x2: 26, z1: -12, z2: 12 };

for (const block of [bar, rear, north, south]) {
  columns(block, ROOF);
  beams(block, L1);
  beams(block, L2, block === bar ? { x1: 8, x2: 14, z1: -22, z2: -12 } : undefined);
  beams(block, ROOF);
  span("floor", block.x1, block.x2, -GROUND, L0, block.z1, block.z2);
}

// First floors. The street bar's is whole. The returns have each lost a bay
// into the courtyard, and those fallen bays are the way up.
slab(bar.x1, bar.x2, bar.z1, bar.z2, L1);
slab(rear.x1, rear.x2, rear.z1, rear.z2, L1);
slab(north.x1, north.x2, north.z1, north.z2, L1);
slab(south.x1, south.x2, south.z1, south.z2, L1);
fallenSlab(14.3, 19.7, 2, 12, L0, L1); // courtyard floor up to the north return
fallenSlab(20.3, 25.7, -2, -12, L0, L1); // courtyard floor up to the south return
// Second floor: the bridge landing on the street bar, and its way down.
slab(bar.x1, bar.x2, -6, 6, L2);
slab(bar.x1, bar.x2, -12, -6, L2);
fallenSlab(bar.x1 + 0.3, bar.x2 - 0.3, -22, -12, L1, L2); // down from L2 at z=-12 to L1 at z=-22
// Roofs. The courtyard has none.
for (const block of [bar, rear, north, south]) {
  slab(block.x1, block.x2, block.z1, block.z2, ROOF, "frame");
}
span("frame", bar.x1, bar.x1 + 0.3, ROOF, ROOF + 0.7, bar.z1, bar.z2);
span("frame", rear.x2 - 0.3, rear.x2, ROOF, ROOF + 0.7, rear.z1, rear.z2);
span("frame", bar.x1, rear.x2, ROOF, ROOF + 0.7, -24, -23.7);
span("frame", bar.x1, rear.x2, ROOF, ROOF + 0.7, 23.7, 24);
// A sawtooth roof over the rear bar: the monitor lights of a machine shop,
// which the drawings for these buildings always show and the bridge looks
// straight down onto.
for (let z = -22; z < 24; z += 6) {
  box({ kind: "frame", x: 29, y: ROOF + 0.95, z: z + 1.5, width: 5.6, height: 0.25, depth: 3.9, pitch: -0.5 });
  box({ kind: "accent", x: 29, y: ROOF + 0.9, z: z + 3.2, width: 5.6, height: 1.7, depth: 0.15, tint: "#8fb4d6", solid: false });
}
// The penthouse on the street bar's roof, tagged on its street face.
span("cladding", 9, 13.6, ROOF, ROOF + 3.0, 14, 20);
span("cladding", 8.8, 13.8, ROOF + 3.0, ROOF + 3.3, 13.8, 20.2);
tag("z", 9, 14.6, 19.4, ROOF + 0.4, ROOF + 2.7, -1);

// Facades.
// Street bar, west face: the long painted run at first floor is the face of
// the map. Ground floor has doorways through to the courtyard side.
facade("z", bar.x1, bar.z1, bar.z2, [L0, L1, L2], { open: 0.55, sash: 0.3, brick: 0.1, paint: 0.05 }, (bay, level) => {
  if (level === L0 && (bay === 2 || bay === 5)) return "gone";
  if (level === L1 && bay >= 1 && bay <= 6) return "paint";
  if (level === L2 && bay >= 3 && bay <= 4) return "gone"; // the bridge mouth
  return undefined;
});
// Street bar, courtyard face.
facade("z", bar.x2, COURT.z1, COURT.z2, [L0, L1, L2], { open: 0.65, sash: 0.25, gone: 0.1 }, (bay, level) => {
  if (level === L0 && bay === 1) return "gone";
  if (level === L2) return "open";
  return undefined;
});
// The returns' courtyard faces, and their fallen bays.
facade("x", north.z1, COURT.x1, COURT.x2, [L0, L1, L2], { open: 0.7, sash: 0.2, gone: 0.1 }, (bay, level) => (bay === 0 && level !== L2 ? "gone" : undefined));
facade("x", south.z2, COURT.x1, COURT.x2, [L0, L1, L2], { open: 0.7, sash: 0.2, gone: 0.1 }, (bay, level) => (bay === 1 && level !== L2 ? "gone" : undefined));
// The rear bar's courtyard face.
facade("z", rear.x1, COURT.z1, COURT.z2, [L0, L1, L2], { open: 0.6, sash: 0.3, gone: 0.1 }, (bay, level) => {
  if (level === L0 && bay === 2) return "gone";
  return undefined;
});
// Outer edges, bricked solid.
facade("z", rear.x2, rear.z1, rear.z2, [L0, L1, L2], { brick: 1 });
facade("x", -24, bar.x1, rear.x2, [L0, L1, L2], { brick: 1 });
facade("x", 24, bar.x1, rear.x2, [L0, L1, L2], { brick: 1 });
// Inside the ring: the returns are open to the bars they meet, so the block
// is one building rather than four. Only low walls between machine bays.
for (const x of [20]) {
  span("brick", x - 0.16, x + 0.16, L0, L0 + 1.3, 15 + COLUMN / 2, 21 - COLUMN / 2);
  span("brick", x - 0.16, x + 0.16, L0, L0 + 1.3, -21 + COLUMN / 2, -15 - COLUMN / 2);
}
tag("z", bar.x1, -16.5, -13, 1.0, 3.0, -1);
tag("z", bar.x1, 15, 20, L1 + 1.1, L1 + 3.0, -1);
tag("z", rear.x1, -8, -3, 1.0, 2.9, 1);
tag("x", north.z1, 20.5, 25, 1.2, 3.0, -1);

/* ------------------------------------------------------------------ *
 * The courtyard: where the building fell in, and where the fight is.
 * ------------------------------------------------------------------ */

span("rubble", COURT.x1, COURT.x2, -GROUND, L0, COURT.z1, COURT.z2);
// What came down from above, heaped where it landed.
rubblePile(17, -5, 4.5, 1.4);
rubblePile(23.5, 5, 4, 1.1);
rubblePile(20, 8.5, 3.5, 0.9);
leaningSlab(20.5, 1.5, 0.4);
leaningSlab(22.5, 7.5, -2.2, 3.4, 2.2);
// A piece of second floor that never quite fell: a shelf across the middle,
// cover under it and a perch on it.
span("floor", 18, 22, L1 - 0.6, L1 - 0.3, -0.5, 3.5, { tint: TINT.courtyard });
// Nature, back in.
tree(19.5, -6.5, 7.5);
tree(23.5, 9, 6);
scrub(16, 0.5, 1.6);
scrub(24.5, -7, 1.3);
scrub(15.5, 9.5, 1.2);

/* ------------------------------------------------------------------ *
 * Street furniture.
 * ------------------------------------------------------------------ */

for (let z = -22; z < 24; z += 4) {
  span("floor", -0.08, 0.08, 0, 0.012, z, z + 2, { tint: "#d8d3c4", solid: false });
}
car(-3.2, -13.5, 0.18);
truck(-3.2, 15, 1.62);
barrel(4.6, -8.2);
barrel(5.2, -9.1, 0.4, true);
barrel(-5.8, 15.2);
rubblePile(3, 6.5, 3.2, 0.8);
rubblePile(-4, 9.5, 2.6, 0.7);
tree(-6.6, 19.5, 6.5);
tree(6.8, -19, 7);
scrub(-6.5, -3, 1.4);
scrub(6.6, 12, 1.5);
// Sash sections that fell out of the frame and lie in the road.
box({ kind: "accent", x: 2.5, y: 0.08, z: -2, width: 3.2, height: 0.16, depth: 1.6, yaw: 0.5, tint: TINT.steel, solid: false });
// Inside the wings: machinery bases, the one thing too heavy to loot.
for (const [x, z] of [[-29, -9], [-23, 9], [-17, 15], [-29, 15], [-23, -21], [11, 19], [11, -19], [29, 2], [29, -18], [23, 18], [17, -18]]) {
  box({ kind: "frame", x, y: 0.45, z, width: 2.2, height: 0.9, depth: 1.6, tint: "#9a9488" });
}

/* ------------------------------------------------------------------ *
 * Spawns and targets.
 * ------------------------------------------------------------------ */

const spawns: SpawnPoint[] = [
  { team: "a", x: -28.5, z: -15, yaw: 0.35 },
  { team: "a", x: -28.5, z: -11, yaw: 0.2 },
  { team: "a", x: -26, z: -18.5, yaw: 0.5 },
  { team: "a", x: -29, z: -7, yaw: 0.1 },
  { team: "b", x: 29, z: 14, yaw: -2.9 },
  { team: "b", x: 29, z: 10, yaw: -3.0 },
  { team: "b", x: 28, z: 18.5, yaw: -2.7 },
  { team: "b", x: 29.5, z: 6, yaw: 3.1 },
];

const targets: TargetPlacement[] = [
  { id: "t_court_a", x: 19, z: 1.5, y: 0, yaw: -Math.PI * 0.5 },
  { id: "t_court_b", x: 24, z: -3, y: 0, yaw: -Math.PI * 0.6 },
  { id: "t_street_a", x: 2, z: 10, y: 0, yaw: Math.PI },
  { id: "t_street_b", x: -2.5, z: -19, y: 0, yaw: 0 },
  { id: "t_high_a", x: 11, z: 9, y: L1, yaw: -Math.PI * 0.5 },
  { id: "t_high_b", x: -11, z: -16, y: L1, yaw: Math.PI * 0.5 },
];

/**
 * A clear afternoon. Hard warm sun from the south-west lighting the street
 * bar's face, a blue sky in every opening, pale haze at the ends of the
 * street.
 */
const style: MapStyle = {
  /*
   * One palette, sun-bleached. Every colour here is a warm grey with a
   * little of something in it — brick a dusty brown-red, paint a rust that
   * has lost its orange, foliage an olive rather than a green — so that
   * nothing on the map is more saturated than the sky, and the sky is pale.
   * The hard warm key and a neutral fill do the rest: surfaces are told
   * apart by light and shade, not by hue.
   */
  concrete: "#a59f93",
  panel: "#9a948a",
  crate: "#8a7458",
  metal: "#6b6a66",
  grate: "#77766f",
  hazard: "#b7784a",
  hazardStripe: "#3a3733",
  brick: "#78514a",
  frame: "#a49e93",
  cladding: "#9b9d9c",
  spandrel: "#a2543a",
  asphalt: "#5d5b56",
  rubble: "#9e988c",
  foliage: "#647a44",
  graffiti: "#a09b92",
  fog: "#cdd3d6",
  sky: "#8fb5d9",
  skyLight: "#c9d3dc",
  groundLight: "#9a8a74",
  keyLight: "#ffe6c4",
  fillIntensity: 0.85,
  keyIntensity: 1.15,
  ambient: "#9a9793",
  keyDirection: { x: 0.55, y: -0.72, z: 0.3 },
  stripLight: "#ffe9c4",
};

export const boulevardMap: MapDefinition = {
  id: "boulevard",
  name: "Boulevard Works",
  tagline: "A ruined plant across a street, a bridge above it, a courtyard in the middle.",
  style,
  textureSeed: 0x51ab,
  size: 64,
  brushes,
  nav: {
    halfExtent: 32,
    ceilingY: ROOF - SLAB - 0.2,
    maxWalkableY: L2 + 0.9,
    maxLayers: 5,
  },
  spawns,
  targets,
};
