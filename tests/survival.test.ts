import { describe, expect, it } from "vitest";
import { HEALTH, applyDamage, createHealth, revive, stepHealth } from "../src/sim/health";

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
