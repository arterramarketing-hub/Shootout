import { describe, expect, it } from "vitest";
import type { Team } from "../src/sim/bots";
import { buildSkin, flatten, type Loft } from "../src/view/loft";
import { BONES, soldierSkin } from "../src/view/soldier";

/**
 * The figure is drawn to the shape that is shot, so most of what is worth
 * asserting about it is where its mass sits against the hitboxes the
 * simulation resolves every bullet against.
 */
const BODY_BOX = { y: [0.48, 1.52], x: 0.24, z: 0.2 };
const HEAD_BOX = { y: [1.48, 1.76], x: 0.13, z: 0.13 };

const teams: Team[] = ["a", "b"];

const vertices = (skin: ReturnType<typeof soldierSkin>): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < skin.positions.length; i += 3) {
    out.push([skin.positions[i], skin.positions[i + 1], skin.positions[i + 2]]);
  }
  return out;
};

const boneNamed = (name: string): number => BONES.findIndex((bone) => bone.name === name);

/**
 * Just the trunk: everything the hips, the belly and the chest carry.
 *
 * Arms hang outside the body hitbox and the rifle reaches most of a metre
 * past it, both correctly, so anything asking a question about the torso
 * has to leave them out or it is measuring a gun.
 */
const trunk = (skin: ReturnType<typeof soldierSkin>): [number, number, number][] => {
  const wanted = new Set(["pelvis", "spine", "chest"].map(boneNamed));
  const out: [number, number, number][] = [];
  for (let v = 0; v < skin.positions.length / 3; v += 1) {
    if (!wanted.has(skin.boneIndices[v * 4])) continue;
    out.push([skin.positions[v * 3], skin.positions[v * 3 + 1], skin.positions[v * 3 + 2]]);
  }
  return out;
};

describe("loft", () => {
  const tube: Loft = {
    colour: "#808080",
    sides: 8,
    rings: [
      { at: { x: 0, y: 0, z: 0 }, across: 0.1, through: 0.1, round: 1, bone: 0 },
      { at: { x: 0, y: 1, z: 0 }, across: 0.05, through: 0.05, round: 1, bone: 0 },
    ],
  };

  it("winds every triangle so its face points outward", () => {
    // Babylon treats a triangle as front-facing when the cross product of
    // its edges opposes the outward normal; the other way round and the
    // figure is inside out and invisible.
    const skin = buildSkin([tube]);
    for (let i = 0; i < skin.indices.length; i += 3) {
      const p = (k: number): [number, number, number] => [
        skin.positions[skin.indices[i + k] * 3],
        skin.positions[skin.indices[i + k] * 3 + 1],
        skin.positions[skin.indices[i + k] * 3 + 2],
      ];
      const [a, b, c] = [p(0), p(1), p(2)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cross = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      // The declared normal of the first vertex of the face.
      const n = [
        skin.normals[skin.indices[i] * 3],
        skin.normals[skin.indices[i] * 3 + 1],
        skin.normals[skin.indices[i] * 3 + 2],
      ];
      const dot = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2];
      expect(dot).toBeLessThanOrEqual(1e-9);
    }
  });

  it("gives every vertex a unit normal", () => {
    const skin = buildSkin([tube]);
    for (let i = 0; i < skin.normals.length; i += 3) {
      expect(Math.hypot(skin.normals[i], skin.normals[i + 1], skin.normals[i + 2])).toBeCloseTo(
        1,
        5,
      );
    }
  });

  it("holds every vertex on the surface it was asked for", () => {
    const skin = buildSkin([tube]);
    for (let i = 0; i < skin.positions.length; i += 3) {
      const y = skin.positions[i + 1];
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(1 + 1e-9);
      const radius = Math.hypot(skin.positions[i], skin.positions[i + 2]);
      // Radius tapers from a tenth to a twentieth over the run.
      expect(radius).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it("walks a rectangle and an ellipse with the same angles", () => {
    // Blending the two is how a rounded rectangle is made; if the points
    // bunched at the corners, the blend would pinch.
    const boxy = buildSkin([
      { ...tube, rings: tube.rings.map((r) => ({ ...r, round: 0 })), sides: 16 },
    ]);
    const round = buildSkin([{ ...tube, sides: 16 }]);
    expect(boxy.positions.length).toBe(round.positions.length);
    // A square of half-width a has corners at a*sqrt(2); an ellipse does not.
    let boxyMax = 0;
    for (let i = 0; i < boxy.positions.length; i += 3) {
      boxyMax = Math.max(boxyMax, Math.hypot(boxy.positions[i], boxy.positions[i + 2]));
    }
    expect(boxyMax).toBeGreaterThan(0.1 * 1.3);
  });
});

describe("flatten", () => {
  const tube: Loft = {
    colour: "#808080",
    sides: 6,
    rings: [
      { at: { x: 0, y: 0, z: 0 }, across: 0.1, through: 0.1, round: 1, bone: 2, shade: 0.5 },
      { at: { x: 0, y: 1, z: 0 }, across: 0.1, through: 0.1, round: 1, bone: 2, blendBone: 3, blend: 0.5 },
    ],
  };

  it("gives every triangle its own three vertices", () => {
    const flat = flatten(buildSkin([tube]));
    expect(flat.positions.length / 3).toBe(flat.indices.length);
    for (const [i, index] of flat.indices.entries()) expect(index).toBe(i);
  });

  it("points every face outward, one normal to a face", () => {
    const flat = flatten(buildSkin([tube]));
    for (let i = 0; i < flat.indices.length; i += 3) {
      const n = [flat.normals[i * 3], flat.normals[i * 3 + 1], flat.normals[i * 3 + 2]];
      for (let k = 1; k < 3; k += 1) {
        expect(flat.normals[(i + k) * 3]).toBeCloseTo(n[0], 9);
        expect(flat.normals[(i + k) * 3 + 1]).toBeCloseTo(n[1], 9);
        expect(flat.normals[(i + k) * 3 + 2]).toBeCloseTo(n[2], 9);
      }
      expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 6);
      // On the wall of a tube, outward is away from the axis: the face's
      // centre and its normal point the same way from it.
      const cx = (flat.positions[i * 3] + flat.positions[(i + 1) * 3] + flat.positions[(i + 2) * 3]) / 3;
      const cz = (flat.positions[i * 3 + 2] + flat.positions[(i + 1) * 3 + 2] + flat.positions[(i + 2) * 3 + 2]) / 3;
      if (Math.abs(n[1]) > 0.9) continue; // a cap
      expect(cx * n[0] + cz * n[2]).toBeGreaterThan(0);
    }
  });

  it("carries colours and bones across", () => {
    const smooth = buildSkin([tube]);
    const flat = flatten(smooth);
    const seen = new Set<string>();
    for (let v = 0; v < flat.positions.length / 3; v += 1) {
      seen.add(`${flat.boneIndices[v * 4]}:${flat.boneWeights[v * 4].toFixed(2)}`);
      const total = flat.boneWeights[v * 4] + flat.boneWeights[v * 4 + 1];
      expect(total).toBeCloseTo(1, 6);
    }
    expect(seen).toContain("2:1.00");
    expect(seen).toContain("2:0.50");
    // The shade set on the first ring is still on its vertices.
    const shades = new Set(flat.colors.filter((_, i) => i % 4 === 0).map((c) => c.toFixed(3)));
    expect(shades.size).toBeGreaterThan(1);
  });
});

describe("soldier", () => {
  it("has a skeleton whose every bone but the root has a parent above it", () => {
    for (const [index, bone] of BONES.entries()) {
      if (index === 0) {
        expect(bone.parent).toBe(-1);
        continue;
      }
      expect(bone.parent).toBeGreaterThanOrEqual(0);
      // A parent always earlier in the table, so one pass builds the tree.
      expect(bone.parent).toBeLessThan(index);
    }
  });

  it("names the joints the pose asks for", () => {
    const names = new Set(BONES.map((bone) => bone.name));
    for (const name of [
      "pelvis",
      "spine",
      "chest",
      "head",
      "armR",
      "foreR",
      "handR",
      "armL",
      "foreL",
      "handL",
      "thighR",
      "shinR",
      "footR",
      "thighL",
      "shinL",
      "footL",
    ]) {
      expect(names, name).toContain(name);
    }
  });

  it("stands on the ground and reaches the height of a soldier", () => {
    for (const team of teams) {
      const points = vertices(soldierSkin(team));
      const low = Math.min(...points.map((p) => p[1]));
      const high = Math.max(...points.map((p) => p[1]));
      expect(low).toBeGreaterThan(-0.02);
      expect(low).toBeLessThan(0.05);
      expect(high).toBeGreaterThan(1.74);
      expect(high).toBeLessThan(1.84);
    }
  });

  it("puts the head where the head hitbox is", () => {
    // Not the helmet, which is allowed to overhang: the skull itself, which
    // is what a player aims at.
    const points = vertices(soldierSkin("a")).filter(
      (p) => p[1] > HEAD_BOX.y[0] && p[1] < HEAD_BOX.y[1] && Math.abs(p[0]) < 0.085,
    );
    expect(points.length).toBeGreaterThan(20);
    const centre = points.reduce((t, p) => t + p[1], 0) / points.length;
    expect(centre).toBeGreaterThan(1.56);
    expect(centre).toBeLessThan(1.7);
  });

  it("keeps the torso inside the box that is shot for a body hit", () => {
    // A little overhang is fine — the box is a simplification of a person,
    // not the other way round — but the trunk sitting outside it would mean
    // a centre-mass shot missing a figure it plainly hit.
    for (const [x, y, z] of trunk(soldierSkin("a"))) {
      if (y < 1.0 || y > 1.4) continue;
      expect(Math.abs(z)).toBeLessThan(BODY_BOX.z + 0.03);
      expect(Math.abs(x)).toBeLessThan(BODY_BOX.x + 0.02);
    }
  });

  it("keeps the trunk inside the vertical run of the body hitbox", () => {
    for (const [, y] of trunk(soldierSkin("a"))) {
      expect(y).toBeGreaterThan(BODY_BOX.y[0] - 0.02);
      expect(y).toBeLessThan(BODY_BOX.y[1] + 0.03);
    }
  });

  it("is built from real proportions, not a stack of equal parts", () => {
    const points = trunk(soldierSkin("a"));
    const widthAt = (y: number): number => {
      let wide = 0;
      for (const [x, py] of points) if (Math.abs(py - y) < 0.02) wide = Math.max(wide, Math.abs(x));
      return wide;
    };
    const waist = widthAt(1.12);
    // Shoulders wider than the waist, hips wider than the waist: the two
    // tapers that make a figure read as a body rather than as a bin.
    expect(widthAt(1.4)).toBeGreaterThan(waist * 1.12);
    expect(widthAt(0.94)).toBeGreaterThan(waist * 1.01);
  });

  it("gives every vertex bones that add up to one", () => {
    for (const team of teams) {
      const skin = soldierSkin(team);
      const count = skin.positions.length / 3;
      expect(skin.boneIndices.length).toBe(count * 4);
      expect(skin.boneWeights.length).toBe(count * 4);
      for (let v = 0; v < count; v += 1) {
        const total =
          skin.boneWeights[v * 4] +
          skin.boneWeights[v * 4 + 1] +
          skin.boneWeights[v * 4 + 2] +
          skin.boneWeights[v * 4 + 3];
        expect(total).toBeCloseTo(1, 6);
        for (let k = 0; k < 4; k += 1) {
          const bone = skin.boneIndices[v * 4 + k];
          expect(Number.isInteger(bone)).toBe(true);
          expect(bone).toBeGreaterThanOrEqual(0);
          expect(bone).toBeLessThan(BONES.length);
        }
      }
    }
  });

  it("uses only the first two bone slots, which is what the mesh is told", () => {
    // The mesh sets numBoneInfluencers to two; a weight in the third or
    // fourth slot would be silently dropped and tear the figure apart.
    const skin = soldierSkin("a");
    for (let v = 0; v < skin.positions.length / 3; v += 1) {
      expect(skin.boneWeights[v * 4 + 2]).toBe(0);
      expect(skin.boneWeights[v * 4 + 3]).toBe(0);
    }
  });

  it("builds both teams to the same shape", () => {
    // Same kit, different colours: that is the whole difference, and it is
    // worth a test because it is easy to break one side while editing it.
    const a = soldierSkin("a");
    const b = soldierSkin("b");
    expect(b.positions).toEqual(a.positions);
    expect(b.indices).toEqual(a.indices);
    expect(b.colors).not.toEqual(a.colors);
  });

  it("builds a low figure at a third of the full one's polygons, and flat", () => {
    const full = soldierSkin("a", "full");
    const low = soldierSkin("a", "low");
    expect(low.indices.length / 3).toBeLessThan((full.indices.length / 3) * 0.4);
    // Flat: every triangle owns its vertices.
    expect(low.positions.length / 3).toBe(low.indices.length);
  });

  it("gives the low figure a bigger head and hands, and the same height", () => {
    const width = (skin: ReturnType<typeof soldierSkin>, low: number, high: number): number => {
      let wide = 0;
      for (let v = 0; v < skin.positions.length / 3; v += 1) {
        const y = skin.positions[v * 3 + 1];
        if (y < low || y > high) continue;
        wide = Math.max(wide, Math.abs(skin.positions[v * 3]));
      }
      return wide;
    };
    const full = soldierSkin("a", "full");
    const low = soldierSkin("a", "low");
    expect(width(low, 1.66, 1.72)).toBeGreaterThan(width(full, 1.66, 1.72) * 1.08);
    const top = (skin: ReturnType<typeof soldierSkin>): number =>
      Math.max(...skin.positions.filter((_, i) => i % 3 === 1));
    expect(top(low)).toBeCloseTo(top(full), 2);
  });

  it("keeps the low figure's head on the head hitbox too", () => {
    const points = vertices(soldierSkin("b", "low")).filter(
      (p) => p[1] > HEAD_BOX.y[0] && p[1] < HEAD_BOX.y[1] && Math.abs(p[0]) < 0.095,
    );
    expect(points.length).toBeGreaterThan(20);
    const centre = points.reduce((t, p) => t + p[1], 0) / points.length;
    expect(centre).toBeGreaterThan(1.56);
    expect(centre).toBeLessThan(1.7);
  });

  it("stays within a budget a phone can draw seven of", () => {
    // Seven figures is a full field. At these numbers that is under twenty
    // thousand vertices for all of them, against the level's own seventy-
    // five thousand triangles, and each figure is a single draw call: the
    // cost of a soldier is in the vertex shader skinning it, not in the
    // count. The ceiling is here so detail added later has to be argued
    // for rather than accumulated.
    const skin = soldierSkin("a");
    expect(skin.indices.length / 3).toBeLessThan(3400);
    expect(skin.positions.length / 3).toBeLessThan(2600);
  });
});
