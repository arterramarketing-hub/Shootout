import { describe, expect, it } from "vitest";
import {
  MODELS,
  POSE,
  coversCentre,
  holdPosition,
  type ModelSpec,
  type Part,
  type WeaponPose,
} from "../src/view/weaponGeometry";

/**
 * The sight picture.
 *
 * Aiming is not a crosshair being switched on: the weapon is raised until the
 * rear sight, the front sight and the target are on one line, and the player
 * shoots at what they can see over the post. That only works if the parts
 * agree with each other to the millimetre, which is exactly the kind of
 * agreement that quietly stops being true the next time somebody moves a
 * barrel — so it is checked here rather than trusted.
 */

const WEAPONS = Object.entries(MODELS) as [string, ModelSpec][];

/** The pose the viewmodel writes with the sights fully up and nothing moving. */
const aimed = (spec: ModelSpec): WeaponPose => ({
  ...holdPosition(spec, 1),
  pitch: 0,
  yaw: 0,
  roll: 0,
});

const sightParts = (spec: ModelSpec): Part[] =>
  spec.parts.filter((part) => part.role === "sight");

const near = (value: number, target: number, tolerance = 0.0005): boolean =>
  Math.abs(value - target) <= tolerance;

describe("the sights", () => {
  it.each(WEAPONS)("%s aims along one line, front and rear", (_id, spec) => {
    const line = spec.sightLine;
    // The point the aimed pose centres on the screen is the line itself, not a
    // separately remembered number that could drift away from it.
    expect(spec.sight.x).toBe(0);
    expect(spec.sight.y).toBe(line.height);

    const rear = sightParts(spec).filter((part) => near(part.z, line.rearZ, 0.02));
    const front = sightParts(spec).filter((part) => near(part.z, line.frontZ, 0.02));
    expect(rear.length).toBeGreaterThan(0);
    expect(front.length).toBeGreaterThan(0);

    // Something at each end sits on the line: the aperture or notch centred on
    // it, and the post with its tip exactly on it.
    expect(rear.some((part) => near(part.y, line.height) || near(part.y + part.height / 2, line.height))).toBe(true);
    expect(front.some((part) => near(part.y + part.height / 2, line.height))).toBe(true);
    // Both are on the weapon's centreline, or the shot goes left of the aim.
    expect(rear.every((part) => Math.abs(part.x) < 0.012)).toBe(true);
  });

  it.each(WEAPONS)("%s leaves the aim point itself visible", (_id, spec) => {
    /*
     * The sights are exempt from the rule about covering the crosshair, which
     * makes it worth checking that they do not need the exemption at the one
     * place it would matter. Look straight down the line with nothing excused:
     * through the aperture, over the post, and out at the target.
     */
    expect(coversCentre(spec, aimed(spec), { includeSights: true })).toBe(false);
  });

  it.each(WEAPONS)("%s puts the target on top of the front post", (_id, spec) => {
    // A third of a degree below the aim point is the post; a third above is
    // open air. That is the hold: the target sits on the post, not behind it.
    const pose = aimed(spec);
    expect(coversCentre(spec, pose, { includeSights: true, offsetDegrees: [0, -0.35] })).toBe(true);
    expect(coversCentre(spec, pose, { includeSights: true, offsetDegrees: [0, 0.35] })).toBe(false);
  });

  it.each(WEAPONS)("%s keeps the sight picture open around the aim", (_id, spec) => {
    /*
     * The aperture has to be wider than the post it frames, or the player is
     * looking at metalwork rather than at the fight. This is the width of the
     * gap the sights leave around the aim point — narrow enough to be honest
     * about ironsights, wide enough to pick a moving target up in.
     */
    const pose = aimed(spec);
    for (const across of [-0.85, 0.85]) {
      expect(
        coversCentre(spec, pose, { includeSights: true, offsetDegrees: [across, 0.4] }),
      ).toBe(false);
    }
  });

  it.each(WEAPONS)("%s carries a lit dot on the front sight", (_id, spec) => {
    // On a phone in daylight a dark post against a dark wall is nothing at
    // all. The dot is what makes the sight readable at a glance.
    const dots = spec.parts.filter((part) => part.tone === "optic");
    expect(dots.length).toBeGreaterThan(0);
    expect(dots.every((part) => part.role === "sight")).toBe(true);
  });
});

describe("the weapons themselves", () => {
  it.each(WEAPONS)("%s is built from more than a silhouette", (_id, spec) => {
    // The weapon is the one object a player looks at for a whole match. This
    // is a floor on that, not a target: it fails if a model is ever gutted
    // back to a handful of blocks.
    expect(spec.parts.length).toBeGreaterThan(30);
  });

  it.each(WEAPONS)("%s uses more than boxes", (_id, spec) => {
    const shapes = new Set(spec.parts.map((part) => part.shape));
    expect(shapes.size).toBeGreaterThanOrEqual(3);
  });

  it.each(WEAPONS)("%s has something that moves when it fires", (_id, spec) => {
    // A bolt, a slide or a pump riding back is what tells a player at a glance
    // that the weapon worked, separately from the ammunition counter.
    expect(spec.parts.some((part) => part.group === "bolt")).toBe(true);
    expect(spec.boltTravel).toBeGreaterThan(0.005);
  });

  it.each(WEAPONS)("%s keeps its parts in front of the eye", (_id, spec) => {
    /*
     * Nothing may sit so far back that it lands behind the near plane when the
     * weapon is pulled in to aim and then kicked back on top of that. Geometry
     * that close does not read as a weapon; it reads as a wall.
     */
    const closest = Math.min(
      ...spec.parts.map((part) => POSE.aimZ + part.z - part.depth / 2 - spec.boltTravel),
    );
    expect(closest).toBeGreaterThan(0.12);
  });

  it.each(WEAPONS)("%s points its muzzle out of the front", (_id, spec) => {
    const furthest = Math.max(...spec.parts.map((part) => part.z + part.depth / 2));
    expect(spec.muzzle.z).toBeGreaterThanOrEqual(furthest - 0.02);
  });
});

describe("the sight dots", () => {
  it.each(WEAPONS)("%s lands its dots at one height on the screen", (_id, spec) => {
    /*
     * A dot's apparent height is how far it sits below the line of sight
     * divided by how far away it is. On a sidearm the rear dots are half as
     * far from the eye as the front one, so dropping all three by the same few
     * millimetres would stack them down the screen and make an aligned sight
     * picture look crooked.
     */
    const angles = spec.parts
      .filter((part) => part.tone === "optic")
      .map(
        (part) =>
          Math.atan2(spec.sightLine.height - part.y, POSE.aimZ + part.z) * (180 / Math.PI),
      );
    expect(angles.length).toBeGreaterThan(0);
    for (const angle of angles) expect(angle).toBeCloseTo(angles[0], 2);
  });
});
