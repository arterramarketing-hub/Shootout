import type { BoxBrush, MapDefinition, MapStyle, SpawnPoint, TargetPlacement } from "./types";

const WALL_HEIGHT = 4.2;
const WALL_THICKNESS = 0.4;
const HALF = 20;

/*
 * Zone colours.
 *
 * Every surface of a kind shares one generated texture, so an untinted level
 * is the same grey in all four corners and a player mid-fight has nothing to
 * navigate by except a layout they have not learned yet. Each zone therefore
 * takes a colour, carried on the things you can see from across the map —
 * pillars, rails, signage — rather than on the floor, which you are not
 * looking at. They are desaturated on purpose: a landmark has to be
 * identifiable at a glance without turning the level into a toy.
 */
const ZONE = {
  /** North-west offices: warm amber. */
  office: "#c8a05e",
  /** East mezzanine: cold blue, matching the height advantage it gives. */
  mezzanine: "#6f9fd0",
  /** South loading bay: rust. */
  loading: "#c47a55",
  /** The crane over the middle, and the pillars that frame it. */
  centre: "#9aa6b4",
} as const;

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
  tint?: string,
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
    tint,
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
// Doorways are gaps left between wall segments rather than cut geometry, and
// the block needs two of them to the warehouse floor. With the outer walls
// unbroken it is a sealed box, and a player spawning inside can reach the
// rooms and nothing else.
wall(-HALF, -6, -11, -6);
wall(-8, -6, -6, -6);
wall(-6, -6, -6, -11);
wall(-6, -14, -6, -HALF);

// A sign band along the office block's two outer walls, at head height, so
// the block announces itself from the middle of the floor rather than only
// once you are inside it.
box({
  kind: "hazard", x: -13.2, y: 3.4, z: -6,
  width: 13.6, height: 0.7, depth: 0.5, tint: ZONE.office, solid: false,
});
box({
  kind: "hazard", x: -6, y: 3.4, z: -13.2,
  width: 0.5, height: 0.7, depth: 13.6, tint: ZONE.office, solid: false,
});
// Roof plant, the part you can see over the walls from anywhere south or east.
box({
  kind: "prop", x: -14, y: 5.0, z: -11, width: 4.4, height: 1.8, depth: 3.2,
  tint: ZONE.office, solid: false,
});
box({
  kind: "accent", x: -11.2, y: 5.6, z: -14.5, width: 1.1, height: 3.0, depth: 1.1,
  tint: ZONE.office, solid: false,
});

wall(-13, -6, -13, -14); // room divider
wall(-HALF, -12, -13, -12);
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
// Each wears a coloured band at eye height, which is what turns a row of
// identical grey posts into something a player can count their position from.
for (const px of [-8, 0, 8]) {
  for (const pz of [-8, 0, 8]) {
    if (px === 0 && pz === 0) continue;
    box({ kind: "accent", x: px, y: 4.1, z: pz, width: 0.7, height: 8.2, depth: 0.7 });
    box({
      kind: "hazard", x: px, y: 1.55, z: pz,
      width: 0.78, height: 0.5, depth: 0.78,
      tint: ZONE.centre, solid: false,
    });
  }
}

/*
 * Gantry crane over the middle of the floor.
 *
 * The map's one landmark visible from everywhere, and the reason it exists:
 * a player who has lost their bearings can find the centre by looking up,
 * from any corner, without having to recognise a wall. It hangs at four
 * metres so nothing about it obstructs a fight underneath.
 */
const CRANE_Y = 5.4;
// Rails the gantry would run along, north to south down both sides.
for (const rx of [-6.5, 6.5]) {
  box({
    kind: "accent", x: rx, y: CRANE_Y + 0.6, z: 0,
    width: 0.45, height: 0.45, depth: 34, tint: ZONE.centre, solid: false,
  });
}
// The bridge across them, and the trolley and hook hanging off it.
box({
  kind: "accent", x: 0, y: CRANE_Y, z: -3,
  width: 14.4, height: 0.7, depth: 1.1, tint: ZONE.centre, solid: false,
});
box({
  kind: "hazard", x: 0, y: CRANE_Y - 0.55, z: -3,
  width: 14.4, height: 0.4, depth: 1.2, tint: ZONE.centre, solid: false,
});
box({
  kind: "accent", x: 2.5, y: CRANE_Y - 1.0, z: -3,
  width: 1.6, height: 1.0, depth: 1.6, tint: ZONE.centre, solid: false,
});
box({
  kind: "accent", x: 2.5, y: CRANE_Y - 2.4, z: -3,
  width: 0.16, height: 1.8, depth: 0.16, solid: false,
});
box({
  kind: "hazard", x: 2.5, y: CRANE_Y - 3.5, z: -3,
  width: 0.8, height: 0.5, depth: 0.8, tint: ZONE.centre, solid: false,
});

// --- East mezzanine: height advantage, reached by two ramps. -----------------
const MEZZ_Y = 3.0;
box({ kind: "catwalk", x: 14, y: MEZZ_Y, z: 0, width: 11, height: 0.4, depth: 24 });
// Guard rail, low enough to shoot over from a crouch.
wall(8.6, -12, 8.6, 12, 1.0, "accent");
// Ramps. A pitch shallower than the slope limit so they are walkable.
// The run is set so each ramp's top edge lands exactly on the deck edge at
// z = 12. Tucking the top under the deck instead leaves the first cell past
// the deck more than a step below it, and the whole mezzanine ends up as an
// island nothing can path onto.
const RAMP_RUN = 7.0;
const RAMP_CENTRE = 12 + RAMP_RUN / 2;
const rampAngle = -Math.atan2(MEZZ_Y, RAMP_RUN);
box({
  kind: "catwalk",
  x: 12, y: MEZZ_Y / 2, z: -RAMP_CENTRE,
  width: 3.6, height: 0.4, depth: Math.hypot(RAMP_RUN, MEZZ_Y),
  pitch: rampAngle,
});
box({
  kind: "catwalk",
  x: 12, y: MEZZ_Y / 2, z: RAMP_CENTRE,
  width: 3.6, height: 0.4, depth: Math.hypot(RAMP_RUN, MEZZ_Y),
  pitch: -rampAngle,
});
// A rail along the open edge of the deck itself, rather than at floor level.
// Tinted, because this edge is the single most-watched line on the map and it
// should be obvious from the floor which side of it you are looking at.
box({
  kind: "accent", x: 8.6, y: MEZZ_Y + 0.7, z: 0,
  width: 0.2, height: 1.0, depth: 24, tint: ZONE.mezzanine,
});
// Storage racking along the east wall behind the deck: a tall striped face
// that reads as "the high ground" from the far side of the building.
for (const rz of [-9, -3, 3, 9]) {
  // Solid, unlike the rest of the dressing: this sits on the deck at the
  // height of a standing player, so it has to be something they walk around
  // and shoot from behind rather than through.
  box({
    kind: "prop", x: 18.6, y: MEZZ_Y + 1.6, z: rz,
    width: 2.2, height: 3.2, depth: 4.4, tint: ZONE.mezzanine,
  });
  box({
    kind: "accent", x: 18.6, y: MEZZ_Y + 3.3, z: rz,
    width: 2.4, height: 0.25, depth: 4.6, tint: ZONE.mezzanine, solid: false,
  });
}
// Cover on the mezzanine itself.
box({ kind: "prop", x: 11.5, y: MEZZ_Y + 0.7, z: -5, width: 2.4, height: 1.0, depth: 1.2 });
box({ kind: "prop", x: 16, y: MEZZ_Y + 0.7, z: 5, width: 1.2, height: 1.0, depth: 2.6 });

// --- South loading bay: wide, exposed, with container cover. -----------------
wall(-HALF, 8, -4, 8);
wall(-4, 8, -4, 13);
box({ kind: "prop", x: -14, y: 1.4, z: 14, width: 6.5, height: 2.8, depth: 2.6, tint: ZONE.loading });
box({ kind: "prop", x: -7, y: 1.4, z: 17, width: 2.6, height: 2.8, depth: 5.0, tint: ZONE.loading });
box({ kind: "prop", x: -16.5, y: 0.6, z: 4, width: 2.2, height: 1.2, depth: 2.2 });
// A container stacked on the first, high enough to see from the north end.
box({
  kind: "prop", x: -14, y: 4.2, z: 14, width: 6.5, height: 2.8, depth: 2.6,
  tint: ZONE.loading, solid: false,
});
// Dock door frames along the south wall, evenly spaced, which give the wall a
// rhythm to count along instead of reading as one flat surface.
for (const dx of [2, 8, 14]) {
  box({
    kind: "hazard", x: dx, y: 2.1, z: HALF - 0.3,
    width: 3.4, height: 4.2, depth: 0.25, tint: ZONE.loading, solid: false,
  });
  box({
    kind: "accent", x: dx, y: 4.35, z: HALF - 0.3,
    width: 3.8, height: 0.4, depth: 0.35, tint: ZONE.loading, solid: false,
  });
}

const spawns: SpawnPoint[] = [
  // Yaw faces the centre of the map, so a player never spawns staring at the
  // wall behind them. Every one of these stands on open floor: spawning on a
  // desk, a crate or a ramp drops the player somewhere they have to climb off
  // before the round starts.
  { team: "a", x: -16, z: -16, yaw: 0.7854 },
  { team: "a", x: -15, z: -18.5, yaw: 0.6813 },
  { team: "a", x: -18.5, z: -13, yaw: 0.9583 },
  { team: "b", x: 15, z: 15, yaw: -2.3562 },
  { team: "b", x: 16, z: 18, yaw: -2.415 },
  { team: "b", x: 18.5, z: 13, yaw: -2.1833 },
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

/**
 * Daylight through high windows onto bare concrete: cool greys, warm timber,
 * and a single strong key from above and behind the north wall.
 */
const warehouseStyle: MapStyle = {
  concrete: "#6e737b",
  panel: "#7a808a",
  crate: "#a98f6a",
  metal: "#5d636c",
  grate: "#6a7078",
  hazard: "#8a8f96",
  hazardStripe: "#d8a53c",
  fog: "#8a9099",
  skyLight: "#cfdcea",
  groundLight: "#6b6154",
  keyLight: "#fff3dc",
  fillIntensity: 0.62,
  keyIntensity: 0.68,
  ambient: "#4d5158",
  keyDirection: { x: -0.55, y: -0.72, z: 0.42 },
  stripLight: "#ffe9c4",
};

export const greyboxMap: MapDefinition = {
  id: "warehouse",
  name: "Warehouse",
  tagline: "Open floor, crate cover, a mezzanine that owns the long angles.",
  style: warehouseStyle,
  textureSeed: 1337,
  size: 40,
  brushes,
  spawns,
  targets,
};
