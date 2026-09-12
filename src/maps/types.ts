export type SurfaceKind = "floor" | "wall" | "prop" | "accent" | "catwalk" | "hazard";

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
  /** Fog and the colour beyond the level's edges. */
  fog: string;
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
  spawns: SpawnPoint[];
  /** Practice targets. Replaced by bots in Phase 2. */
  targets: TargetPlacement[];
}
