import type { BrushWorld } from "./brushWorld";
import { STANCE } from "./config";
import { addNode, createEmptyGrid, linkNodes, pruneIsolated, type NavGrid } from "./nav";
import { vec3 } from "./vec3";

export interface NavBakeOptions {
  /** Half-width of the square area to sample, in metres. */
  halfExtent: number;
  cellSize: number;
  /**
   * Height the downward rays start from. Must sit inside the playable volume,
   * below any ceiling: a ray starting above the roof finds the roof first and
   * happily marks the top of the building as walkable ground.
   */
  ceilingY: number;
  /** Surfaces above this are never walkable, whatever the rays find. */
  maxWalkableY: number;
  /** Vertical clearance a standing combatant needs. */
  headroom: number;
  /** Surfaces steeper than this are not walkable. About 33 degrees. */
  maxSlopeNormalY: number;
  /**
   * How many walkable surfaces to record per cell.
   *
   * Only surfaces a bot can stand on count. The ray also meets beams, roof
   * decks and the undersides of things on its way down, and if those spent
   * the budget a building with a frame would lose its ground floor along
   * every grid line — which chops it into islands the size of one bay.
   */
  maxLayers: number;
}

export const DEFAULT_NAV_BAKE: NavBakeOptions = {
  halfExtent: 20,
  cellSize: 0.6,
  ceilingY: 7.2,
  maxWalkableY: 6,
  headroom: STANCE.standHeight - 0.1,
  maxSlopeNormalY: 0.84,
  maxLayers: 2,
};

export interface NavBakeResult {
  grid: NavGrid;
  millis: number;
  raycasts: number;
  /** Nodes discarded as unreachable islands. */
  pruned: number;
}

/**
 * Bake the navigation grid from level geometry, with no engine involved.
 *
 * The server runs the bots, so it has to produce the same grid the client
 * does. Sampling the shared brush world rather than an engine scene is what
 * makes that automatic.
 */
export const bakeNavGrid = (
  world: BrushWorld,
  overrides: Partial<NavBakeOptions> = {},
): NavBakeResult => {
  const started = Date.now();
  const options: NavBakeOptions = { ...DEFAULT_NAV_BAKE, ...overrides };
  const { cellSize, halfExtent, ceilingY, headroom, maxSlopeNormalY, maxLayers, maxWalkableY } =
    options;

  const cols = Math.floor((halfExtent * 2) / cellSize) + 1;
  const grid = createEmptyGrid(cellSize, -halfExtent, -halfExtent, cols, cols);
  const down = vec3(0, -1, 0);
  const up = vec3(0, 1, 0);
  let raycasts = 0;

  for (let row = 0; row < cols; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = -halfExtent + col * cellSize;
      const z = -halfExtent + row * cellSize;
      let searchFrom = ceilingY;

      let found = 0;
      // Bounded separately from the walkable count, so a column of clutter
      // cannot keep the search going forever, and generously enough that it
      // still reaches the floor under three storeys of structure.
      for (let step = 0; step < maxLayers * 4 && found < maxLayers; step += 1) {
        const hit = world.raycast(vec3(x, searchFrom, z), down, searchFrom + 1);
        raycasts += 1;
        if (!hit) break;

        const surfaceY = hit.point.y;
        const walkable = surfaceY <= maxWalkableY && hit.normal.y >= maxSlopeNormalY;
        if (walkable) {
          const clear = world.raycast(vec3(x, surfaceY + 0.15, z), up, headroom);
          raycasts += 1;
          if (!clear) {
            addNode(grid, col, row, surfaceY);
            found += 1;
          }
        }

        // Keep searching underneath, which is what finds the floor below the
        // mezzanine. Step well clear of the surface just hit.
        searchFrom = surfaceY - 0.35;
        if (searchFrom <= 0.1) break;
      }
    }
  }

  linkNodes(grid);
  const pruned = pruneIsolated(grid);
  return { grid, millis: Date.now() - started, raycasts, pruned };
};
