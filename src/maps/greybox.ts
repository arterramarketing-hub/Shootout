import type { BoxBrush, MapDefinition, SpawnPoint, TargetPlacement } from "./types";

const WALL_HEIGHT = 4.2;
const WALL_THICKNESS = 0.4;
const HALF = 20;

const brushes: BoxBrush[] = [];

const box = (brush: BoxBrush): void => {
  brushes.push(brush);
};

/** A wall segment described by its two endpoints, which is how levels are drawn. */
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

// Floor and ceiling. The ceiling keeps the space reading as interior.
box({ kind: "floor", x: 0, y: -0.25, z: 0, width: 44, height: 0.5, depth: 44 });
box({ kind: "wall", x: 0, y: 8.2, z: 0, width: 44, height: 0.5, depth: 44 });

// Perimeter.
wall(-HALF, -HALF, HALF, -HALF, 8);
wall(HALF, -HALF, HALF, HALF, 8);
wall(HALF, HALF, -HALF, HALF, 8);
wall(-HALF, HALF, -HALF, -HALF, 8);

// --- North-west office block: tight rooms, short sightlines. -----------------
wall(-HALF, -6, -6, -6);
wall(-6, -6, -6, -HALF);
wall(-13, -6, -13, -14); // room divider
wall(-HALF, -12, -13, -12);
// Doorways are gaps left between wall segments rather than cut geometry.
wall(-9.5, -6, -9.5, -9);
wall(-9.5, -11.5, -9.5, -HALF);

// Desks and filing cabinets: waist-high cover that breaks up the rooms.
box({ kind: "prop", x: -16, y: 0.45, z: -9, width: 3.2, height: 0.9, depth: 1.4 });
box({ kind: "prop", x: -11.5, y: 0.45, z: -16, width: 1.4, height: 0.9, depth: 3.0 });
box({ kind: "prop", x: -7.5, y: 0.8, z: -13, width: 1.0, height: 1.6, depth: 2.2 });
box({ kind: "prop", x: -17.5, y: 0.6, z: -15.5, width: 2.0, height: 1.2, depth: 1.0 });

// --- Central warehouse floor: the long engagement. ---------------------------
// Crate stacks, deliberately irregular so no two angles play the same.
const crate = (x: number, z: number, height: number, size = 1.2): void => {
  box({ kind: "prop", x, y: height / 2, z, width: size, height, depth: size });
};
crate(-2, 2, 2.4, 1.4);
crate(-2, 3.6, 1.2, 1.4);
crate(0.5, 1.2, 1.2, 1.4);
crate(3.5, -1, 2.4, 1.4);
crate(3.5, 0.5, 1.2, 1.4);
crate(6, 4, 1.2, 1.4);
crate(-5, -2, 1.2, 1.4);
crate(-4.8, 6.5, 2.4, 1.4);
crate(8, -4.5, 1.2, 1.4);

// Structural pillars on a grid, the one piece of order in the open space.
for (const px of [-8, 0, 8]) {
  for (const pz of [-8, 0, 8]) {
    if (px === 0 && pz === 0) continue;
    box({ kind: "accent", x: px, y: 4.1, z: pz, width: 0.7, height: 8.2, depth: 0.7 });
  }
}

// --- East mezzanine: height advantage, reached by two ramps. -----------------
const MEZZ_Y = 3.0;
box({ kind: "catwalk", x: 14, y: MEZZ_Y, z: 0, width: 11, height: 0.4, depth: 24 });
// Guard rail, low enough to shoot over from a crouch.
wall(8.6, -12, 8.6, 12, 1.0, "accent");
// Ramps. A pitch shallower than the slope limit so they are walkable.
const rampAngle = -Math.atan2(MEZZ_Y, 7.5);
box({
  kind: "catwalk",
  x: 12, y: MEZZ_Y / 2, z: -14.5,
  width: 3.6, height: 0.4, depth: Math.hypot(7.5, MEZZ_Y),
  pitch: rampAngle,
});
box({
  kind: "catwalk",
  x: 12, y: MEZZ_Y / 2, z: 14.5,
  width: 3.6, height: 0.4, depth: Math.hypot(7.5, MEZZ_Y),
  pitch: -rampAngle,
});
// Cover on the mezzanine itself.
box({ kind: "prop", x: 11.5, y: MEZZ_Y + 0.7, z: -5, width: 2.4, height: 1.0, depth: 1.2 });
box({ kind: "prop", x: 16, y: MEZZ_Y + 0.7, z: 5, width: 1.2, height: 1.0, depth: 2.6 });

// --- South loading bay: wide, exposed, with container cover. -----------------
wall(-HALF, 8, -4, 8);
wall(-4, 8, -4, 13);
box({ kind: "prop", x: -14, y: 1.4, z: 14, width: 6.5, height: 2.8, depth: 2.6 });
box({ kind: "prop", x: -7, y: 1.4, z: 17, width: 2.6, height: 2.8, depth: 5.0 });
box({ kind: "prop", x: -16.5, y: 0.6, z: 4, width: 2.2, height: 1.2, depth: 2.2 });

const spawns: SpawnPoint[] = [
  // Yaw faces the centre of the map, so a player never spawns
  // staring at the wall behind them.
  { team: "a", x: -16, z: -16, yaw: 0.7854 },
  { team: "a", x: -12, z: -17, yaw: 0.6147 },
  { team: "a", x: -17, z: -9, yaw: 1.0839 },
  { team: "b", x: 15, z: 15, yaw: -2.3562 },
  { team: "b", x: 12, z: 17, yaw: -2.5269 },
  { team: "b", x: 17, z: 11, yaw: -2.1451 },
];

/**
 * Practice targets, placed to exercise each weapon's effective range: two
 * close for the shotgun, a mid-range pair on the warehouse floor, and two
 * long shots onto the mezzanine.
 */
const targets: TargetPlacement[] = [
  { id: "t_close_a", x: -3.5, z: -3.0, y: 0, yaw: Math.PI * 0.25 },
  { id: "t_close_b", x: 1.5, z: -4.5, y: 0, yaw: Math.PI * 0.1 },
  { id: "t_mid_a", x: -7.0, z: 9.5, y: 0, yaw: -Math.PI * 0.2 },
  { id: "t_mid_b", x: 5.5, z: 8.0, y: 0, yaw: -Math.PI * 0.35 },
  { id: "t_far_a", x: 12.0, z: -2.0, y: 3.2, yaw: -Math.PI * 0.5 },
  { id: "t_far_b", x: 15.0, z: 7.5, y: 3.2, yaw: -Math.PI * 0.6 },
];

export const greyboxMap: MapDefinition = {
  id: "warehouse_greybox",
  name: "Warehouse (greybox)",
  size: 40,
  brushes,
  spawns,
  targets,
};
