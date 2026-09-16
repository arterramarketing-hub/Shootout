import type { NavBakeOptions } from "../sim/navBake";

/**
 * What a brush is made of, which decides its texture and its shine.
 *
 * The first six are the industrial-interior set the early maps were built
 * from. The rest arrived with the ruined factory: an exposed concrete frame
 * with brick between the columns needs materials that read as brick, as
 * stained structural concrete and as corrugated sheet, none of which a wall
 * panel or a crate can be tinted into.
 */
export type SurfaceKind =
  | "floor"
  | "wall"
  | "prop"
  | "accent"
  | "catwalk"
  | "hazard"
  | "brick"
  | "frame"
  | "cladding"
  | "spandrel"
  | "asphalt"
  | "rubble"
  | "foliage"
  | "graffiti";

export interface BoxBrush {
  kind: SurfaceKind;
  /** Centre position in metres. */
  x: number;
  y: number;
  z: number;
  /** Full extents in metres. */
  width: number;
  height: number;
  depth: number;
  /** Rotation about the vertical axis, in radians. */
  yaw?: number;
  /** Ramps tilt about their local X axis. */
  pitch?: number;
  /** Set false for decoration the player should walk through. */
  solid?: boolean;
  /**
   * Multiplies this brush's surface colour, as a hex string.
   *
   * This is how a zone gets an identity. Every surface of a kind shares one
   * generated texture, so without it a level's four corners are the same grey
   * from every angle and a player has nothing to navigate by but the layout
   * they have not learned yet. Brushes sharing a kind and a tint still merge
   * into one draw call, so colour-coding a zone costs one extra call, not one
   * per brush.
   */
  tint?: string;
}

export interface SpawnPoint {
  team: "a" | "b";
  x: number;
  z: number;
  yaw: number;
}

export interface TargetPlacement {
  id: string;
  x: number;
  z: number;
  /** Height of the plate's base above the floor. */
  y: number;
  /** Facing, in radians. */
  yaw: number;
}

/** Per-map colouring, fed through the procedural texture generators. */
export interface MapStyle {
  concrete: string;
  panel: string;
  crate: string;
  metal: string;
  grate: string;
  hazard: string;
  hazardStripe: string;
  /** The ruin set: brickwork, structural concrete, sheet metal, paint, road. */
  brick: string;
  frame: string;
  cladding: string;
  spandrel: string;
  asphalt: string;
  rubble: string;
  foliage: string;
  graffiti: string;
  /** Fog and the colour beyond the level's edges. */
  fog: string;
  /**
   * What is drawn where there is no level: the sky. Left out, the fog colour
   * stands in for it, which suits an interior with no horizon and not a
   * street with a roofline against a blue sky.
   */
  sky?: string;
  /** Overhead fill and the warmer bounce coming back off the floor. */
  skyLight: string;
  groundLight: string;
  /** The one directional light. */
  keyLight: string;
  /** Light levels, so a darker palette can compensate rather than go murky. */
  fillIntensity: number;
  keyIntensity: number;
  /** Base ambient, which sets how readable the darkest corners are. */
  ambient: string;
  /** Direction the key light travels, normalised on use. */
  keyDirection: { x: number; y: number; z: number };
  /** Emissive strip lights, if the map uses them. */
  stripLight: string;
}

export interface MapDefinition {
  id: string;
  name: string;
  /** One-line description, shown in the lobby. */
  tagline: string;
  style: MapStyle;
  /** Seed for this map's generated textures. */
  textureSeed: number;
  /** Playable bounds, used for the minimap and out-of-bounds checks. */
  size: number;
  brushes: BoxBrush[];
  /**
   * How the navigation grid is sampled for this map, where the defaults do
   * not fit. A single-storey hall never needs this; a building with floors
   * stacked three high has to say how high its ceiling is, how far up a
   * bot may go, and how many surfaces can lie under one spot.
   */
  nav?: Partial<NavBakeOptions>;
  spawns: SpawnPoint[];
  /** Practice targets. Replaced by bots in Phase 2. */
  targets: TargetPlacement[];
}
