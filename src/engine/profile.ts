import {
  createProgression,
  MAX_LEVEL,
  type ProgressionState,
} from "../sim/progression";
import { FINISHES } from "../sim/cosmetics";

const STORAGE_KEY = "shootout.profile.v1";

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.round(Math.min(max, Math.max(min, parsed)));
};

/**
 * Read the saved profile.
 *
 * Storage can be empty, stale or throw outright in a private window, and a
 * levelling record is not worth losing a session over, so every field is
 * validated and anything unusable falls back to a fresh profile.
 */
export const loadProfile = (): ProgressionState => {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return createProgression();
  }
  if (!raw) return createProgression();

  try {
    const parsed = JSON.parse(raw) as Partial<ProgressionState>;
    const known = new Set(FINISHES.map((finish) => finish.id));
    const base = createProgression();
    return {
      level: clampInt(parsed.level, 1, MAX_LEVEL, base.level),
      xp: clampInt(parsed.xp, 0, 1_000_000, base.xp),
      lifetimeXp: clampInt(parsed.lifetimeXp, 0, 1_000_000_000, base.lifetimeXp),
      kills: clampInt(parsed.kills, 0, 10_000_000, base.kills),
      deaths: clampInt(parsed.deaths, 0, 10_000_000, base.deaths),
      headshots: clampInt(parsed.headshots, 0, 10_000_000, base.headshots),
      matches: clampInt(parsed.matches, 0, 1_000_000, base.matches),
      wins: clampInt(parsed.wins, 0, 1_000_000, base.wins),
      // Drop ids that no longer exist, so a removed finish cannot linger.
      owned: Array.isArray(parsed.owned)
        ? parsed.owned.filter((id): id is string => typeof id === "string" && known.has(id))
        : base.owned,
      equipped:
        parsed.equipped && typeof parsed.equipped === "object"
          ? Object.fromEntries(
              Object.entries(parsed.equipped).filter(
                ([, id]) => typeof id === "string" && known.has(id),
              ),
            )
          : base.equipped,
    };
  } catch {
    return createProgression();
  }
};

export const saveProfile = (state: ProgressionState): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or blocked store is not worth interrupting play for.
  }
};

export const clearProfile = (): void => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the caller resets the in-memory profile regardless.
  }
};
