import { describe, expect, it } from "vitest";
import type { BoxBrush } from "../src/maps/types";
import { brushGeometry } from "../src/view/brushGeometry";

const brush = (width: number, height: number, depth: number): BoxBrush => ({
  x: 0,
  y: 0,
  z: 0,
  width,
  height,
  depth,
  kind: "wall",
});

const vertexCount = (g: { positions: number[] }): number => g.positions.length / 3;

/** Every triangle's geometric normal, from its winding. */
const faceNormals = (g: ReturnType<typeof brushGeometry>): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a, b, c] = [g.indices[i], g.indices[i + 1], g.indices[i + 2]];
    const p = (k: number): [number, number, number] => [
      g.positions[k * 3],
      g.positions[k * 3 + 1],
      g.positions[k * 3 + 2],
    ];
    const [ax, ay, az] = p(a);
    const [bx, by, bz] = p(b);
    const [cx, cy, cz] = p(c);
    const e1 = [bx - ax, by - ay, bz - az];
    const e2 = [cx - ax, cy - ay, cz - az];
    out.push([
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ]);
  }
  return out;
};

describe("brush geometry", () => {
  it("keeps every vertex on the box it was asked for", () => {
    const g = brushGeometry(brush(3, 2.5, 4), 3);
    for (let i = 0; i < g.positions.length; i += 3) {
      expect(Math.abs(g.positions[i])).toBeLessThanOrEqual(1.5001);
      expect(Math.abs(g.positions[i + 1])).toBeLessThanOrEqual(1.2501);
      expect(Math.abs(g.positions[i + 2])).toBeLessThanOrEqual(2.0001);
    }
  });

  it("puts every vertex of a face on that face's plane", () => {
    const g = brushGeometry(brush(3, 2.5, 4), 3);
    const half = [1.5, 1.25, 2];
    for (let v = 0; v < vertexCount(g); v += 1) {
      const n = [g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]];
      const axis = n.findIndex((c) => c !== 0);
      expect(axis).toBeGreaterThanOrEqual(0);
      expect(g.positions[v * 3 + axis]).toBeCloseTo(n[axis] * half[axis], 6);
    }
  });

  it("winds every triangle so its face points outward", () => {
    // Babylon's own box has cross(edge1, edge2) opposite the outward normal;
    // a face wound the other way is culled and the brush has a hole in it.
    const g = brushGeometry(brush(3, 2.5, 4), 3);
    const normals = faceNormals(g);
    for (const [i, cross] of normals.entries()) {
      const v = g.indices[i * 3];
      const declared = [g.normals[v * 3], g.normals[v * 3 + 1], g.normals[v * 3 + 2]];
      const dot = cross[0] * declared[0] + cross[1] * declared[1] + cross[2] * declared[2];
      expect(dot).toBeLessThan(0);
    }
  });

  it("shades the rim of a face and leaves its middle alone", () => {
    const g = brushGeometry(brush(3, 2.5, 4), 3);
    const shades = new Set<number>();
    for (let v = 0; v < vertexCount(g); v += 1) shades.add(Number(g.colors[v * 4].toFixed(4)));
    expect(shades.size).toBe(2);
    expect(Math.min(...shades)).toBeGreaterThan(0.4);
    expect(Math.min(...shades)).toBeLessThan(0.8);
    expect(Math.max(...shades)).toBe(1);
  });

  it("darkens the outer corners, not the inner ones", () => {
    const g = brushGeometry(brush(3, 2.5, 4), 3);
    // On the top face, the vertex furthest from the centre is the darkest.
    let darkest = -1;
    let brightest = -1;
    for (let v = 0; v < vertexCount(g); v += 1) {
      if (g.normals[v * 3 + 1] !== 1) continue;
      const r = Math.hypot(g.positions[v * 3], g.positions[v * 3 + 2]);
      if (darkest < 0 || r > darkest) darkest = r;
      if (brightest < 0 || r < brightest) brightest = r;
    }
    expect(darkest).toBeGreaterThan(brightest);
  });

  it("leaves a face with no room for a rim unshaded", () => {
    // A mullion or a pipe: a rim a hand wide would swallow the whole thing,
    // so the narrow way across a face gets no rim while the long way still
    // does. The little square cap on the end gets none at all.
    const g = brushGeometry(brush(0.12, 3, 0.12), 3);
    for (let v = 0; v < vertexCount(g); v += 1) {
      // No inset across the thin axes: every vertex stays on the silhouette.
      expect(Math.abs(g.positions[v * 3])).toBeCloseTo(0.06, 6);
      if (g.normals[v * 3 + 1] !== 0) expect(g.colors[v * 4]).toBe(1);
    }
    // Four faces run the long way and take a rim; the two caps do not.
    expect(vertexCount(g)).toBe(4 * 8 + 2 * 4);
  });

  it("fades the rim in rather than switching it on", () => {
    // Two brushes of nearly the same size should not shade completely
    // differently, so the rim ramps in over a range of face widths.
    const near = brushGeometry(brush(0.45, 3, 3), 3);
    const wide = brushGeometry(brush(3, 3, 3), 3);
    const spread = (g: ReturnType<typeof brushGeometry>): number => {
      let min = Infinity;
      let max = -Infinity;
      for (let v = 0; v < g.positions.length / 3; v += 1) {
        if (g.normals[v * 3 + 2] !== 1) continue;
        min = Math.min(min, Math.abs(g.positions[v * 3]));
        max = Math.max(max, Math.abs(g.positions[v * 3]));
      }
      return max - min;
    };
    expect(spread(near)).toBeGreaterThan(0);
    expect(spread(near)).toBeLessThan(spread(wide));
  });

  it("scales uvs by the brush's real size so texel density stays even", () => {
    const g = brushGeometry(brush(9, 3, 3), 3);
    let maxU = 0;
    for (let v = 0; v < vertexCount(g); v += 1) {
      if (g.normals[v * 3 + 2] !== 1) continue;
      maxU = Math.max(maxU, g.uvs[v * 2]);
    }
    expect(maxU).toBeCloseTo(3, 6);
  });

  it("keeps a brush thinner than one texture repeat off a single stretched texel", () => {
    const g = brushGeometry(brush(0.2, 3, 3), 3);
    let maxU = 0;
    for (let v = 0; v < vertexCount(g); v += 1) {
      if (g.normals[v * 3 + 2] !== 1) continue;
      maxU = Math.max(maxU, g.uvs[v * 2]);
    }
    expect(maxU).toBeCloseTo(0.25, 6);
  });

  it("gives every vertex a colour, so brushes with and without a rim still merge", () => {
    for (const g of [brushGeometry(brush(4, 4, 4), 3), brushGeometry(brush(0.1, 4, 0.1), 3)]) {
      expect(g.colors.length).toBe(vertexCount(g) * 4);
      expect(g.uvs.length).toBe(vertexCount(g) * 2);
      expect(g.normals.length).toBe(vertexCount(g) * 3);
    }
  });
});
