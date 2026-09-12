import type { BoxBrush, MapDefinition, MapStyle, SpawnPoint, TargetPlacement } from "./types";

/**
 * Substation: an enclosed switchgear hall at night.
 *
 * Deliberately the warehouse's opposite. Where that map is a wide floor with a
 * long mezzanine angle, this one is a grid of transformer blocks that breaks
 * every sightline into short lanes, with one raised gantry down the middle
 * that trades cover for vision. Tighter, faster, and far more lethal with the
 * shotgun.
 */

const WALL_HEIGHT = 5.0;
const WALL_THICKNESS = 0.4;
const HALF = 20;

const brushes: BoxBrush[] = [];

const box = (brush: BoxBrush): void => {
  brushes.push(brush);
};

const wall = (
  x1: number,
  z1: number,
  x2: number,
  z2: number,
  height = WALL_HEIGHT,
  kind: BoxBrush["kind"] = "wall",
): void => {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return;
  box({
    kind,
    x: (x1 + x2) / 2,
    y: height / 2,
    z: (z1 + z2) / 2,
    width: length,
    height,
    depth: WALL_THICKNESS,
    yaw: Math.atan2(dz, dx),
  });
};

// Floor and roof. The roof sits low, which is what makes the hall feel close.
box({ kind: "floor", x: 0, y: -0.25, z: 0, width: 44, height: 0.5, depth: 44 });
box({ kind: "wall", x: 0, y: 7.2, z: 0, width: 44, height: 0.5, depth: 44 });

// Perimeter.
wall(-HALF, -HALF, HALF, -HALF, 7);
wall(HALF, -HALF, HALF, HALF, 7);
wall(HALF, HALF, -HALF, HALF, 7);
wall(-HALF, HALF, -HALF, -HALF, 7);

/** A transformer: a tall block with a cooling stack and a hazard skirt. */
const transformer = (x: number, z: number, yaw = 0): void => {
  box({ kind: "accent", x, y: 1.25, z, width: 3.0, height: 2.5, depth: 2.2, yaw });
  box({ kind: "accent", x, y: 2.75, z, width: 1.1, height: 0.5, depth: 1.1, yaw });
  box({ kind: "hazard", x, y: 0.06, z, width: 4.0, height: 0.12, depth: 3.2, yaw });
};

// --- The block grid. Four rows of three, offset so no lane runs clean. -----
for (const [rowIndex, z] of [-12, -4, 4, 12].entries()) {
  const offset = rowIndex % 2 === 0 ? -1.6 : 1.6;
  for (const x of [-11 + offset, 0 + offset, 11 + offset]) {
    transformer(x, z, rowIndex % 2 === 0 ? 0 : Math.PI / 2);
  }
}

// --- Central gantry: vision down the long axis, at the cost of cover. ------
const GANTRY_Y = 2.9;
box({ kind: "catwalk", x: 0, y: GANTRY_Y, z: 0, width: 3.4, height: 0.3, depth: 26 });
wall(-1.9, -13, -1.9, 13, 1.0, "accent");
wall(1.9, -13, 1.9, 13, 1.0, "accent");

// Ramps up to it from both ends, shallow enough to walk.
const rampRise = GANTRY_Y;
const rampRun = 7.0;
const rampAngle = Math.atan2(rampRise, rampRun);
box({
  kind: "catwalk",
  x: 0, y: rampRise / 2, z: -16.5,
  width: 3.0, height: 0.3, depth: Math.hypot(rampRun, rampRise),
  pitch: -rampAngle,
});
box({
  kind: "catwalk",
  x: 0, y: rampRise / 2, z: 16.5,
  width: 3.0, height: 0.3, depth: Math.hypot(rampRun, rampRise),
  pitch: rampAngle,
});

// --- Side aisles: cable trays and low cover along the outer walls. ---------
for (const side of [-1, 1]) {
  const x = side * 16.5;
  box({ kind: "prop", x, y: 0.55, z: -8, width: 1.6, height: 1.1, depth: 4.0 });
  box({ kind: "prop", x, y: 0.55, z: 8, width: 1.6, height: 1.1, depth: 4.0 });
  box({ kind: "accent", x, y: 4.2, z: 0, width: 0.8, height: 0.3, depth: 34 });
  box({ kind: "prop", x: side * 12.5, y: 0.45, z: 0, width: 2.4, height: 0.9, depth: 1.4 });
}

// --- Spawn shelters at opposite corners of the long axis. -----------------
wall(-8, -17.5, -3, -17.5, 2.6, "prop");
wall(3, 17.5, 8, 17.5, 2.6, "prop");

const spawns: SpawnPoint[] = [
  // Yaw faces the centre of the hall. The middle pair sit clear of the ramp:
  // spawning on a slope drops the player somewhere they slide off before the
  // round has started.
  { team: "a", x: -6, z: -16, yaw: 0.3588 },
  { team: "a", x: -2.6, z: -18.5, yaw: 0.1396 },
  { team: "a", x: 6, z: -16, yaw: -0.3588 },
  { team: "b", x: 6, z: 16, yaw: -2.7828 },
  { team: "b", x: 2.6, z: 18.5, yaw: -3.002 },
  { team: "b", x: -6, z: 16, yaw: 2.7828 },
];

const targets: TargetPlacement[] = [
  { id: "s_close_a", x: -5.5, z: -6.5, y: 0, yaw: Math.PI * 0.2 },
  { id: "s_close_b", x: 5.5, z: -2.0, y: 0, yaw: -Math.PI * 0.1 },
  { id: "s_mid_a", x: -14.0, z: 3.0, y: 0, yaw: -Math.PI * 0.4 },
  { id: "s_mid_b", x: 14.0, z: -3.0, y: 0, yaw: Math.PI * 0.4 },
  { id: "s_gantry", x: 0, z: 6.0, y: 3.1, yaw: Math.PI },
];

/**
 * Sodium lamps in a cold hall: deep blue-grey concrete, orange hazard paint,
 * and a low warm key that leaves the corners genuinely dark.
 */
const substationStyle: MapStyle = {
  // Cool and industrial, but never so dark that a player standing still in a
  // corner stops being visible. Atmosphere is worth less than readability.
  concrete: "#697079",
  panel: "#737b85",
  crate: "#8a7c66",
  metal: "#5b636d",
  grate: "#666e78",
  hazard: "#626a74",
  hazardStripe: "#e8952f",
  fog: "#59636f",
  skyLight: "#a9c0d8",
  groundLight: "#5a5348",
  keyLight: "#ffd6a4",
  fillIntensity: 0.78,
  keyIntensity: 0.6,
  ambient: "#565c66",
  keyDirection: { x: 0.42, y: -0.62, z: -0.66 },
  stripLight: "#ffb765",
};

export const substationMap: MapDefinition = {
  id: "substation",
  name: "Substation",
  tagline: "Transformer blocks break every lane. The gantry sees everything.",
  style: substationStyle,
  textureSeed: 20260912,
  size: 40,
  brushes,
  spawns,
  targets,
};
