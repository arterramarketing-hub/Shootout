import { describe, expect, it } from "vitest";
import { tickInterval } from "../src/sim/config";
import {
  activeWeapon,
  canFire,
  createLoadout,
  isSwapping,
  needsReload,
  stepLoadout,
  type LoadoutContext,
  type LoadoutInput,
  type LoadoutState,
  type ShotEvent,
} from "../src/sim/loadout";
import { createRandom } from "../src/sim/random";

const context = (overrides: Partial<LoadoutContext> = {}): LoadoutContext => ({
  speed: 0,
  grounded: true,
  crouchAmount: 0,
  sprintOutTimer: 0,
  yaw: 0,
  pitch: 0,
  ...overrides,
});

const input = (overrides: Partial<LoadoutInput> = {}): LoadoutInput => ({
  fire: false,
  aim: false,
  reloadPressed: false,
  swapPressed: false,
  ...overrides,
});

/** Run for `seconds`, collecting every shot fired. */
const run = (
  loadout: LoadoutState,
  frame: LoadoutInput,
  seconds: number,
  ctx = context(),
): ShotEvent[] => {
  const random = createRandom(99);
  const shots: ShotEvent[] = [];
  const steps = Math.round(seconds / tickInterval);
  for (let i = 0; i < steps; i += 1) {
    const shot = stepLoadout(loadout, frame, ctx, tickInterval, random);
    if (shot) shots.push(shot);
  }
  return shots;
};

describe("createLoadout", () => {
  it("starts with four loaded weapons", () => {
    const loadout = createLoadout();
    expect(loadout.weapons).toHaveLength(4);
    for (const weapon of loadout.weapons) {
      expect(weapon.magazine).toBe(weapon.definition.magazineSize);
    }
  });

  it("starts on the rifle, hip fire, no recoil", () => {
    const loadout = createLoadout();
    expect(activeWeapon(loadout).definition.id).toBe("ar");
    expect(loadout.adsProgress).toBe(0);
    expect(loadout.recoilPitch).toBe(0);
  });
});

describe("automatic fire", () => {
  it("fires at roughly the stated rate while the trigger is held", () => {
    const loadout = createLoadout();
    const weapon = activeWeapon(loadout).definition;
    const shots = run(loadout, input({ fire: true }), 1);
    const expected = weapon.roundsPerMinute / 60;
    // Fire timing is quantised to the simulation step, so allow one shot.
    expect(shots.length).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
    expect(shots.length).toBeLessThanOrEqual(Math.ceil(expected) + 1);
  });

  it("stops at an empty magazine", () => {
    const loadout = createLoadout();
    const weapon = activeWeapon(loadout).definition;
    const size = weapon.magazineSize;
    // Long enough to empty the magazine, short enough that the automatic
    // reload has not yet delivered a second one.
    const emptyTime = size * (60 / weapon.roundsPerMinute);
    const shots = run(loadout, input({ fire: true }), emptyTime + 0.3);
    expect(shots.length).toBe(size);
    expect(activeWeapon(loadout).magazine).toBe(0);
  });

  it("spends exactly one round per shot", () => {
    const loadout = createLoadout();
    const before = activeWeapon(loadout).magazine;
    const shots = run(loadout, input({ fire: true }), 0.5);
    expect(activeWeapon(loadout).magazine).toBe(before - shots.length);
  });
});

describe("semi-automatic fire", () => {
  const toPistol = (): LoadoutState => {
    const loadout = createLoadout(["pistol"]);
    return loadout;
  };

  it("fires once no matter how long the trigger is held", () => {
    const loadout = toPistol();
    expect(run(loadout, input({ fire: true }), 2)).toHaveLength(1);
  });

  it("fires again after the trigger is released", () => {
    const loadout = toPistol();
    const random = createRandom(4);
    const ctx = context();
    let shots = 0;
    // Alternate press and release well apart, so the cooldown is never the
    // limiting factor and only the latch is under test.
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (let i = 0; i < 20; i += 1) {
        if (stepLoadout(loadout, input({ fire: true }), ctx, tickInterval, random)) shots += 1;
      }
      for (let i = 0; i < 20; i += 1) {
        stepLoadout(loadout, input({ fire: false }), ctx, tickInterval, random);
      }
    }
    expect(shots).toBe(3);
  });
});

describe("reloading", () => {
  it("refills the magazine from the reserve", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 1);
    const weapon = activeWeapon(loadout);
    const spent = weapon.definition.magazineSize - weapon.magazine;
    const reserveBefore = weapon.reserve;

    run(loadout, input({ reloadPressed: true }), weapon.definition.reloadTime + 0.1);
    expect(weapon.magazine).toBe(weapon.definition.magazineSize);
    expect(weapon.reserve).toBe(reserveBefore - spent);
    expect(weapon.reloading).toBe(false);
  });

  it("cannot fire during a magazine reload", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 0.5);
    run(loadout, input({ reloadPressed: true }), tickInterval * 2);
    expect(activeWeapon(loadout).reloading).toBe(true);
    expect(canFire(loadout, context())).toBe(false);
  });

  it("starts automatically when a dry trigger is pulled", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 10);
    expect(activeWeapon(loadout).magazine).toBe(0);
    run(loadout, input({ fire: true }), tickInterval * 2);
    expect(activeWeapon(loadout).reloading).toBe(true);
  });

  it("does nothing with an empty reserve", () => {
    const loadout = createLoadout();
    const weapon = activeWeapon(loadout);
    weapon.reserve = 0;
    weapon.magazine = 0;
    run(loadout, input({ reloadPressed: true }), 0.5);
    expect(weapon.reloading).toBe(false);
    expect(needsReload(weapon)).toBe(false);
  });

  it("loads the shotgun one shell at a time", () => {
    const loadout = createLoadout(["shotgun"]);
    const weapon = activeWeapon(loadout);
    weapon.magazine = 0;
    const shellTime = weapon.definition.reloadTime;

    run(loadout, input({ reloadPressed: true }), shellTime + tickInterval * 3);
    expect(weapon.magazine).toBe(1);
    run(loadout, input(), shellTime + tickInterval * 3);
    expect(weapon.magazine).toBe(2);
  });

  it("lets a shotgun reload be cut short by firing", () => {
    const loadout = createLoadout(["shotgun"]);
    const weapon = activeWeapon(loadout);
    weapon.magazine = 0;
    const shellTime = weapon.definition.reloadTime;

    run(loadout, input({ reloadPressed: true }), shellTime * 2 + tickInterval * 5);
    expect(weapon.magazine).toBeGreaterThanOrEqual(2);
    expect(weapon.reloading).toBe(true);

    const shots = run(loadout, input({ fire: true }), tickInterval * 2);
    expect(shots).toHaveLength(1);
    expect(weapon.reloading).toBe(false);
  });
});

describe("aiming", () => {
  it("takes the weapon's stated time to come up and to come down", () => {
    const loadout = createLoadout();
    const adsTime = activeWeapon(loadout).definition.adsTime;
    run(loadout, input({ aim: true }), adsTime + tickInterval);
    expect(loadout.adsProgress).toBeCloseTo(1, 3);
    run(loadout, input({ aim: false }), adsTime + tickInterval);
    expect(loadout.adsProgress).toBeCloseTo(0, 3);
  });

  it("is blocked while sprinting", () => {
    const loadout = createLoadout();
    run(loadout, input({ aim: true }), 1, context({ sprintOutTimer: 0.25 }));
    expect(loadout.adsProgress).toBe(0);
  });

  it("tightens the spread of the shot it produces", () => {
    const hip = createLoadout();
    const ads = createLoadout();
    const hipShots = run(hip, input({ fire: true }), tickInterval);
    run(ads, input({ aim: true }), activeWeapon(ads).definition.adsTime + tickInterval);
    const adsShots = run(ads, input({ fire: true, aim: true }), tickInterval);
    expect(adsShots[0].spreadDegrees).toBeLessThan(hipShots[0].spreadDegrees);
  });
});

describe("sprint-out delay", () => {
  it("blocks firing until the delay has run down", () => {
    const loadout = createLoadout();
    const sprinting = context({ sprintOutTimer: 0.25 });
    expect(run(loadout, input({ fire: true }), 0.2, sprinting)).toHaveLength(0);
    expect(run(loadout, input({ fire: true }), 0.2, context())).not.toHaveLength(0);
  });
});

describe("swapping", () => {
  it("takes the incoming weapon's swap time", () => {
    const loadout = createLoadout();
    const target = loadout.weapons[1].definition;
    run(loadout, input({ swapPressed: true }), tickInterval);
    expect(isSwapping(loadout)).toBe(true);
    run(loadout, input(), target.swapTime + tickInterval * 2);
    expect(isSwapping(loadout)).toBe(false);
    expect(activeWeapon(loadout).definition.id).toBe(target.id);
  });

  it("blocks firing while the weapon is coming up", () => {
    const loadout = createLoadout();
    run(loadout, input({ swapPressed: true }), tickInterval);
    expect(canFire(loadout, context())).toBe(false);
  });

  it("cycles through the whole loadout and back", () => {
    const loadout = createLoadout();
    const seen: string[] = [activeWeapon(loadout).definition.id];
    for (let i = 0; i < 4; i += 1) {
      run(loadout, input({ swapPressed: true }), tickInterval);
      run(loadout, input(), 1.0);
      seen.push(activeWeapon(loadout).definition.id);
    }
    expect(seen).toEqual(["ar", "smg", "shotgun", "pistol", "ar"]);
  });

  it("abandons a reload in progress", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 0.5);
    run(loadout, input({ reloadPressed: true }), tickInterval * 2);
    const rifle = loadout.weapons[0];
    expect(rifle.reloading).toBe(true);
    run(loadout, input({ swapPressed: true }), tickInterval);
    expect(rifle.reloading).toBe(false);
  });
});

describe("recoil accumulation", () => {
  it("walks the aim upward over a burst", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 0.5);
    expect(loadout.recoilPitch).toBeGreaterThan(0);
  });

  it("settles back toward centre once firing stops", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 0.5);
    const peak = loadout.recoilPitch;
    run(loadout, input(), 1.5);
    expect(loadout.recoilPitch).toBeLessThan(peak * 0.1);
  });

  it("aims the shot where the recoil has pushed the view", () => {
    const loadout = createLoadout();
    const shots = run(loadout, input({ fire: true }), 0.3);
    expect(shots.length).toBeGreaterThan(2);
    // The first shot leaves from the true aim; later ones leave higher.
    expect(shots[0].aimPitch).toBeCloseTo(0, 6);
    expect(shots[shots.length - 1].aimPitch).toBeGreaterThan(0);
  });

  it("restarts the pattern after the weapon has settled", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 0.3);
    expect(activeWeapon(loadout).shotIndex).toBeGreaterThan(0);
    run(loadout, input(), 1);
    expect(activeWeapon(loadout).shotIndex).toBe(0);
  });
});

describe("bloom", () => {
  it("grows while firing and recovers afterwards", () => {
    const loadout = createLoadout();
    run(loadout, input({ fire: true }), 0.4);
    const peak = activeWeapon(loadout).bloom;
    expect(peak).toBeGreaterThan(0);
    run(loadout, input(), 2);
    expect(activeWeapon(loadout).bloom).toBe(0);
  });
});

describe("shot output", () => {
  it("produces one pellet for a rifle and many for a shotgun", () => {
    const rifle = createLoadout(["ar"]);
    expect(run(rifle, input({ fire: true }), tickInterval)[0].pellets).toHaveLength(1);
    const shotgun = createLoadout(["shotgun"]);
    expect(run(shotgun, input({ fire: true }), tickInterval)[0].pellets).toHaveLength(8);
  });

  it("is reproducible from the same seed", () => {
    const a = createLoadout();
    const b = createLoadout();
    expect(run(a, input({ fire: true }), 0.3)).toEqual(run(b, input({ fire: true }), 0.3));
  });
});
