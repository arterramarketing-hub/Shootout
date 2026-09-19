/**
 * Where to arrive.
 *
 * Engine-free, so the server picks spawns the same way the client does.
 */

/** A spawn point, as the map lays it out. */
export interface SpawnOption {
  x: number;
  z: number;
  yaw: number;
}

/** Someone standing in the world, for the purposes of spawning. */
export interface SpawnBody {
  x: number;
  z: number;
}

export interface SpawnChoice {
  x: number;
  z: number;
  yaw: number;
}

export const SPAWN = {
  /** How much room a body needs at a point, in metres. */
  clearance: 1.6,
  /** How far to step aside when every point is taken, in metres. */
  sidestep: 1.5,
  /** How many directions to consider stepping aside in. */
  sidestepDirections: 12,
};

const distance = (ax: number, az: number, bx: number, bz: number): number =>
  Math.hypot(ax - bx, az - bz);

/** How many bodies are standing on a point, and how far the nearest one is. */
const crowding = (
  option: SpawnOption,
  bodies: readonly SpawnBody[],
): { count: number; nearest: number } => {
  let count = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (const body of bodies) {
    const gap = distance(option.x, option.z, body.x, body.z);
    nearest = Math.min(nearest, gap);
    if (gap < SPAWN.clearance) count += 1;
  }
  return { count, nearest };
};

/**
 * Pick where to arrive, in this order: not on top of anybody, then as far
 * from the enemy as the map allows.
 *
 * Arriving inside a team-mate is not a small thing. The camera ends up
 * inside their head, and the round opens on a wall of flat colour with the
 * level hidden behind it, which is exactly what it looks like from the
 * inside of a mesh. Enemy distance only breaks the tie between free points.
 *
 * When every point is taken — more players than the map has spawns — the
 * body steps aside rather than stacking, into open ground if `isOpen` is
 * given and says where that is.
 */
export const pickSpawn = (
  options: readonly SpawnOption[],
  bodies: readonly SpawnBody[],
  enemies: readonly SpawnBody[],
  isOpen?: (x: number, z: number) => boolean,
): SpawnChoice => {
  if (options.length === 0) {
    throw new Error("pickSpawn: the map has no spawn points for this team");
  }

  let best = options[0];
  let bestCount = Number.POSITIVE_INFINITY;
  let bestEnemy = -Infinity;
  for (const option of options) {
    const { count } = crowding(option, bodies);
    let enemy = Number.POSITIVE_INFINITY;
    for (const foe of enemies) {
      enemy = Math.min(enemy, distance(option.x, option.z, foe.x, foe.z));
    }
    // Fewest bodies wins outright; the enemy only breaks the tie.
    if (count < bestCount || (count === bestCount && enemy > bestEnemy)) {
      best = option;
      bestCount = count;
      bestEnemy = enemy;
    }
  }

  if (bestCount === 0) return { x: best.x, z: best.z, yaw: best.yaw };
  return { ...stepAside(best, bodies, isOpen), yaw: best.yaw };
};

/**
 * Move off an occupied point, into whichever direction has the most room.
 *
 * Open ground is a hard requirement where it is known: a metre and a half
 * of clearance is no use on the wrong side of a wall.
 */
const stepAside = (
  option: SpawnOption,
  bodies: readonly SpawnBody[],
  isOpen?: (x: number, z: number) => boolean,
): { x: number; z: number } => {
  let best = { x: option.x, z: option.z };
  let bestRoom = -Infinity;
  for (let i = 0; i < SPAWN.sidestepDirections; i += 1) {
    const angle = (i / SPAWN.sidestepDirections) * Math.PI * 2;
    const x = option.x + Math.sin(angle) * SPAWN.sidestep;
    const z = option.z + Math.cos(angle) * SPAWN.sidestep;
    if (isOpen && !isOpen(x, z)) continue;
    const { nearest } = crowding({ x, z, yaw: option.yaw }, bodies);
    if (nearest > bestRoom) {
      bestRoom = nearest;
      best = { x, z };
    }
  }
  return best;
};
