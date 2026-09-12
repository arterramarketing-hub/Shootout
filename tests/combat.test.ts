import { describe, expect, it } from "vitest";
import { aimForward, aimRight, aimUp, offsetDirection } from "../src/sim/aim";
import { resolveShot, type HitscanWorld, type RayHit } from "../src/sim/combat";
import type { ShotEvent } from "../src/sim/loadout";
import { length, vec3, type Vec3 } from "../src/sim/vec3";
import { WEAPONS } from "../src/sim/weapons";

describe("aim basis", () => {
  it("looks down the forward axis at zero yaw and pitch", () => {
    const forward = aimForward(0, 0);
    expect(forward.x).toBeCloseTo(0, 6);
    expect(forward.y).toBeCloseTo(0, 6);
    expect(forward.z).toBeCloseTo(1, 6);
  });

  it("points upward at positive pitch", () => {
    expect(aimForward(0, 0.5).y).toBeGreaterThan(0);
    expect(aimForward(0, -0.5).y).toBeLessThan(0);
  });

  it("turns toward positive X as yaw grows", () => {
    expect(aimForward(Math.PI / 2, 0).x).toBeCloseTo(1, 6);
  });

  it("keeps the basis orthonormal at every angle", () => {
    for (const yaw of [0, 0.8, -2.1, 3.0]) {
      for (const pitch of [0, 0.6, -1.2]) {
        const forward = aimForward(yaw, pitch);
        const right = aimRight(yaw);
        const up = aimUp(yaw, pitch);
        expect(length(forward)).toBeCloseTo(1, 6);
        expect(length(right)).toBeCloseTo(1, 6);
        expect(length(up)).toBeCloseTo(1, 6);
        const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
        expect(dot(forward, right)).toBeCloseTo(0, 6);
        expect(dot(forward, up)).toBeCloseTo(0, 6);
        expect(dot(right, up)).toBeCloseTo(0, 6);
      }
    }
  });
});

describe("offsetDirection", () => {
  it("returns the aim itself with no offset", () => {
    expect(offsetDirection(0.4, 0.2, 0, 0)).toEqual(aimForward(0.4, 0.2));
  });

  it("always returns a unit vector", () => {
    expect(length(offsetDirection(1.2, -0.4, 0.08, -0.05))).toBeCloseTo(1, 6);
  });

  it("keeps the cone circular regardless of pitch", () => {
    // A squashed cone would make the same offset subtend a different angle
    // when looking up than when looking level.
    const angleFor = (pitch: number) => {
      const centre = aimForward(0, pitch);
      const offset = offsetDirection(0, pitch, 0.05, 0);
      const dot = centre.x * offset.x + centre.y * offset.y + centre.z * offset.z;
      return Math.acos(Math.min(1, dot));
    };
    expect(angleFor(1.2)).toBeCloseTo(angleFor(0), 6);
    expect(angleFor(-1.0)).toBeCloseTo(angleFor(0), 6);
  });
});

/** A world where everything past `wallDistance` is solid. */
class TestWorld implements HitscanWorld {
  constructor(
    private readonly wallDistance: number,
    private readonly targetId: string | null = null,
    private readonly headshot = false,
  ) {}

  raycast(origin: Vec3, direction: Vec3, maxDistance: number): RayHit | null {
    if (this.wallDistance > maxDistance) return null;
    return {
      distance: this.wallDistance,
      point: vec3(
        origin.x + direction.x * this.wallDistance,
        origin.y + direction.y * this.wallDistance,
        origin.z + direction.z * this.wallDistance,
      ),
      normal: vec3(-direction.x, -direction.y, -direction.z),
      targetId: this.targetId,
      headshot: this.headshot,
    };
  }
}

const shot = (pellets: { yaw: number; pitch: number }[], weapon = WEAPONS.ar): ShotEvent => ({
  weapon,
  pellets,
  spreadDegrees: 1,
  aimYaw: 0,
  aimPitch: 0,
});

describe("resolveShot", () => {
  const origin = vec3(0, 1.6, 0);

  it("reports a miss at maximum range when nothing is hit", () => {
    const resolution = resolveShot(shot([{ yaw: 0, pitch: 0 }]), origin, new TestWorld(1e9));
    expect(resolution.hitTarget).toBe(false);
    expect(resolution.impacts[0].hit).toBe(false);
    expect(resolution.impacts[0].distance).toBe(WEAPONS.ar.maxRange);
  });

  it("does no damage to level geometry", () => {
    const resolution = resolveShot(shot([{ yaw: 0, pitch: 0 }]), origin, new TestWorld(10));
    expect(resolution.impacts[0].hit).toBe(true);
    expect(resolution.impacts[0].damage).toBe(0);
    expect(resolution.damage).toHaveLength(0);
  });

  it("damages a target it hits", () => {
    const resolution = resolveShot(
      shot([{ yaw: 0, pitch: 0 }]),
      origin,
      new TestWorld(10, "plate"),
    );
    expect(resolution.hitTarget).toBe(true);
    expect(resolution.damage[0].targetId).toBe("plate");
    expect(resolution.damage[0].damage).toBeCloseTo(WEAPONS.ar.damage, 6);
  });

  it("multiplies damage on a headshot", () => {
    const body = resolveShot(shot([{ yaw: 0, pitch: 0 }]), origin, new TestWorld(5, "p"));
    const head = resolveShot(shot([{ yaw: 0, pitch: 0 }]), origin, new TestWorld(5, "p", true));
    expect(head.damage[0].damage).toBeCloseTo(
      body.damage[0].damage * WEAPONS.ar.headshotMultiplier,
      6,
    );
    expect(head.damage[0].headshot).toBe(true);
  });

  it("reduces damage with distance", () => {
    const near = resolveShot(shot([{ yaw: 0, pitch: 0 }]), origin, new TestWorld(5, "p"));
    const far = resolveShot(shot([{ yaw: 0, pitch: 0 }]), origin, new TestWorld(70, "p"));
    expect(far.damage[0].damage).toBeLessThan(near.damage[0].damage);
  });

  it("totals every pellet that lands on one target", () => {
    const pellets = Array.from({ length: 8 }, () => ({ yaw: 0, pitch: 0 }));
    const resolution = resolveShot(
      shot(pellets, WEAPONS.shotgun),
      origin,
      new TestWorld(4, "plate"),
    );
    expect(resolution.damage).toHaveLength(1);
    expect(resolution.damage[0].pellets).toBe(8);
    expect(resolution.damage[0].damage).toBeCloseTo(WEAPONS.shotgun.damage * 8, 5);
  });

  it("traces one impact per pellet", () => {
    const pellets = Array.from({ length: 8 }, (_, i) => ({ yaw: i * 0.001, pitch: 0 }));
    const resolution = resolveShot(shot(pellets, WEAPONS.shotgun), origin, new TestWorld(4));
    expect(resolution.impacts).toHaveLength(8);
  });

  it("places the impact along the ray at the reported distance", () => {
    const resolution = resolveShot(shot([{ yaw: 0, pitch: 0 }]), origin, new TestWorld(12));
    const impact = resolution.impacts[0];
    const travelled = Math.hypot(
      impact.point.x - origin.x,
      impact.point.y - origin.y,
      impact.point.z - origin.z,
    );
    expect(travelled).toBeCloseTo(12, 5);
  });
});
