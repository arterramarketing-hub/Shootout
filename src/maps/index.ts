import { greyboxMap } from "./greybox";
import { substationMap } from "./substation";
import type { MapDefinition } from "./types";

export const MAPS: Record<string, MapDefinition> = {
  warehouse: greyboxMap,
  substation: substationMap,
};

export const MAP_IDS = Object.keys(MAPS);

export const DEFAULT_MAP_ID = "warehouse";

/** Look a map up by id, falling back rather than failing on a stale setting. */
export const mapById = (id: string): MapDefinition => MAPS[id] ?? MAPS[DEFAULT_MAP_ID];
