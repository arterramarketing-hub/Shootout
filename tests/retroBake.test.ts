import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { describe, expect, it } from "vitest";
import { boulevardMap } from "../src/maps/boulevard";
import { brushGeometry } from "../src/view/brushGeometry";
import { lightAt, lightRigFor } from "../src/view/lightRig";
import { bakeBrushLighting, exposureFor, posterize, rotateNormal } from "../src/view/retroBake";

const rig = lightRigFor(boulevardMap.style);
const exposure = exposureFor(rig);

const brush = { x: 0, y: 0, z: 0, width: 2, height: 2, depth: 2, kind: "wall" as const };

/** The mean colour of the vertices whose local normal points one way. */
const shadeFacing = (
  geometry: ReturnType<typeof brushGeometry>,
  nx: number,
  ny: number,
  nz: number,
): number => {
  let total = 0;
  let count = 0;
  for (let v = 0; v < geometry.normals.length / 3; v += 1) {
    if (
      geometry.normals[v * 3] !== nx ||
      geometry.normals[v * 3 + 1] !== ny ||
      geometry.normals[v * 3 + 2] !== nz
    )
      continue;
    total += geometry.colors[v * 4] + geometry.colors[v * 4 + 1] + geometry.colors[v * 4 + 2];
    count += 3;
  }
  return total / count;
};

describe("light rig", () => {
  it("leans the fill across the sun, not with it", () => {
    const flatKey = [rig.key[0], 0, rig.key[2]];
    const flatFill = [rig.fillAxis[0], 0, rig.fillAxis[2]];
    const dot = flatKey[0] * flatFill[0] + flatKey[2] * flatFill[2];
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    expect(Math.hypot(...flatFill)).toBeGreaterThan(0.1);
  });

  it("lights the ground brighter than the underside of a ceiling", () => {
    const up = lightAt(rig, 0, 1, 0);
    const down = lightAt(rig, 0, -1, 0);
    expect(up.r + up.g + up.b).toBeGreaterThan((down.r + down.g + down.b) * 1.5);
  });

  it("gives the two walls side-on to the sun different values", () => {
    // Which is the whole point of the lean.
    const across = [-rig.key[2], 0, rig.key[0]];
    const one = lightAt(rig, across[0], 0, across[2]);
    const other = lightAt(rig, -across[0], 0, -across[2]);
    const sum = (c: { r: number; g: number; b: number }): number => c.r + c.g + c.b;
    expect(Math.abs(sum(one) - sum(other))).toBeGreaterThan(0.15);
  });
});

describe("retro bake", () => {
  it("turns a normal exactly the way the engine turns a mesh", () => {
    for (const [pitch, yaw] of [
      [0, 0],
      [0.4, 0],
      [0, 1.3],
      [0.7, -2.1],
      [-1.2, 0.5],
    ]) {
      for (const [x, y, z] of [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [0.6, 0.8, 0],
      ]) {
        const engine = Vector3.TransformNormal(
          new Vector3(x, y, z),
          Matrix.RotationYawPitchRoll(yaw, pitch, 0),
        );
        const [rx, ry, rz] = rotateNormal(x, y, z, pitch, yaw);
        expect(rx).toBeCloseTo(engine.x, 6);
        expect(ry).toBeCloseTo(engine.y, 6);
        expect(rz).toBeCloseTo(engine.z, 6);
      }
    }
  });

  it("brings the best-lit face to white and clamps there", () => {
    const geometry = brushGeometry(brush, 3);
    bakeBrushLighting(geometry, {}, rig, exposure);
    let brightest = 0;
    for (let i = 0; i < geometry.colors.length; i += 4) {
      for (let c = 0; c < 3; c += 1) {
        expect(geometry.colors[i + c]).toBeLessThanOrEqual(1);
        expect(geometry.colors[i + c]).toBeGreaterThanOrEqual(0);
        brightest = Math.max(brightest, geometry.colors[i + c]);
      }
    }
    expect(brightest).toBeGreaterThan(0.95);
  });

  it("lights a floor brighter than a ceiling", () => {
    const geometry = brushGeometry(brush, 3);
    bakeBrushLighting(geometry, {}, rig, exposure);
    expect(shadeFacing(geometry, 0, 1, 0)).toBeGreaterThan(shadeFacing(geometry, 0, -1, 0) * 1.25);
    // But the underside is a darker face, not a black one.
    expect(shadeFacing(geometry, 0, -1, 0)).toBeGreaterThan(0.5);
  });

  it("keeps the edge shading under the light", () => {
    // The corners were darker than the middle before the light went in and
    // they must be after: the light multiplies, it does not replace.
    const geometry = brushGeometry(brush, 3);
    const before = [...geometry.colors];
    bakeBrushLighting(geometry, {}, rig, exposure);
    for (let v = 0; v < geometry.normals.length / 3; v += 1) {
      if (geometry.normals[v * 3 + 1] !== 1) continue;
      const wasDark = before[v * 4] < 0.99;
      const shade = geometry.colors[v * 4];
      if (wasDark) expect(shade).toBeLessThan(shadeFacing(geometry, 0, 1, 0) + 1e-9);
    }
  });

  it("lights a turned brush by where its faces actually point", () => {
    // A brush turned a half turn about the vertical has its front where its
    // back was, so its front takes the back's light.
    const still = brushGeometry(brush, 3);
    const turned = brushGeometry(brush, 3);
    bakeBrushLighting(still, {}, rig, exposure);
    bakeBrushLighting(turned, { yaw: Math.PI }, rig, exposure);
    expect(shadeFacing(turned, 0, 0, 1)).toBeCloseTo(shadeFacing(still, 0, 0, -1), 5);
    expect(shadeFacing(turned, 1, 0, 0)).toBeCloseTo(shadeFacing(still, -1, 0, 0), 5);
    // And the top is still the top.
    expect(shadeFacing(turned, 0, 1, 0)).toBeCloseTo(shadeFacing(still, 0, 1, 0), 5);
  });

  it("quantises lightness to a few shades and leaves hue and alpha alone", () => {
    // A mid grey a shade bluer than neutral. Channel by channel it would snap
    // to purple; by lightness it stays a grey of the nearest rung.
    const data = new Uint8ClampedArray([150, 150, 165, 200]);
    posterize(data, 6);
    const [r, g, b, a] = [...data];
    expect(a).toBe(200);
    // Lightness lands on a rung: 153 of 255, near enough.
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    expect(Math.abs(lum - 153)).toBeLessThan(2);
    // And the ratio between channels is what it was.
    expect(b / r).toBeCloseTo(165 / 150, 1);
    expect(g).toBe(r);
  });

  it("holds the same colour at different lightnesses to a few rungs", () => {
    const shades = [40, 90, 100, 110, 160, 220].map((v) => [v, v * 0.6, v * 0.5, 255]).flat();
    const data = new Uint8ClampedArray(shades.map(Math.round));
    posterize(data, 6);
    const rungs = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      rungs.add(Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114));
    }
    expect(rungs.size).toBeLessThanOrEqual(4);
  });
});
