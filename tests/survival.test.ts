import { describe, expect, it } from "vitest";
import { HEALTH, applyDamage, createHealth, revive, stepHealth } from "../src/sim/health";
import { TARGET, createTarget, damageTarget, stepTarget } from "../src/sim/targets";

describe("health", () => {
  it("starts full and alive", () => {
    const health = createHealth();
    expect(health.current).toBe(HEALTH.max);
    expect(health.dead).toBe(false);
  });

  it("subtracts damage", () => {
    const health = createHealth();
    applyDamage(health, 30);
    expect(health.current).toBe(70);
  });

  it("dies at zero and reports the killing blow", () => {
    const health = createHealth();
    expect(applyDamage(health, 40)).toBe(false);
    expect(applyDamage(health, 200)).toBe(true);
    expect(health.current).toBe(0);
    expect(health.dead).toBe(true);
  });

  it("takes no further damage once dead", () => {
    const health = createHealth();
    applyDamage(health, 200);
    expect(applyDamage(health, 50)).toBe(false);
  });

  it("holds regeneration for the full delay", () => {
    const health = createHealth();
    applyDamage(health, 40);
    stepHealth(health, HEALTH.regenDelay - 0.1);
    expect(health.current).toBe(60);
  });

  it("regenerates at the stated rate after the delay", () => {
    const health = createHealth();
    applyDamage(health, 40);
    stepHealth(health, HEALTH.regenDelay);
    stepHealth(health, 1);
    expect(health.current).toBeCloseTo(60 + HEALTH.regenRate, 5);
  });

  it("never regenerates past full", () => {
    const health = createHealth();
    applyDamage(health, 10);
    stepHealth(health, HEALTH.regenDelay);
    stepHealth(health, 100);
    expect(health.current).toBe(HEALTH.max);
  });

  it("restarts the delay on each new hit", () => {
    const health = createHealth();
    applyDamage(health, 20);
    stepHealth(health, HEALTH.regenDelay - 0.2);
    applyDamage(health, 20);
    stepHealth(health, HEALTH.regenDelay - 0.2);
    expect(health.current).toBe(60);
  });

  it("records where the damage came from", () => {
    const health = createHealth();
    applyDamage(health, 10, 1.5);
    expect(health.lastDamageBearing).toBe(1.5);
  });

  it("does not regenerate the dead", () => {
    const health = createHealth();
    applyDamage(health, 200);
    stepHealth(health, 100);
    expect(health.current).toBe(0);
  });

  it("comes back whole on revive", () => {
    const health = createHealth();
    applyDamage(health, 200);
    revive(health);
    expect(health.current).toBe(HEALTH.max);
    expect(health.dead).toBe(false);
  });
});

describe("targets", () => {
  it("starts upright at full health", () => {
    const target = createTarget("t1");
    expect(target.down).toBe(false);
    expect(target.health).toBe(TARGET.health);
    expect(target.knockdown).toBe(0);
  });

  it("takes damage without going down", () => {
    const target = createTarget("t1");
    expect(damageTarget(target, 40, false)).toBe(false);
    expect(target.health).toBe(60);
    expect(target.flash).toBe(1);
  });

  it("goes down when its health runs out", () => {
    const target = createTarget("t1");
    expect(damageTarget(target, 150, false)).toBe(true);
    expect(target.down).toBe(true);
    expect(target.justDropped).toBe(true);
    expect(target.health).toBe(0);
  });

  it("ignores further hits while down", () => {
    const target = createTarget("t1");
    damageTarget(target, 150, false);
    expect(damageTarget(target, 50, false)).toBe(false);
  });

  it("remembers whether the last hit was a headshot", () => {
    const target = createTarget("t1");
    damageTarget(target, 150, true);
    expect(target.lastHitHeadshot).toBe(true);
  });

  it("folds flat, waits, then stands back up at full health", () => {
    const target = createTarget("t1");
    damageTarget(target, 150, false);
    stepTarget(target, TARGET.knockdownTime);
    expect(target.knockdown).toBeCloseTo(1, 5);
    expect(target.down).toBe(true);

    stepTarget(target, TARGET.resetDelay);
    expect(target.down).toBe(false);
    expect(target.health).toBe(TARGET.health);

    stepTarget(target, TARGET.resetTime);
    expect(target.knockdown).toBeCloseTo(0, 5);
  });

  it("clears the justDropped flag after one step", () => {
    const target = createTarget("t1");
    damageTarget(target, 150, false);
    stepTarget(target, 0.016);
    expect(target.justDropped).toBe(false);
  });

  it("fades the hit flash out", () => {
    const target = createTarget("t1");
    damageTarget(target, 10, false);
    stepTarget(target, TARGET.flashTime);
    expect(target.flash).toBeCloseTo(0, 5);
  });

  it("ignores zero and negative damage", () => {
    const target = createTarget("t1");
    expect(damageTarget(target, 0, false)).toBe(false);
    expect(target.health).toBe(TARGET.health);
  });
});
