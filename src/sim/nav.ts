import { vec3, type Vec3 } from "./vec3";

/**
 * Navigation data, as plain numbers.
 *
 * A layered grid rather than a recast navmesh. Three reasons: the level is
 * boxes on a floor with one raised deck, which a grid represents exactly; the
 * whole of `sim` has to run on the authoritative server in Phase 3, and plain
 * arrays travel and serialise far more easily than a wasm navmesh; and on a
 * phone the megabyte a navmesh library costs buys nothing a grid cannot do
 * here. Layers are what let the mezzanine and the floor beneath it coexist.
 */
export interface NavNode {
  index: number;
  col: number;
  row: number;
  /** Height of the walkable surface at this node. */
  y: number;
  /** Indices of nodes reachable in one step. */
  links: number[];
}

export interface NavGrid {
  cellSize: number;
  /** World position of the centre of cell (0, 0). */
  originX: number;
  originZ: number;
  cols: number;
  rows: number;
  nodes: NavNode[];
  /** Node indices stacked at each cell, nearest the floor first. */
  cells: number[][];
}

/** The largest height change a bot will take in one step, in metres. */
export const MAX_STEP = 0.55;

export const createEmptyGrid = (
  cellSize: number,
  originX: number,
  originZ: number,
  cols: number,
  rows: number,
): NavGrid => ({
  cellSize,
  originX,
  originZ,
  cols,
  rows,
  nodes: [],
  cells: Array.from({ length: cols * rows }, () => []),
});

export const cellIndex = (grid: NavGrid, col: number, row: number): number =>
  row * grid.cols + col;

export const nodeWorldPosition = (grid: NavGrid, node: NavNode): Vec3 =>
  vec3(
    grid.originX + node.col * grid.cellSize,
    node.y,
    grid.originZ + node.row * grid.cellSize,
  );

export const worldToCell = (
  grid: NavGrid,
  x: number,
  z: number,
): { col: number; row: number } => ({
  col: Math.round((x - grid.originX) / grid.cellSize),
  row: Math.round((z - grid.originZ) / grid.cellSize),
});

export const addNode = (grid: NavGrid, col: number, row: number, y: number): NavNode => {
  const node: NavNode = { index: grid.nodes.length, col, row, y, links: [] };
  grid.nodes.push(node);
  const cell = grid.cells[cellIndex(grid, col, row)];
  cell.push(node.index);
  cell.sort((a, b) => grid.nodes[a].y - grid.nodes[b].y);
  return node;
};

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Connect every node to the neighbours it can actually step to. */
export const linkNodes = (grid: NavGrid): void => {
  for (const node of grid.nodes) {
    node.links.length = 0;
    for (const [dc, dr] of NEIGHBOURS) {
      const col = node.col + dc;
      const row = node.row + dr;
      if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;

      // A diagonal that squeezes past a wall corner would let a bot walk
      // through the corner, so both orthogonal neighbours must be open too.
      if (dc !== 0 && dr !== 0) {
        if (!hasNodeNear(grid, node.col + dc, node.row, node.y)) continue;
        if (!hasNodeNear(grid, node.col, node.row + dr, node.y)) continue;
      }

      for (const candidate of grid.cells[cellIndex(grid, col, row)]) {
        if (Math.abs(grid.nodes[candidate].y - node.y) <= MAX_STEP) {
          node.links.push(candidate);
        }
      }
    }
  }
};

const hasNodeNear = (grid: NavGrid, col: number, row: number, y: number): boolean => {
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return false;
  return grid.cells[cellIndex(grid, col, row)].some(
    (index) => Math.abs(grid.nodes[index].y - y) <= MAX_STEP,
  );
};

/** The walkable node closest to a world position, or null if none is near. */
export const nearestNode = (
  grid: NavGrid,
  position: Vec3,
  maxCellRadius = 4,
): NavNode | null => {
  const { col, row } = worldToCell(grid, position.x, position.z);
  let best: NavNode | null = null;
  let bestDistance = Infinity;

  for (let radius = 0; radius <= maxCellRadius; radius += 1) {
    for (let dr = -radius; dr <= radius; dr += 1) {
      for (let dc = -radius; dc <= radius; dc += 1) {
        // Only the ring at this radius; the inside was covered already.
        if (radius > 0 && Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
        for (const index of grid.cells[cellIndex(grid, c, r)]) {
          const node = grid.nodes[index];
          const world = nodeWorldPosition(grid, node);
          const distance =
            (world.x - position.x) ** 2 +
            (world.y - position.y) ** 2 * 4 +
            (world.z - position.z) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = node;
          }
        }
      }
    }
    // Stop at the first ring that produced a hit; anything further is worse.
    if (best) return best;
  }
  return best;
};

const heuristic = (grid: NavGrid, a: NavNode, b: NavNode): number => {
  const dx = (a.col - b.col) * grid.cellSize;
  const dz = (a.row - b.row) * grid.cellSize;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dz * dz + dy * dy);
};

/**
 * A* between two nodes. Returns world positions, start excluded.
 *
 * `maxVisited` caps the work one call can do, so a bot asking for an
 * unreachable destination cannot stall a frame.
 */
export const findPath = (
  grid: NavGrid,
  startIndex: number,
  goalIndex: number,
  maxVisited = 4000,
): Vec3[] | null => {
  if (startIndex === goalIndex) return [];
  const start = grid.nodes[startIndex];
  const goal = grid.nodes[goalIndex];
  if (!start || !goal) return null;

  const count = grid.nodes.length;
  const cameFrom = new Int32Array(count).fill(-1);
  const gScore = new Float32Array(count).fill(Infinity);
  const closed = new Uint8Array(count);

  gScore[startIndex] = 0;
  // A plain array used as a priority queue. The node counts here are small
  // enough that a binary heap would not pay for its own complexity.
  const open: { index: number; f: number }[] = [
    { index: startIndex, f: heuristic(grid, start, goal) },
  ];
  let visited = 0;

  while (open.length > 0 && visited < maxVisited) {
    let bestSlot = 0;
    for (let i = 1; i < open.length; i += 1) {
      if (open[i].f < open[bestSlot].f) bestSlot = i;
    }
    const current = open.splice(bestSlot, 1)[0];
    if (closed[current.index]) continue;
    closed[current.index] = 1;
    visited += 1;

    if (current.index === goalIndex) {
      return reconstruct(grid, cameFrom, goalIndex);
    }

    const node = grid.nodes[current.index];
    for (const neighbour of node.links) {
      if (closed[neighbour]) continue;
      const step = heuristic(grid, node, grid.nodes[neighbour]);
      const tentative = gScore[current.index] + step;
      if (tentative >= gScore[neighbour]) continue;
      cameFrom[neighbour] = current.index;
      gScore[neighbour] = tentative;
      open.push({
        index: neighbour,
        f: tentative + heuristic(grid, grid.nodes[neighbour], goal),
      });
    }
  }
  return null;
};

const reconstruct = (grid: NavGrid, cameFrom: Int32Array, goalIndex: number): Vec3[] => {
  const path: Vec3[] = [];
  let index = goalIndex;
  while (index !== -1) {
    path.push(nodeWorldPosition(grid, grid.nodes[index]));
    index = cameFrom[index];
  }
  path.reverse();
  // Drop the start: the walker is already standing on it.
  path.shift();
  return path;
};

/** A* between two world positions. */
export const findPathBetween = (
  grid: NavGrid,
  from: Vec3,
  to: Vec3,
): Vec3[] | null => {
  const start = nearestNode(grid, from);
  const goal = nearestNode(grid, to);
  if (!start || !goal) return null;
  return findPath(grid, start.index, goal.index);
};

/** A walkable node chosen by the given random source. */
export const randomNode = (grid: NavGrid, unit: number): NavNode | null => {
  if (grid.nodes.length === 0) return null;
  const index = Math.min(grid.nodes.length - 1, Math.floor(unit * grid.nodes.length));
  return grid.nodes[index];
};

/**
 * Drop walkable islands nothing can reach.
 *
 * A desk top or a crate lid is a perfectly flat, perfectly walkable surface
 * that no one can step onto, because the climb exceeds the step limit. Left in
 * the grid they are traps: a bot that starts on one snaps to it and can never
 * leave, since it has no links to anywhere else. The threshold has to clear
 * the largest piece of furniture in any map, not merely the smallest.
 */
export const pruneIsolated = (grid: NavGrid): number => {
  const component = new Int32Array(grid.nodes.length).fill(-1);
  const sizes: number[] = [];

  for (const node of grid.nodes) {
    if (component[node.index] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    const stack = [node.index];
    component[node.index] = id;
    while (stack.length > 0) {
      const current = stack.pop()!;
      size += 1;
      for (const link of grid.nodes[current].links) {
        if (component[link] !== -1) continue;
        component[link] = id;
        stack.push(link);
      }
    }
    sizes.push(size);
  }

  /*
   * Keep only the largest component.
   *
   * A size threshold was the previous rule and it is the wrong question: a
   * pocket is useless because nothing can reach it, not because it is small.
   * The flat top of a four-metre cabinet is eighty walkable cells that no
   * player or bot can climb onto, and it sailed past any threshold low enough
   * to keep real ground. Nothing in this game climbs or jumps, so anything not
   * joined to the main body is unreachable by definition.
   *
   * The reachability tests assert that every spawn lands in the surviving
   * component, which is what would catch a map whose halves are genuinely
   * separate rather than merely decorated.
   */
  const largest = sizes.indexOf(Math.max(...sizes));
  const keep = grid.nodes.filter((node) => component[node.index] === largest);
  const removed = grid.nodes.length - keep.length;
  if (removed === 0) return 0;

  // Indices are positional, so surviving nodes have to be renumbered and the
  // cell lists and links rebuilt from scratch.
  grid.nodes = [];
  grid.cells = Array.from({ length: grid.cols * grid.rows }, () => []);
  for (const node of keep) addNode(grid, node.col, node.row, node.y);
  linkNodes(grid);
  return removed;
};
