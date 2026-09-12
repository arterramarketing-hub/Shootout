import { Ray } from "@babylonjs/core/Culling/ray";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import {
  addNode,
  createEmptyGrid,
  linkNodes,
  type NavGrid,
} from "../sim/nav";
import { STANCE } from "../sim/config";

export interface NavBuildOptions {
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
  /** Vertical clearance a standing bot needs. */
  headroom: number;
  /** Surfaces steeper than this are not walkable. */
  maxSlopeDot: number;
  /** How many stacked surfaces to record per cell. */
  maxLayers: number;
}

export const DEFAULT_NAV_OPTIONS: NavBuildOptions = {
  halfExtent: 20,
  cellSize: 0.6,
  ceilingY: 7.2,
  maxWalkableY: 6,
  headroom: STANCE.standHeight - 0.1,
  // About 33 degrees. The ramps sit well inside this; walls do not.
  maxSlopeDot: 0.84,
  maxLayers: 2,
};

export interface NavBuildResult {
  grid: NavGrid;
  /** Milliseconds spent building, for the performance budget. */
  millis: number;
  raycasts: number;
}

/**
 * Build the navigation grid by sampling the level with rays.
 *
 * The grid itself is plain data, so this is the only part of navigation that
 * touches the engine. In Phase 3 the server can bake the same grid from the
 * same map definition, or load one produced here, without importing Babylon.
 */
export const buildNavGrid = (
  scene: Scene,
  options: NavBuildOptions = DEFAULT_NAV_OPTIONS,
): NavBuildResult => {
  const started = performance.now();
  const { cellSize, halfExtent, ceilingY, headroom, maxSlopeDot, maxLayers, maxWalkableY } =
    options;

  const cols = Math.floor((halfExtent * 2) / cellSize) + 1;
  const rows = cols;
  const originX = -halfExtent;
  const originZ = -halfExtent;
  const grid = createEmptyGrid(cellSize, originX, originZ, cols, rows);

  const down = new Vector3(0, -1, 0);
  const up = new Vector3(0, 1, 0);
  const ray = new Ray(new Vector3(), down, 1);
  let raycasts = 0;

  // Only level geometry blocks movement; targets and effects are ignored.
  const solid = (mesh: { checkCollisions: boolean; isPickable: boolean }) =>
    mesh.isPickable && mesh.checkCollisions;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = originX + col * cellSize;
      const z = originZ + row * cellSize;
      let searchFrom = ceilingY;

      for (let layer = 0; layer < maxLayers; layer += 1) {
        ray.origin.set(x, searchFrom, z);
        ray.direction.copyFrom(down);
        ray.length = searchFrom + 1;
        const hit = scene.pickWithRay(ray, solid);
        raycasts += 1;
        if (!hit?.hit || !hit.pickedPoint) break;

        const surfaceY = hit.pickedPoint.y;
        const normal = hit.getNormal(true);
        const walkable = surfaceY <= maxWalkableY && (!normal || normal.y >= maxSlopeDot);

        if (walkable && hasHeadroom(scene, x, surfaceY, z, headroom, up, solid)) {
          addNode(grid, col, row, surfaceY);
          raycasts += 1;
        } else if (walkable) {
          raycasts += 1;
        }

        // Keep searching underneath, which is what finds the floor below
        // the mezzanine. Step well clear of the surface just hit.
        searchFrom = surfaceY - 0.35;
        if (searchFrom <= 0.1) break;
      }
    }
  }

  linkNodes(grid);
  return { grid, millis: Math.round(performance.now() - started), raycasts };
};

const hasHeadroom = (
  scene: Scene,
  x: number,
  y: number,
  z: number,
  headroom: number,
  up: Vector3,
  predicate: (mesh: { checkCollisions: boolean; isPickable: boolean }) => boolean,
): boolean => {
  const probe = new Ray(new Vector3(x, y + 0.15, z), up, headroom);
  return !(scene.pickWithRay(probe, predicate)?.hit ?? false);
};
