import { boulevardMap } from "./boulevard";
import type { MapDefinition } from "./types";

/**
 * Every level the game ships.
 *
 * It was three for a while: a grey box to prove the systems on, a switchyard,
 * and the plant. The first two were scaffolding -- untextured volumes and a
 * layout built to exercise the nav bake -- and once there was a level built
 * to be played rather than to be tested against, keeping them meant three
 * levels the work had to be done three times for and two of them nobody
 * would choose. The lobby hides the picker while there is only one.
 */
export const MAPS: Record<string, MapDefinition> = {
  boulevard: boulevardMap,
};

export const MAP_IDS = Object.keys(MAPS);

export const DEFAULT_MAP_ID = "boulevard";

/** Look a map up by id, falling back rather than failing on a stale setting. */
export const mapById = (id: string): MapDefinition => MAPS[id] ?? MAPS[DEFAULT_MAP_ID];
