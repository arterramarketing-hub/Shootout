import { describe, expect, it } from "vitest";
import { DIFFICULTIES, createBot, damageBot, respawnBot } from "../src/sim/bots";
import { tickInterval } from "../src/sim/config";
import {
  HEALTH,
  applyDamage,
  createHealth,
  endSpawnProtection,
  grantSpawnProtection,
  isSpawnProtected,
  revive,
  stepHealth,
} from "../src/sim/health";
import { vec3 } from "../src/sim/vec3";

/** Run the clock forward the way the simulation does. */
const wait = (state: ReturnType<typeof createHealth>, seconds: number): void => {
  const steps = Math.round(seconds / tickInterval);
  for (let i = 0; i < steps; i += 1) stepHealth(state, tickInterval);
};

describe("the spawn window", () => {
  it("turns away damage for its whole length", () => {
    /*
     * A respawn puts someone back into a world that did not pause while they
     * were gone, at a fixed point an opponent may already be watching. Without
     * this the player who died is the player who keeps dying, and the fight is
     * decided by who happened to be looking at the spawn.
     */
    const health = createHealth();
    revive(health);

    expect(applyDamage(health, 90)).toBe(false);
    expect(health.current).toBe(HEALTH.max);

    wait(health, HEALTH.spawnProtection - 0.2);
    expect(applyDamage(health, 90)).toBe(false);
    expect(health.current).toBe(HEALTH.max);
  });

  it("ends on its own, and then damage lands normally", () => {
    const health = createHealth();
    revive(health);
    wait(health, HEALTH.spawnProtection + 0.1);

    expect(isSpawnProtected(health)).toBe(false);
    applyDamage(health, 40);
    expect(health.current).toBe(HEALTH.max - 40);
  });

  it("turns away everything rather than softening it", () => {
    // A window that only slows the kill still hands the fight to whoever was
    // already aiming at the spawn point.
    const health = createHealth();
    revive(health);
    for (let i = 0; i < 20; i += 1) applyDamage(health, 30);
    expect(health.current).toBe(HEALTH.max);
    expect(health.dead).toBe(false);
  });

  it("is given up by firing", () => {
    /*
     * Immunity that lets someone shoot is worse than no immunity: it turns the
     * safest moment in the round into the best time to attack, which is the
     * opposite of the point. It is for getting out of the spawn, not for
     * winning from inside it.
     */
    const health = createHealth();
    revive(health);
    expect(isSpawnProtected(health)).toBe(true);

    endSpawnProtection(health);
    expect(isSpawnProtected(health)).toBe(false);
    expect(applyDamage(health, 30)).toBe(false);
    expect(health.current).toBe(HEALTH.max - 30);
  });

  it("comes back on the next spawn, having been given up on the last one", () => {
    const health = createHealth();
    revive(health);
    endSpawnProtection(health);
    revive(health);
    expect(isSpawnProtected(health)).toBe(true);
  });

  it("is not granted merely by constructing a health state", () => {
    // Constructing one is not the same act as arriving in the world, and
    // starting every state immune would quietly make anything holding one —
    // a practice target, a bot, a test — briefly unkillable.
    const health = createHealth();
    expect(isSpawnProtected(health)).toBe(false);
    applyDamage(health, 25);
    expect(health.current).toBe(HEALTH.max - 25);
  });

  it("can be granted on its own, for a player joining a round in progress", () => {
    const health = createHealth();
    grantSpawnProtection(health);
    expect(isSpawnProtected(health)).toBe(true);
  });

  it("does not protect the dead", () => {
    const health = createHealth();
    revive(health);
    endSpawnProtection(health);
    applyDamage(health, HEALTH.max);
    expect(health.dead).toBe(true);

    grantSpawnProtection(health);
    expect(isSpawnProtected(health)).toBe(false);
  });
});

describe("bots do not get a spawn window", () => {
  /*
   * It exists to stop a person being farmed at a fixed point by another
   * person. Bots respawn constantly and are most of what anyone shoots at, so
   * giving them the same window means firing at one and watching nothing
   * happen, with no hit marker and nothing on screen to explain it.
   */
  const spawnBot = () =>
    createBot("b1", "Test", "a", DIFFICULTIES.regular, vec3(0, 0.9, 0), 0, ["ar"]);

  it("takes damage the instant it appears", () => {
    const bot = spawnBot();
    damageBot(bot, 30);
    expect(bot.health.current).toBe(HEALTH.max - 30);
  });

  it("takes damage the instant it respawns", () => {
    const bot = spawnBot();
    damageBot(bot, HEALTH.max);
    expect(bot.health.dead).toBe(true);

    respawnBot(bot, vec3(4, 0.9, 4), 0);
    expect(isSpawnProtected(bot.health)).toBe(false);
    damageBot(bot, 30);
    expect(bot.health.current).toBe(HEALTH.max - 30);
  });
});
