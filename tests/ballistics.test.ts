import { describe, expect, it } from "vitest";
import {
  addBloom,
  currentSpread,
  damageAt,
  falloffMultiplier,
  recoilForShot,
  recoverBloom,
  recoverRecoil,
  samplePellet,
  samplePellets,
  shotsToKill,
  timeToKill,
  type ShooterContext,
} from "../src/sim/ballistics";
import { createRandom } from "../src/sim/random";
import { WEAPONS } from "../src/sim/weapons";

const still: ShooterContext = { speed: 0, grounded: true, crouchAmount: 0, adsProgress: 0 };

describe("falloffMultiplier", () => {
  const falloff = { nearRange: 10, farRange: 30, farMultiplier: 0.5 };

  it("is full inside the near range", () => {
    expect(falloffMultiplier(falloff, 0)).toBe(1);
    expect(falloffMultiplier(falloff, 10)).toBe(1);
  });

  it("is flat at the floor beyond the far range", () => {
    expect(falloffMultiplier(falloff, 30)).toBe(0.5);
    expect(falloffMultiplier(falloff, 500)).toBe(0.5);
  });

  it("interpolates linearly between them", () => {
    expect(falloffMultiplier(falloff, 20)).toBeCloseTo(0.75, 6);
  });

  it("never increases with distance", () => {
    let previous = Infinity;
    for (let d = 0; d <= 60; d += 1) {
      const value = falloffMultiplier(falloff, d);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      previous = value;
    }
  });
});

describe("damageAt", () => {
  it("applies the headshot multiplier", () => {
    const weapon = WEAPONS.ar;
    expect(damageAt(weapon, 0, true)).toBeCloseTo(
      damageAt(weapon, 0, false) * weapon.headshotMultiplier,
      6,
    );
  });

  it("falls off with range", () => {
    const weapon = WEAPONS.smg;
    expect(damageAt(weapon, 40, false)).toBeLessThan(damageAt(weapon, 0, false));
  });
});

describe("weapon design invariants", () => {
  const health = 100;

  it("every weapon kills in three body shots or fewer at point blank", () => {
    for (const weapon of Object.values(WEAPONS)) {
      expect(shotsToKill(weapon, health)).toBeLessThanOrEqual(3);
    }
  });

  it("every weapon kills with a single headshot at point blank", () => {
    for (const weapon of Object.values(WEAPONS)) {
      const perShot = damageAt(weapon, 0, true) * weapon.pelletsPerShot;
      expect(perShot).toBeGreaterThanOrEqual(health);
    }
  });

  it("every time to kill lands between 100 and 300 milliseconds", () => {
    for (const weapon of Object.values(WEAPONS)) {
      const ttk = timeToKill(weapon, health);
      expect(ttk).toBeLessThanOrEqual(0.3);
      // The shotgun kills in one shot, so its time to kill is zero.
      if (weapon.pelletsPerShot === 1) expect(ttk).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("the shotgun one-shots up close and cannot at range", () => {
    const weapon = WEAPONS.shotgun;
    expect(damageAt(weapon, 0, false) * weapon.pelletsPerShot).toBeGreaterThanOrEqual(health);
    expect(damageAt(weapon, 25, false) * weapon.pelletsPerShot).toBeLessThan(health);
  });

  it("the submachine gun needs more shots at range than up close", () => {
    const weapon = WEAPONS.smg;
    expect(shotsToKill(weapon, health, 40)).toBeGreaterThan(shotsToKill(weapon, health, 0));
  });

  it("aiming is always at least as accurate as firing from the hip", () => {
    for (const weapon of Object.values(WEAPONS)) {
      expect(weapon.spread.adsBase).toBeLessThanOrEqual(weapon.spread.hipBase);
    }
  });

  it("every magazine and reserve is positive", () => {
    for (const weapon of Object.values(WEAPONS)) {
      expect(weapon.magazineSize).toBeGreaterThan(0);
      expect(weapon.reserveAmmo).toBeGreaterThan(0);
      expect(weapon.roundsPerMinute).toBeGreaterThan(0);
    }
  });
});

describe("currentSpread", () => {
  const profile = WEAPONS.ar.spread;

  it("is the base cone when standing still", () => {
    expect(currentSpread(profile, 0, still)).toBeCloseTo(profile.hipBase, 6);
  });

  it("narrows toward the aimed cone as the sights come up", () => {
    const aimed = currentSpread(profile, 0, { ...still, adsProgress: 1 });
    const half = currentSpread(profile, 0, { ...still, adsProgress: 0.5 });
    expect(aimed).toBeCloseTo(profile.adsBase, 6);
    expect(half).toBeGreaterThan(aimed);
    expect(half).toBeLessThan(profile.hipBase);
  });

  it("widens with movement", () => {
    expect(currentSpread(profile, 0, { ...still, speed: 4 })).toBeGreaterThan(
      currentSpread(profile, 0, still),
    );
  });

  it("widens sharply in the air", () => {
    expect(currentSpread(profile, 0, { ...still, grounded: false })).toBeGreaterThan(
      currentSpread(profile, 0, still) * 2,
    );
  });

  it("rewards crouching only when planted", () => {
    const planted = currentSpread(profile, 0, { ...still, crouchAmount: 1 });
    const walking = currentSpread(profile, 0, { ...still, crouchAmount: 1, speed: 1.8 });
    expect(planted).toBeLessThan(currentSpread(profile, 0, still));
    // Crouch-walking keeps most of the movement penalty.
    expect(walking).toBeGreaterThan(planted);
  });

  it("widens with accumulated bloom", () => {
    expect(currentSpread(profile, 1.5, still)).toBeCloseTo(profile.hipBase + 1.5, 6);
  });

  it("is never negative", () => {
    expect(currentSpread(profile, 0, { ...still, adsProgress: 1 })).toBeGreaterThanOrEqual(0);
  });
});

describe("bloom", () => {
  const profile = WEAPONS.ar.spread;

  it("grows per shot and stops at the cap", () => {
    let bloom = 0;
    for (let i = 0; i < 200; i += 1) bloom = addBloom(bloom, profile);
    expect(bloom).toBe(profile.max);
  });

  it("recovers toward zero and never below it", () => {
    expect(recoverBloom(0.5, profile, 10)).toBe(0);
    expect(recoverBloom(1, profile, 0.1)).toBeCloseTo(1 - profile.recovery * 0.1, 6);
  });
});

describe("recoilForShot", () => {
  const profile = WEAPONS.ar.recoil;

  it("always kicks upward", () => {
    for (let i = 0; i < profile.pattern.length; i += 1) {
      expect(recoilForShot(profile, i, 0).pitch).toBeGreaterThan(0);
    }
  });

  it("repeats the last entry once the pattern runs out", () => {
    const last = recoilForShot(profile, profile.pattern.length - 1, 0);
    const beyond = recoilForShot(profile, profile.pattern.length + 50, 0);
    expect(beyond.pitch).toBeCloseTo(last.pitch, 9);
    expect(beyond.yaw).toBeCloseTo(last.yaw, 9);
  });

  it("kicks less while aimed", () => {
    expect(recoilForShot(profile, 0, 1).pitch).toBeLessThan(recoilForShot(profile, 0, 0).pitch);
  });

  it("is the same every time, so it can be learned", () => {
    expect(recoilForShot(profile, 4, 0)).toEqual(recoilForShot(profile, 4, 0));
  });
});

describe("recoverRecoil", () => {
  it("decays toward zero", () => {
    const profile = WEAPONS.ar.recoil;
    expect(Math.abs(recoverRecoil(1, profile, 1))).toBeLessThan(0.1);
    expect(recoverRecoil(1, profile, 0)).toBeCloseTo(1, 9);
  });

  it("keeps the sign of the accumulated kick", () => {
    const profile = WEAPONS.ar.recoil;
    expect(recoverRecoil(-0.5, profile, 0.1)).toBeLessThan(0);
  });
});

describe("samplePellet", () => {
  it("is dead centre with no spread", () => {
    expect(samplePellet(0, createRandom(1))).toEqual({ yaw: 0, pitch: 0 });
  });

  it("stays inside the cone", () => {
    const random = createRandom(7);
    const limit = Math.tan((3 * Math.PI) / 180);
    for (let i = 0; i < 500; i += 1) {
      const offset = samplePellet(3, random);
      expect(Math.hypot(offset.yaw, offset.pitch)).toBeLessThanOrEqual(limit + 1e-9);
    }
  });

  it("spreads evenly across the disc rather than bunching in the middle", () => {
    const random = createRandom(11);
    const limit = Math.tan((4 * Math.PI) / 180);
    let inner = 0;
    const samples = 4000;
    for (let i = 0; i < samples; i += 1) {
      const offset = samplePellet(4, random);
      // Half the radius encloses a quarter of the area, so about a quarter
      // of a uniform scatter should land inside it.
      if (Math.hypot(offset.yaw, offset.pitch) < limit / 2) inner += 1;
    }
    expect(inner / samples).toBeGreaterThan(0.2);
    expect(inner / samples).toBeLessThan(0.3);
  });

  it("is reproducible from a seed", () => {
    const a = samplePellet(3, createRandom(42));
    const b = samplePellet(3, createRandom(42));
    expect(a).toEqual(b);
  });
});

describe("samplePellets", () => {
  it("produces one direction per pellet", () => {
    expect(samplePellets(WEAPONS.shotgun, 4, createRandom(3))).toHaveLength(
      WEAPONS.shotgun.pelletsPerShot,
    );
    expect(samplePellets(WEAPONS.ar, 2, createRandom(3))).toHaveLength(1);
  });

  it("scatters the shotgun rather than stacking every pellet", () => {
    const pellets = samplePellets(WEAPONS.shotgun, 4.6, createRandom(5));
    const unique = new Set(pellets.map((p) => `${p.yaw.toFixed(6)}:${p.pitch.toFixed(6)}`));
    expect(unique.size).toBe(pellets.length);
  });
});
