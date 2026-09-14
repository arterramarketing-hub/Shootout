import { describe, expect, it } from "vitest";
import { CAMERA } from "../src/sim/config";
import { tickInterval } from "../src/sim/config";
import {
  activeWeapon,
  createLoadout,
  stepLoadout,
  type LoadoutContext,
  type LoadoutInput,
  type LoadoutState,
} from "../src/sim/loadout";
import { addLookOffset, createLook } from "../src/sim/look";
import { createRandom } from "../src/sim/random";
import { WEAPONS, type WeaponId } from "../src/sim/weapons";

const RAD_TO_DEG = 180 / Math.PI;

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

interface Burst {
  /** Where the player is actually aiming, in degrees above the horizon. */
  aimPitchDegrees: number;
  aimYawDegrees: number;
  /** The springy offset still on the camera, in degrees. */
  springPitchDegrees: number;
  /** Total the player sees: their aim plus the spring. */
  viewPitchDegrees: number;
  shots: number;
}

/**
 * Fire for a while and play the whole loop the real game plays: the climb
 * share of each shot goes into the look angles, the springy share stays on the
 * loadout, and the aim handed to the next shot is the sum.
 *
 * A weapon that is not automatic latches its trigger after each round, so the
 * harness releases and re-presses between shots the way a thumb does. Holding
 * a pump gun down otherwise measures exactly one shot.
 */
const holdTrigger = (
  loadout: LoadoutState,
  seconds: number,
  options: { compensateDegreesPerShot?: number } = {},
): Burst => {
  const random = createRandom(7);
  const look = createLook();
  const automatic = activeWeapon(loadout).definition.mode === "auto";
  const steps = Math.round(seconds / tickInterval);
  let shots = 0;
  let holding = true;

  for (let i = 0; i < steps; i += 1) {
    const ctx = context({ yaw: look.yaw, pitch: look.pitch });
    const frame = input({ fire: holding });
    const shot = stepLoadout(loadout, frame, ctx, tickInterval, random);
    if (!automatic) holding = shot ? false : true;
    if (!shot) continue;
    shots += 1;
    addLookOffset(look, shot.climbYaw, shot.climbPitch);
    // A player fighting the climb drags down by a fixed amount per shot.
    if (options.compensateDegreesPerShot) {
      addLookOffset(look, 0, -options.compensateDegreesPerShot / RAD_TO_DEG);
    }
  }

  return {
    aimPitchDegrees: look.pitch * RAD_TO_DEG,
    aimYawDegrees: look.yaw * RAD_TO_DEG,
    springPitchDegrees: loadout.recoilPitch * RAD_TO_DEG,
    viewPitchDegrees: (look.pitch + loadout.recoilPitch) * RAD_TO_DEG,
    shots,
  };
};

const loadoutOf = (id: WeaponId): LoadoutState => createLoadout([id]);

/**
 * Sample the camera's offset from the player's aim across a sustained burst.
 *
 * This is the number that decides whether a player can see what they are
 * shooting at. The offset is the gap between where they are pointing and where
 * the camera is looking, so whatever it is, the target sits that far off the
 * crosshair for as long as the trigger is held.
 */
const sustainedCameraOffset = (id: WeaponId, seconds = 2.4): { lo: number; hi: number } => {
  const loadout = loadoutOf(id);
  const random = createRandom(7);
  const look = createLook();
  const automatic = activeWeapon(loadout).definition.mode === "auto";
  const steps = Math.round(seconds / tickInterval);
  const offsets: number[] = [];
  let holding = true;

  for (let i = 0; i < steps; i += 1) {
    const ctx = context({ yaw: look.yaw, pitch: look.pitch });
    const shot = stepLoadout(loadout, input({ fire: holding }), ctx, tickInterval, random);
    if (!automatic) holding = !shot;
    if (shot) addLookOffset(look, shot.climbYaw, shot.climbPitch);
    // Skip the opening rounds, where the shake has not reached its level yet.
    if (i > steps * 0.4) offsets.push(loadout.recoilPitch * RAD_TO_DEG);
  }
  return { lo: Math.min(...offsets), hi: Math.max(...offsets) };
};

describe("the player can still see what they are shooting at", () => {
  it("keeps the camera within a degree of the aim while the trigger is held", () => {
    /*
     * The complaint this exists for. The shake used to be worth five or six
     * degrees, so pulling the trigger threw the whole world about thirty
     * pixels off the target and held it there until the trigger came up. The
     * violence of a shot belongs on the weapon model, which kicks in the
     * player's hands; the camera only trembles.
     */
    const { hi } = sustainedCameraOffset("ar");
    expect(hi).toBeLessThan(1.2);
  });

  it("never lets the shake stack from one shot to the next, on any weapon", () => {
    /*
     * The hazard is accumulation, not the size of one thump. A pump gun can
     * throw the camera hard because the next shell is most of a second away
     * and the shake is long gone by then; a rifle at ten rounds a second
     * cannot, because each kick lands on top of the last one and the pile is
     * what walks the target off the screen. So the number to bound is what is
     * still there when the next round goes off.
     */
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const loadout = loadoutOf(id);
      const random = createRandom(7);
      const look = createLook();
      const automatic = activeWeapon(loadout).definition.mode === "auto";
      const steps = Math.round(2.4 / tickInterval);
      let holding = true;
      let worstLeftover = 0;
      let fired = 0;

      for (let i = 0; i < steps; i += 1) {
        const ctx = context({ yaw: look.yaw, pitch: look.pitch });
        // Whatever the previous shot left behind, read before this one lands.
        const leftover = loadout.recoilPitch * RAD_TO_DEG;
        const shot = stepLoadout(loadout, input({ fire: holding }), ctx, tickInterval, random);
        if (!automatic) holding = !shot;
        if (!shot) continue;
        fired += 1;
        if (fired > 1) worstLeftover = Math.max(worstLeftover, leftover);
        addLookOffset(look, shot.climbYaw, shot.climbPitch);
      }

      expect(fired, id).toBeGreaterThan(1);
      expect(worstLeftover, `${id} piles shake up between shots`).toBeLessThan(1.2);
    }
  });

  it("does not jerk the view between one frame and the next", () => {
    // A target is trackable if it drifts. It is not trackable if it jumps.
    const loadout = loadoutOf("ar");
    const random = createRandom(7);
    const look = createLook();
    const steps = Math.round(2.4 / tickInterval);
    let previous = 0;
    let biggest = 0;

    for (let i = 0; i < steps; i += 1) {
      const ctx = context({ yaw: look.yaw, pitch: look.pitch });
      const shot = stepLoadout(loadout, input({ fire: true }), ctx, tickInterval, random);
      if (shot) addLookOffset(look, shot.climbYaw, shot.climbPitch);
      const view = (look.pitch + loadout.recoilPitch) * RAD_TO_DEG;
      if (i > 0) biggest = Math.max(biggest, Math.abs(view - previous));
      previous = view;
    }
    // Under a degree a frame is a view that slides rather than snaps.
    expect(biggest).toBeLessThan(1);
  });

  it("still trembles, so a shot is not silent on the camera", () => {
    // Small is the point; zero is not. The camera should show the weapon is
    // alive even though it is the weapon model doing the visible work.
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      expect(WEAPONS[id].recoil.punch, id).toBeGreaterThan(0.3);
    }
  });

  it("settles the tremble within a second of the last shot", () => {
    const loadout = loadoutOf("ar");
    const random = createRandom(7);
    stepLoadout(loadout, input({ fire: true }), context(), tickInterval, random);
    const jolt = loadout.recoilPitch;

    for (let i = 0; i < 60; i += 1) {
      stepLoadout(loadout, input(), context(), tickInterval, random);
    }
    expect(loadout.recoilPitch).toBeLessThan(jolt * 0.05);
  });
});

describe("recoil climbs the view", () => {
  it("lifts the rifle's view several degrees over one magazine", () => {
    // The number that matters is whether a player can see it. A degree of
    // climb on a phone is a handful of pixels, which is indistinguishable
    // from no recoil at all, and it is what this weapon used to produce.
    const loadout = loadoutOf("ar");
    const burst = holdTrigger(loadout, 3.2);

    expect(burst.shots).toBe(WEAPONS.ar.magazineSize);
    expect(burst.viewPitchDegrees).toBeGreaterThan(5);
  });

  it("keeps climbing as the magazine empties rather than settling", () => {
    // A kick that plateaus is a kick the player stops having to fight. The
    // spring is meant to plateau, so the growth has to be read off the aim,
    // which is the half that never recovers.
    const early = holdTrigger(loadoutOf("ar"), 1.1);
    const late = holdTrigger(loadoutOf("ar"), 2.9);
    expect(late.aimPitchDegrees).toBeGreaterThan(early.aimPitchDegrees * 1.8);
  });

  it("climbs on every weapon", () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const loadout = loadoutOf(id);
      // Long enough to empty the smallest magazine at its own fire rate.
      const burst = holdTrigger(loadout, 4.5);
      expect(burst.shots).toBeGreaterThan(1);
      expect(burst.viewPitchDegrees, `${id} barely moves the view`).toBeGreaterThan(2);
    }
  });

  it("declares a climb share inside its range for every weapon", () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) {
      const { climb } = WEAPONS[id].recoil;
      expect(climb, id).toBeGreaterThan(0);
      expect(climb, id).toBeLessThanOrEqual(1);
    }
  });
});

describe("recoil the player can fight", () => {
  it("does not undo the player's correction when the spring recovers", () => {
    /*
     * This is the failure that made aiming feel broken. When the whole kick
     * springs back, a player who pulls down to hold the target is correcting
     * for something that then removes itself, and the correction is left
     * behind as permanent error pointing at the floor. With the climb in the
     * aim there is nothing to remove, so holding the target leaves the aim
     * where the player put it.
     */
    const loadout = loadoutOf("ar");
    const perShot = (WEAPONS.ar.recoil.pattern[0][0] * WEAPONS.ar.recoil.climb);
    const burst = holdTrigger(loadout, 3.2, { compensateDegreesPerShot: perShot });

    // Let the spring settle, the way it does when the trigger is released.
    const random = createRandom(7);
    for (let i = 0; i < 120; i += 1) {
      stepLoadout(loadout, input(), context(), tickInterval, random);
    }

    const settled = burst.aimPitchDegrees;
    expect(Math.abs(settled)).toBeLessThan(4);
    expect(loadout.recoilPitch * RAD_TO_DEG).toBeLessThan(0.1);
  });

  it("leaves the springy share to recover on its own once firing stops", () => {
    const loadout = loadoutOf("ar");
    holdTrigger(loadout, 1.5);
    expect(loadout.recoilPitch).toBeGreaterThan(0);

    const random = createRandom(7);
    const peak = loadout.recoilPitch;
    for (let i = 0; i < 60; i += 1) {
      stepLoadout(loadout, input(), context(), tickInterval, random);
    }
    expect(loadout.recoilPitch).toBeLessThan(peak * 0.2);
  });

  it("keeps a visible spring between shots rather than snapping flat", () => {
    // The spring is the punch of the shot. If it recovers faster than the
    // weapon cycles there is nothing to see between rounds.
    const loadout = loadoutOf("ar");
    holdTrigger(loadout, 1.5);
    expect(loadout.recoilPitch * RAD_TO_DEG).toBeGreaterThan(0.3);
  });
});

describe("the climb cannot break the camera", () => {
  it("stops at the pitch limit instead of tipping over the top", () => {
    // Firing a long burst while already looking up must not walk the camera
    // past vertical, which inverts the controls.
    const look = createLook(0, CAMERA.maxPitchRadians - 0.01);
    for (let i = 0; i < 200; i += 1) addLookOffset(look, 0, 0.05);
    expect(look.pitch).toBeCloseTo(CAMERA.maxPitchRadians, 6);
  });

  it("stops at the downward limit too", () => {
    const look = createLook(0, -CAMERA.maxPitchRadians + 0.01);
    for (let i = 0; i < 200; i += 1) addLookOffset(look, 0, -0.05);
    expect(look.pitch).toBeCloseTo(-CAMERA.maxPitchRadians, 6);
  });

  it("lets yaw run past a full turn, which has no limit", () => {
    const look = createLook();
    addLookOffset(look, 1.2, 0);
    expect(look.yaw).toBeCloseTo(1.2, 6);
  });
});

describe("aiming down sights tames the climb", () => {
  it("climbs less when aimed than from the hip", () => {
    const hip = holdTrigger(loadoutOf("ar"), 3.2);

    const aimed = createLoadout(["ar"]);
    const random = createRandom(7);
    const look = createLook();
    const frame = input({ fire: true, aim: true });
    // Raise the sights first, so the burst is fired fully aimed.
    for (let i = 0; i < 60; i += 1) {
      stepLoadout(aimed, input({ aim: true }), context(), tickInterval, random);
    }
    expect(aimed.adsProgress).toBe(1);
    for (let i = 0; i < Math.round(3.2 / tickInterval); i += 1) {
      const ctx = context({ yaw: look.yaw, pitch: look.pitch });
      const shot = stepLoadout(aimed, frame, ctx, tickInterval, random);
      if (shot) addLookOffset(look, shot.climbYaw, shot.climbPitch);
    }
    const aimedView = (look.pitch + aimed.recoilPitch) * RAD_TO_DEG;
    expect(aimedView).toBeGreaterThan(0);
    expect(aimedView).toBeLessThan(hip.viewPitchDegrees);
  });
});

describe("the shot goes where the view is pointing", () => {
  it("fires along the aim plus the spring, not the raw look angle", () => {
    const loadout = loadoutOf("ar");
    const random = createRandom(7);
    const frame = input({ fire: true });

    // First shot: nothing accumulated yet, so it goes straight down the aim.
    const first = stepLoadout(loadout, frame, context({ pitch: 0.2 }), tickInterval, random);
    expect(first).not.toBeNull();
    expect(first?.aimPitch).toBeCloseTo(0.2, 6);

    // By the next shot the spring is loaded, and the bullet follows it.
    let second = null;
    for (let i = 0; i < 30 && !second; i += 1) {
      second = stepLoadout(loadout, frame, context({ pitch: 0.2 }), tickInterval, random);
    }
    expect(second).not.toBeNull();
    expect(second?.aimPitch).toBeGreaterThan(0.2);
  });

  it("sizes the jolt and the climb from their own knobs", () => {
    // The two halves are deliberately not derived from each other: one is
    // what a shot looks like, the other is what a magazine adds up to.
    const loadout = loadoutOf("ar");
    const random = createRandom(7);
    const shot = stepLoadout(loadout, input({ fire: true }), context(), tickInterval, random);
    expect(shot).not.toBeNull();

    const entry = WEAPONS.ar.recoil.pattern[0][0] / RAD_TO_DEG;
    const { climb, punch } = WEAPONS.ar.recoil;
    expect(shot?.climbPitch).toBeCloseTo(entry * climb, 6);
    expect(loadout.recoilPitch).toBeCloseTo(entry * punch, 6);
  });
});
