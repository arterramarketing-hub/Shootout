export type SurfaceKind = "floor" | "wall" | "prop" | "accent" | "catwalk";

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

export interface MapDefinition {
  id: string;
  name: string;
  /** Playable bounds, used for the minimap and out-of-bounds checks. */
  size: number;
  brushes: BoxBrush[];
  spawns: SpawnPoint[];
  /** Practice targets. Replaced by bots in Phase 2. */
  targets: TargetPlacement[];
}
