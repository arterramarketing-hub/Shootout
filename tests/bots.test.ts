import { describe, expect, it } from "vitest";
import {
  BOT,
  DIFFICULTIES,
  botAsCombatant,
  botCentre,
  botEye,
  createBot,
  damageBot,
  respawnBot,
  stepBot,
  turnToward,
  type BotShot,
  type BotState,
  type Combatant,
} from "../src/sim/bots";
import type { HitscanWorld, RayHit } from "../src/sim/combat";
import { tickInterval } from "../src/sim/config";
import { addNode, createEmptyGrid, linkNodes, type NavGrid } from "../src/sim/nav";
import { createRandom } from "../src/sim/random";
import { vec3, type Vec3 } from "../src/sim/vec3";

const openGrid = (size = 24): NavGrid => {
  const grid = createEmptyGrid(1, -size / 2, -size / 2, size, size);
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) addNode(grid, col, row, 0);
  }
  linkNodes(grid);
  return grid;
};

/** Nothing blocks anything. */
class OpenWorld implements HitscanWorld {
  raycast(): RayHit | null {
    return null;
  }
}

/** Everything is blocked two metres out. */
class WalledWorld implements HitscanWorld {
  raycast(origin: Vec3, direction: Vec3): RayHit | null {
    return {
      distance: 2,
      point: vec3(origin.x + direction.x * 2, origin.y + direction.y * 2, origin.z + direction.z * 2),
      normal: vec3(0, 1, 0),
      targetId: null,
      headshot: false,
    };
  }
}

const makeBot = (overrides: Partial<Parameters<typeof createBot>> = []): BotState =>
  createBot(
    "bot_0",
    "Mercer",
    "a",
    DIFFICULTIES.regular,
    vec3(0, 0, 0),
    0,
    ["ar"],
    ...(overrides as []),
  );

const enemy = (position: Vec3, id = "enemy"): Combatant => ({
  id,
  team: "b",
  eye: vec3(position.x, position.y + BOT.eyeHeight, position.z),
  centre: vec3(position.x, position.y + BOT.centreHeight, position.z),
  alive: true,
  velocity: vec3(),
});

const run = (
  bot: BotState,
  world: { grid: NavGrid; hitscan: HitscanWorld; combatants: Combatant[] },
  seconds: number,
): BotShot[] => {
  const shots: BotShot[] = [];
  const full = { ...world, random: createRandom(7) };
  const steps = Math.round(seconds / tickInterval);
  for (let i = 0; i < steps; i += 1) {
    stepBot(bot, full, tickInterval, (shot) => shots.push(shot));
  }
  return shots;
};

describe("turnToward", () => {
  it("reaches the target when it is within range", () => {
    expect(turnToward(0, 0.1, 0.5)).toBeCloseTo(0.1, 6);
  });

  it("takes the short way round the circle", () => {
    // From just under a half turn to just over should go forward, not back.
    const result = turnToward(3.0, -3.0, 0.1);
    expect(result).toBeGreaterThan(3.0);
  });

  it("never overshoots its rate limit", () => {
    expect(Math.abs(turnToward(0, 2, 0.25) - 0)).toBeCloseTo(0.25, 6);
  });
});

describe("bot geometry", () => {
  it("puts the eye above the centre of mass", () => {
    const bot = makeBot();
    expect(botEye(bot).y).toBeGreaterThan(botCentre(bot).y);
  });

  it("reports itself as a combatant on its own team", () => {
    const combatant = botAsCombatant(makeBot());
    expect(combatant.team).toBe("a");
    expect(combatant.alive).toBe(true);
  });
});

describe("difficulty tiers", () => {
  it("gets faster and more accurate as it goes up", () => {
    const { recruit, regular, veteran } = DIFFICULTIES;
    expect(recruit.reactionTime).toBeGreaterThan(regular.reactionTime);
    expect(regular.reactionTime).toBeGreaterThan(veteran.reactionTime);
    expect(recruit.aimError).toBeGreaterThan(veteran.aimError);
    expect(veteran.turnRate).toBeGreaterThan(recruit.turnRate);
  });

  it("keeps every reaction time inside the stated band", () => {
    for (const tier of Object.values(DIFFICULTIES)) {
      expect(tier.reactionTime).toBeGreaterThanOrEqual(0.25);
      expect(tier.reactionTime).toBeLessThanOrEqual(0.8);
    }
  });
});

describe("patrol", () => {
  it("moves when left alone with somewhere to go", () => {
    const bot = makeBot();
    const start = { ...bot.position };
    run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [] }, 2);
    expect(Math.hypot(bot.position.x - start.x, bot.position.z - start.z)).toBeGreaterThan(0.5);
    expect(bot.behaviour).toBe("patrol");
  });

  it("stays on the navigation surface", () => {
    const bot = makeBot();
    bot.position.y = 6;
    run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [] }, 2);
    expect(bot.position.y).toBeCloseTo(0, 1);
  });
});

describe("perception", () => {
  it("engages an enemy it can see", () => {
    const bot = makeBot();
    const target = enemy(vec3(0, 0, 10));
    run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] }, 1);
    expect(bot.targetId).toBe("enemy");
    expect(bot.behaviour).toBe("engage");
  });

  it("ignores an enemy behind a wall", () => {
    const bot = makeBot();
    const target = enemy(vec3(0, 0, 10));
    run(bot, { grid: openGrid(), hitscan: new WalledWorld(), combatants: [target] }, 1);
    expect(bot.targetId).toBeNull();
  });

  it("ignores an enemy outside its vision cone", () => {
    const bot = makeBot();
    // Directly behind, which is well outside the cone.
    const target = enemy(vec3(0, 0, -12));
    run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] }, 0.3);
    expect(bot.targetId).toBeNull();
  });

  it("ignores an enemy beyond its view distance", () => {
    const bot = makeBot();
    const far = DIFFICULTIES.regular.viewDistance + 20;
    const target = enemy(vec3(0, 0, far));
    run(bot, { grid: openGrid(120), hitscan: new OpenWorld(), combatants: [target] }, 0.3);
    expect(bot.targetId).toBeNull();
  });

  it("never targets its own team", () => {
    const bot = makeBot();
    const friend: Combatant = { ...enemy(vec3(0, 0, 8), "friend"), team: "a" };
    run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [friend] }, 1);
    expect(bot.targetId).toBeNull();
  });

  it("ignores the dead", () => {
    const bot = makeBot();
    const target = { ...enemy(vec3(0, 0, 8)), alive: false };
    run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] }, 1);
    expect(bot.targetId).toBeNull();
  });

  it("hunts the last known position after losing sight", () => {
    const bot = makeBot();
    const target = enemy(vec3(0, 0, 10));
    const world = { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] };
    run(bot, world, 1);
    expect(bot.lastKnownPosition).not.toBeNull();

    target.alive = false;
    run(bot, world, 0.5);
    expect(bot.behaviour).toBe("investigate");
  });

  it("forgets once its memory runs out", () => {
    const bot = makeBot();
    const target = enemy(vec3(0, 0, 10));
    const world = { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] };
    run(bot, world, 1);
    target.alive = false;
    run(bot, world, DIFFICULTIES.regular.memoryTime + 0.5);
    expect(bot.lastKnownPosition).toBeNull();
    expect(bot.behaviour).toBe("patrol");
  });
});

describe("firing", () => {
  it("holds fire until its reaction time has passed", () => {
    const bot = makeBot();
    const target = enemy(vec3(0, 0, 9));
    const world = { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] };
    // Well inside the reaction delay, nothing should have been fired.
    const early = run(bot, world, DIFFICULTIES.regular.reactionTime * 0.5);
    expect(early).toHaveLength(0);
  });

  it("opens fire once it is on target", () => {
    const bot = makeBot();
    const target = enemy(vec3(0, 0, 9));
    const world = { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] };
    const shots = run(bot, world, 3);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0].botId).toBe("bot_0");
  });

  it("obeys the same magazine limit the player does", () => {
    const bot = makeBot();
    const target = enemy(vec3(0, 0, 9));
    const world = { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] };
    const shots = run(bot, world, 2.5);
    // A rifle magazine is thirty rounds, and it cannot exceed that before
    // the first reload completes.
    expect(shots.length).toBeLessThanOrEqual(30);
  });

  it("never fires at nothing", () => {
    const bot = makeBot();
    expect(run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [] }, 3))
      .toHaveLength(0);
  });

  it("a recruit is slower to shoot than a veteran", () => {
    const slow = createBot("s", "Slow", "a", DIFFICULTIES.recruit, vec3(0, 0, 0), 0, ["ar"]);
    const fast = createBot("f", "Fast", "a", DIFFICULTIES.veteran, vec3(0, 0, 0), 0, ["ar"]);
    const target = enemy(vec3(0, 0, 9));
    const world = { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] };
    const slowShots = run(slow, world, 1.2);
    const fastShots = run(fast, world, 1.2);
    expect(fastShots.length).toBeGreaterThan(slowShots.length);
  });
});

describe("damage and respawn", () => {
  it("dies when its health runs out", () => {
    const bot = makeBot();
    expect(damageBot(bot, 40)).toBe(false);
    expect(damageBot(bot, 200)).toBe(true);
    expect(bot.health.dead).toBe(true);
  });

  it("stops acting once dead", () => {
    const bot = makeBot();
    damageBot(bot, 200);
    const target = enemy(vec3(0, 0, 9));
    const shots = run(bot, { grid: openGrid(), hitscan: new OpenWorld(), combatants: [target] }, 3);
    expect(shots).toHaveLength(0);
    expect(bot.behaviour).toBe("dead");
  });

  it("comes back whole, rearmed and unaware", () => {
    const bot = makeBot();
    bot.targetId = "enemy";
    damageBot(bot, 200);
    respawnBot(bot, vec3(5, 0, 5), 1.2);
    expect(bot.health.dead).toBe(false);
    expect(bot.health.current).toBe(100);
    expect(bot.position).toEqual({ x: 5, y: 0, z: 5 });
    expect(bot.targetId).toBeNull();
    expect(bot.behaviour).toBe("patrol");
    expect(bot.loadout.weapons[0].magazine).toBe(
      bot.loadout.weapons[0].definition.magazineSize,
    );
  });
});
