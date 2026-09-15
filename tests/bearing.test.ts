import { describe, expect, it } from "vitest";
import { aimForward, bearingTo } from "../src/sim/aim";
import { applyDamage, createHealth, revive } from "../src/sim/health";
import { vec3 } from "../src/sim/vec3";

/**
 * A damage indicator is only useful if turning to the angle it reports puts
 * the attacker in front of you. That makes `bearingTo` the load-bearing piece,
 * and it is worth pinning against the yaw convention rather than assumed: the
 * field it feeds used to be filled with the attacker's own facing, which is a
 * different number that happens to look right in a head-on duel.
 */
describe("bearingTo", () => {
  const origin = vec3(0, 1.6, 0);

  it("reports zero for something straight ahead down +Z", () => {
    expect(bearingTo(origin, vec3(0, 1.6, 10))).toBeCloseTo(0, 6);
  });

  it("reports a quarter turn for something to the right", () => {
    expect(bearingTo(origin, vec3(10, 1.6, 0))).toBeCloseTo(Math.PI / 2, 6);
  });

  it("reports a negative quarter turn for something to the left", () => {
    expect(bearingTo(origin, vec3(-10, 1.6, 0))).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("reports half a turn for something directly behind", () => {
    expect(Math.abs(bearingTo(origin, vec3(0, 1.6, -10)))).toBeCloseTo(Math.PI, 6);
  });

  it("ignores height, so someone on a mezzanine still reads as their bearing", () => {
    const low = bearingTo(origin, vec3(6, 1.6, 6));
    const high = bearingTo(origin, vec3(6, 9.4, 6));
    expect(high).toBeCloseTo(low, 6);
  });

  it("points where the game actually looks when you turn to it", () => {
    // Turning to the reported bearing must put the attacker down the forward
    // axis. This is the property the indicator promises the player.
    for (const target of [vec3(7, 1.6, 3), vec3(-4, 1.6, -9), vec3(-8, 1.6, 2)]) {
      const bearing = bearingTo(origin, target);
      const forward = aimForward(bearing, 0);
      const dx = target.x - origin.x;
      const dz = target.z - origin.z;
      const length = Math.hypot(dx, dz);
      expect(forward.x).toBeCloseTo(dx / length, 6);
      expect(forward.z).toBeCloseTo(dz / length, 6);
    }
  });

  it("is not the attacker's facing", () => {
    /*
     * The bug this replaced. An attacker running past and shooting sideways
     * faces one way while sitting somewhere else entirely; an indicator built
     * from their facing sends the victim to look at empty floor.
     */
    const attackerPosition = vec3(0, 1.6, -10); // directly behind the victim
    const attackerFacing = Math.PI / 2; // but looking east as they run
    const bearing = bearingTo(origin, attackerPosition);
    expect(Math.abs(bearing)).toBeCloseTo(Math.PI, 6);
    expect(Math.abs(bearing - attackerFacing)).toBeGreaterThan(1);
  });
});

describe("health remembers where damage came from", () => {
  it("keeps the bearing of the last hit", () => {
    const health = createHealth();
    applyDamage(health, 20, 1.25);
    expect(health.lastDamageBearing).toBe(1.25);
  });

  it("forgets it on respawn, so a fresh life starts with a clean screen", () => {
    const health = createHealth();
    applyDamage(health, 20, 1.25);
    revive(health);
    expect(health.lastDamageBearing).toBeNull();
  });

  it("takes the newest source when two attackers land in the same moment", () => {
    const health = createHealth();
    applyDamage(health, 10, 0.5);
    applyDamage(health, 10, -2.0);
    expect(health.lastDamageBearing).toBe(-2.0);
  });
});
