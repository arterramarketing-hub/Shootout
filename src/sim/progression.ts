import type { WeaponId } from "./weapons";

/**
 * Levelling, and what levelling gives you.
 *
 * Deliberately shallow and entirely cosmetic past the first few levels. The
 * two weapons gated behind early levels exist to give a new player one thing
 * at a time rather than four; everything after that is a finish, which changes
 * how a weapon looks and nothing about how it shoots. A shooter where the
 * player who has played longer also shoots harder is not one worth balancing.
 */

export const AWARDS = {
  kill: 100,
  headshotBonus: 50,
  /** Awarded to every player who saw a round out. */
  matchComplete: 150,
  win: 400,
  /** Per point of the losing team's score, so a close loss still pays. */
  perScore: 4,
} as const;

/** Experience needed to move from `level` to the next one. */
export const xpToNext = (level: number): number => 600 + Math.max(0, level - 1) * 220;

export const MAX_LEVEL = 30;

export interface ProgressionState {
  level: number;
  /** Experience banked toward the next level. */
  xp: number;
  lifetimeXp: number;
  kills: number;
  deaths: number;
  headshots: number;
  matches: number;
  wins: number;
  /** Cosmetic ids the player has claimed. */
  owned: string[];
  /** Finish equipped per weapon. */
  equipped: Partial<Record<WeaponId, string>>;
}

export const createProgression = (): ProgressionState => ({
  level: 1,
  xp: 0,
  lifetimeXp: 0,
  kills: 0,
  deaths: 0,
  headshots: 0,
  matches: 0,
  wins: 0,
  owned: [],
  equipped: {},
});

export interface MatchReward {
  kills: number;
  headshots: number;
  deaths: number;
  won: boolean;
  /** This player's team's score, and the other side's. */
  ownScore: number;
  otherScore: number;
  /** False when the round was abandoned rather than played out. */
  completed: boolean;
}

/** Experience a finished round is worth, itemised so it can be shown. */
export const rewardBreakdown = (
  reward: MatchReward,
): { label: string; xp: number }[] => {
  const lines: { label: string; xp: number }[] = [];
  if (reward.kills > 0) lines.push({ label: "Kills", xp: reward.kills * AWARDS.kill });
  if (reward.headshots > 0) {
    lines.push({ label: "Headshots", xp: reward.headshots * AWARDS.headshotBonus });
  }
  if (reward.completed) lines.push({ label: "Round played", xp: AWARDS.matchComplete });
  if (reward.won) lines.push({ label: "Victory", xp: AWARDS.win });
  const contested = Math.min(reward.ownScore, reward.otherScore) * AWARDS.perScore;
  if (contested > 0) lines.push({ label: "Contested", xp: contested });
  return lines;
};

export const rewardTotal = (reward: MatchReward): number =>
  rewardBreakdown(reward).reduce((total, line) => total + line.xp, 0);

export interface LevelUpResult {
  /** Levels gained, which may be more than one after a long round. */
  gained: number;
  from: number;
  to: number;
}

/** Bank experience, rolling over into levels. Mutates and returns the state. */
export const addExperience = (
  state: ProgressionState,
  amount: number,
): LevelUpResult => {
  const from = state.level;
  if (amount <= 0) return { gained: 0, from, to: from };

  state.xp += amount;
  state.lifetimeXp += amount;
  // A long round can cross several levels at once, so this loops rather than
  // checking a single threshold.
  while (state.level < MAX_LEVEL && state.xp >= xpToNext(state.level)) {
    state.xp -= xpToNext(state.level);
    state.level += 1;
  }
  if (state.level >= MAX_LEVEL) {
    state.level = MAX_LEVEL;
    state.xp = Math.min(state.xp, xpToNext(MAX_LEVEL));
  }
  return { gained: state.level - from, from, to: state.level };
};

/** Apply one round's result: statistics first, then the experience it earned. */
export const applyMatchResult = (
  state: ProgressionState,
  reward: MatchReward,
): { xp: number; levels: LevelUpResult } => {
  state.kills += reward.kills;
  state.deaths += reward.deaths;
  state.headshots += reward.headshots;
  if (reward.completed) {
    state.matches += 1;
    if (reward.won) state.wins += 1;
  }
  const xp = rewardTotal(reward);
  return { xp, levels: addExperience(state, xp) };
};

/** Fraction of the way to the next level, for a progress bar. */
export const levelProgress = (state: ProgressionState): number => {
  if (state.level >= MAX_LEVEL) return 1;
  return Math.max(0, Math.min(1, state.xp / xpToNext(state.level)));
};

// --- Weapon unlocks ---------------------------------------------------------

/** The level each weapon becomes available at. */
export const WEAPON_UNLOCKS: Record<WeaponId, number> = {
  ar: 1,
  pistol: 1,
  smg: 3,
  shotgun: 6,
};

export const isWeaponUnlocked = (state: ProgressionState, id: WeaponId): boolean =>
  state.level >= WEAPON_UNLOCKS[id];

/** The weapons a player may carry, in their usual order. */
export const unlockedWeapons = (
  state: ProgressionState,
  order: readonly WeaponId[],
): WeaponId[] => order.filter((id) => isWeaponUnlocked(state, id));

/** What the next level hands over, if anything. */
export const nextUnlock = (
  state: ProgressionState,
): { level: number; weapon: WeaponId } | null => {
  let best: { level: number; weapon: WeaponId } | null = null;
  for (const [id, level] of Object.entries(WEAPON_UNLOCKS) as [WeaponId, number][]) {
    if (level <= state.level) continue;
    if (!best || level < best.level) best = { level, weapon: id };
  }
  return best;
};
