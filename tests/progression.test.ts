import { describe, expect, it } from "vitest";
import {
  AWARDS,
  MAX_LEVEL,
  WEAPON_UNLOCKS,
  addExperience,
  applyMatchResult,
  createProgression,
  isWeaponUnlocked,
  levelProgress,
  nextUnlock,
  rewardBreakdown,
  rewardTotal,
  unlockedWeapons,
  xpToNext,
  type MatchReward,
} from "../src/sim/progression";
import {
  DEFAULT_FINISH,
  FINISHES,
  finishById,
  finishRequirement,
  isFinishUnlocked,
  localEntitlements,
  unlockedFinishes,
} from "../src/sim/cosmetics";
import { DEFAULT_LOADOUT, WEAPONS } from "../src/sim/weapons";

const reward = (overrides: Partial<MatchReward> = {}): MatchReward => ({
  kills: 0,
  headshots: 0,
  deaths: 0,
  won: false,
  ownScore: 0,
  otherScore: 0,
  completed: true,
  ...overrides,
});

describe("experience curve", () => {
  it("starts at level one with nothing banked", () => {
    const state = createProgression();
    expect(state.level).toBe(1);
    expect(state.xp).toBe(0);
    expect(levelProgress(state)).toBe(0);
  });

  it("asks for more at every level", () => {
    for (let level = 1; level < 20; level += 1) {
      expect(xpToNext(level + 1)).toBeGreaterThan(xpToNext(level));
    }
  });

  it("banks experience toward the next level", () => {
    const state = createProgression();
    addExperience(state, 100);
    expect(state.level).toBe(1);
    expect(state.xp).toBe(100);
    expect(levelProgress(state)).toBeCloseTo(100 / xpToNext(1), 6);
  });

  it("levels up when the threshold is passed", () => {
    const state = createProgression();
    const result = addExperience(state, xpToNext(1) + 10);
    expect(result.gained).toBe(1);
    expect(state.level).toBe(2);
    expect(state.xp).toBe(10);
  });

  it("crosses several levels at once after a long round", () => {
    const state = createProgression();
    const result = addExperience(state, 100_000);
    expect(result.gained).toBeGreaterThan(3);
    expect(state.level).toBeGreaterThan(4);
  });

  it("stops at the top level rather than running away", () => {
    const state = createProgression();
    addExperience(state, 100_000_000);
    expect(state.level).toBe(MAX_LEVEL);
    expect(levelProgress(state)).toBe(1);
  });

  it("ignores nothing and negative awards", () => {
    const state = createProgression();
    expect(addExperience(state, 0).gained).toBe(0);
    expect(addExperience(state, -500).gained).toBe(0);
    expect(state.xp).toBe(0);
  });

  it("tracks lifetime experience separately from the banked amount", () => {
    const state = createProgression();
    addExperience(state, xpToNext(1) + 50);
    expect(state.lifetimeXp).toBe(xpToNext(1) + 50);
    expect(state.xp).toBe(50);
  });
});

describe("round rewards", () => {
  it("pays for kills and headshots", () => {
    const total = rewardTotal(reward({ kills: 3, headshots: 1 }));
    expect(total).toBe(3 * AWARDS.kill + AWARDS.headshotBonus + AWARDS.matchComplete);
  });

  it("pays a bonus for winning", () => {
    const won = rewardTotal(reward({ won: true }));
    const lost = rewardTotal(reward({ won: false }));
    expect(won - lost).toBe(AWARDS.win);
  });

  it("still pays for a close loss", () => {
    const close = rewardTotal(reward({ ownScore: 44, otherScore: 50 }));
    const blowout = rewardTotal(reward({ ownScore: 4, otherScore: 50 }));
    expect(close).toBeGreaterThan(blowout);
  });

  it("pays nothing for a round that was abandoned", () => {
    expect(rewardTotal(reward({ completed: false }))).toBe(0);
  });

  it("itemises what it paid for", () => {
    const lines = rewardBreakdown(reward({ kills: 2, won: true }));
    expect(lines.map((line) => line.label)).toContain("Kills");
    expect(lines.map((line) => line.label)).toContain("Victory");
    expect(lines.reduce((sum, line) => sum + line.xp, 0)).toBe(
      rewardTotal(reward({ kills: 2, won: true })),
    );
  });
});

describe("survival rewards", () => {
  it("pays per zombie and per wave held off", () => {
    const run = reward({ zombieKills: 12, wavesCleared: 2 });
    expect(rewardTotal(run)).toBe(
      12 * AWARDS.zombieKill + 2 * AWARDS.waveCleared + AWARDS.matchComplete,
    );
    const labels = rewardBreakdown(run).map((line) => line.label);
    expect(labels).toContain("Zombies");
    expect(labels).toContain("Waves cleared");
  });

  it("does not count zombies as kills of soldiers", () => {
    const state = createProgression();
    applyMatchResult(state, reward({ zombieKills: 30, wavesCleared: 3, deaths: 1 }));
    expect(state.kills).toBe(0);
    expect(state.matches).toBe(1);
    expect(state.wins).toBe(0);
  });
});

describe("applyMatchResult", () => {
  it("records the round in the lifetime statistics", () => {
    const state = createProgression();
    applyMatchResult(state, reward({ kills: 5, deaths: 3, headshots: 2, won: true }));
    expect(state.kills).toBe(5);
    expect(state.deaths).toBe(3);
    expect(state.headshots).toBe(2);
    expect(state.matches).toBe(1);
    expect(state.wins).toBe(1);
  });

  it("does not count an abandoned round as played", () => {
    const state = createProgression();
    applyMatchResult(state, reward({ completed: false, won: true }));
    expect(state.matches).toBe(0);
    expect(state.wins).toBe(0);
  });

  it("returns the experience it awarded and any level gained", () => {
    const state = createProgression();
    const result = applyMatchResult(state, reward({ kills: 10, won: true }));
    expect(result.xp).toBeGreaterThan(0);
    expect(result.levels.to).toBeGreaterThanOrEqual(result.levels.from);
  });
});

describe("weapon unlocks", () => {
  it("starts with the rifle and the sidearm only", () => {
    const state = createProgression();
    const carried = unlockedWeapons(state, DEFAULT_LOADOUT);
    expect(carried).toEqual(["ar", "pistol"]);
  });

  it("hands over the rest as the levels arrive", () => {
    const state = createProgression();
    state.level = WEAPON_UNLOCKS.smg;
    expect(isWeaponUnlocked(state, "smg")).toBe(true);
    expect(isWeaponUnlocked(state, "shotgun")).toBe(false);
    state.level = WEAPON_UNLOCKS.shotgun;
    expect(unlockedWeapons(state, DEFAULT_LOADOUT)).toHaveLength(4);
  });

  it("keeps the loadout in its usual order", () => {
    const state = createProgression();
    state.level = MAX_LEVEL;
    expect(unlockedWeapons(state, DEFAULT_LOADOUT)).toEqual([...DEFAULT_LOADOUT]);
  });

  it("names the next weapon still to come", () => {
    const state = createProgression();
    const upcoming = nextUnlock(state);
    expect(upcoming).not.toBeNull();
    expect(upcoming!.level).toBe(WEAPON_UNLOCKS.smg);
    expect(WEAPONS[upcoming!.weapon]).toBeDefined();
  });

  it("has nothing left to name once the rack is complete", () => {
    const state = createProgression();
    state.level = MAX_LEVEL;
    expect(nextUnlock(state)).toBeNull();
  });

  it("never gates a weapon behind the top level", () => {
    for (const level of Object.values(WEAPON_UNLOCKS)) {
      expect(level).toBeLessThan(MAX_LEVEL);
    }
  });
});

describe("cosmetics", () => {
  it("gives everyone the standard finish from the start", () => {
    const state = createProgression();
    expect(isFinishUnlocked(DEFAULT_FINISH, state)).toBe(true);
    expect(unlockedFinishes(state)).toHaveLength(1);
  });

  it("unlocks finishes as the level rises", () => {
    const state = createProgression();
    state.level = 7;
    const names = unlockedFinishes(state).map((finish) => finish.name);
    expect(names).toContain("Desert Sand");
    expect(names).toContain("Woodland");
    expect(names).not.toContain("Arctic");
  });

  it("keeps entitlement finishes locked without an entitlement", () => {
    const state = createProgression();
    state.level = MAX_LEVEL;
    const entitled = FINISHES.filter((finish) => finish.source.kind === "entitlement");
    expect(entitled.length).toBeGreaterThan(0);
    for (const finish of entitled) {
      expect(isFinishUnlocked(finish, state)).toBe(false);
    }
  });

  it("unlocks an entitlement finish once it is owned", () => {
    const state = createProgression();
    const entitled = FINISHES.find((finish) => finish.source.kind === "entitlement")!;
    state.owned.push(entitled.id);
    expect(isFinishUnlocked(entitled, state, localEntitlements(state))).toBe(true);
  });

  it("says what a locked finish needs", () => {
    const levelled = FINISHES.find((finish) => finish.source.kind === "level")!;
    expect(finishRequirement(levelled)).toMatch(/^Level \d+$/);
    expect(finishRequirement(DEFAULT_FINISH)).toBe("Available");
  });

  it("falls back to the standard finish for an unknown id", () => {
    expect(finishById("nonsense")).toBe(DEFAULT_FINISH);
    expect(finishById(undefined)).toBe(DEFAULT_FINISH);
  });

  it("changes nothing but colours", () => {
    // The whole cosmetic design rests on this: a finish carries three colours
    // and a name, and no field that could touch how a weapon performs.
    for (const finish of FINISHES) {
      expect(Object.keys(finish).sort()).toEqual(
        ["accent", "body", "id", "metal", "name", "source"],
      );
      for (const colour of [finish.body, finish.metal, finish.accent]) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("gives every finish a distinct id", () => {
    const ids = FINISHES.map((finish) => finish.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
