import { describe, expect, it } from "vitest";
import { TEAM_COLOURS } from "../src/view/botView";
import { boulevardMap } from "../src/maps/boulevard";

/**
 * A player has to be able to see who they are shooting at.
 *
 * This is not a matter of taste. The rust team used to be a dusty orange-red
 * six degrees of hue from the brick and one from the painted spandrels, and
 * measured properly it sat seven units of CIE distance from a brick wall --
 * a figure standing against one was wearing it. Every surface the level is
 * built from is checked here, and so is the backdrop outside it, because a
 * silhouette on a roofline is against that.
 *
 * CIE76 on Lab, which is crude next to the later formulae and is the right
 * crudeness for this: it over-reports differences in saturated colours,
 * which is the direction that fails safe when the question is whether two
 * things are far enough apart.
 */

/** Below this, two large fields of colour are hard to tell apart at a glance. */
const AGAINST_THE_WORLD = 20;
/** The two sides have to be unmistakable, not merely different. */
const AGAINST_EACH_OTHER = 60;

const toLab = (hex: string): [number, number, number] => {
  const channel = (at: number): number => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const r = channel(1);
  const g = channel(3);
  const b = channel(5);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};

const distance = (a: string, b: string): number => {
  const first = toLab(a);
  const second = toLab(b);
  return Math.hypot(first[0] - second[0], first[1] - second[1], first[2] - second[2]);
};

/** Every colour the player sees the level in, by the name it goes by. */
const world = (): Record<string, string> => {
  const style = boulevardMap.style;
  const named: Record<string, string> = {};
  for (const [key, value] of Object.entries(style)) {
    if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) named[key] = value;
  }
  // The tints the level and its backdrop paint zones with, which is most of
  // what is actually on screen at any moment.
  for (const brush of boulevardMap.brushes) {
    if (brush.tint) named[`tint ${brush.tint}`] = brush.tint;
  }
  return named;
};

describe("team colours", () => {
  const surfaces = world();

  it("checks against a level, not a handful of swatches", () => {
    expect(Object.keys(surfaces).length).toBeGreaterThan(20);
  });

  for (const [team, colours] of Object.entries(TEAM_COLOURS)) {
    for (const [part, colour] of Object.entries(colours)) {
      it(`${team} ${part} stands off everything in the level`, () => {
        let nearest = Infinity;
        let nearestName = "";
        for (const [name, surface] of Object.entries(surfaces)) {
          const apart = distance(colour, surface);
          if (apart < nearest) {
            nearest = apart;
            nearestName = name;
          }
        }
        expect(nearest, `${colour} is ${nearest.toFixed(1)} from ${nearestName}`)
          .toBeGreaterThan(AGAINST_THE_WORLD);
      });
    }
  }

  it("keeps the two sides unmistakable from each other", () => {
    expect(distance(TEAM_COLOURS.a.body, TEAM_COLOURS.b.body)).toBeGreaterThan(
      AGAINST_EACH_OTHER,
    );
    expect(distance(TEAM_COLOURS.a.trim, TEAM_COLOURS.b.trim)).toBeGreaterThan(
      AGAINST_EACH_OTHER,
    );
  });

  it("keeps the hit sprays visible on the sides they mark", () => {
    // A mist the colour of the jacket it lands on is a hit marker that
    // disappears against the thing it is marking, and a dust puff the
    // colour of the wall is a round that left no sign of striking it.
    const BLOOD = "#6b0d14";
    const DUST = "#e8e3d6";
    for (const team of Object.values(TEAM_COLOURS)) {
      expect(distance(BLOOD, team.body)).toBeGreaterThan(AGAINST_THE_WORLD);
      expect(distance(BLOOD, team.trim)).toBeGreaterThan(AGAINST_THE_WORLD);
    }
    expect(distance(DUST, boulevardMap.style.concrete)).toBeGreaterThan(AGAINST_THE_WORLD);
    expect(distance(BLOOD, boulevardMap.style.brick)).toBeGreaterThan(AGAINST_THE_WORLD);
  });

  it("keeps a side's own two colours related rather than unrelated", () => {
    // Far enough apart to read as a marking, close enough to read as one
    // person rather than two.
    for (const team of Object.values(TEAM_COLOURS)) {
      const apart = distance(team.body, team.trim);
      expect(apart).toBeGreaterThan(25);
      expect(apart).toBeLessThan(90);
    }
  });
});
