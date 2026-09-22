import type { BoxBrush } from "../maps/types";
import type { BrushGeometry } from "./brushGeometry";

/**
 * Sculpted geometry for the retro look.
 *
 * The level is a box world, and it has to stay one: the brushes are what
 * collision, hitscan and navigation are resolved against, on the client and
 * on the authoritative server alike. But nothing says the picture has to be
 * the same boxes. Every game since the first ones with brushes has drawn
 * something other than its collision hull, and that is what this does: for
 * the things in the level that are not architecture, it draws a shaped
 * low-polygon form inside the brush's own bounds and leaves the brush
 * exactly where it was.
 *
 * It matters most for the thing the level got most wrong. A tree here was a
 * brown box with seven tilted green boxes balanced on it; its own comment
 * admitted it was trying for a canopy's broken silhouette and reaching for
 * boxes to get there. Each of those green boxes is now a faceted leaf mass,
 * the rubble is faceted rock, and the trunk is a tapered pole. Nothing in
 * the simulation can tell.
 *
 * None of it costs anything. A box carrying the contact ring is sixty
 * triangles; a leaf mass is thirty-two.
 */

/** What a brush is drawn as, when it is not drawn as a box. */
export type RetroShape = "blob" | "rock" | "pole";

/**
 * Which brushes stop being boxes.
 *
 * Architecture stays: a concrete frame is boxes and looks right as boxes.
 * What changes is everything the building did not have built into it.
 */
export const retroShapeFor = (brush: BoxBrush): RetroShape | null => {
  if (brush.kind === "foliage") return "blob";
  if (brush.kind === "rubble") return "rock";
  // A tall, narrow prop is a post of some kind: a trunk, a pole, a bollard.
  if (brush.kind === "prop") {
    const across = Math.max(brush.width, brush.depth);
    if (brush.height > across * 2.2 && across < 1.2) return "pole";
  }
  return null;
};

/** A hash of a direction, so a vertex jitters the same way every time. */
const hash = (x: number, y: number, z: number, seed: number): number => {
  let h = seed >>> 0;
  for (const value of [x, y, z]) {
    h = Math.imul(h ^ Math.round(value * 512), 0x27d4eb2f) >>> 0;
    h = (h ^ (h >>> 15)) >>> 0;
  }
  return h / 4294967296;
};

interface Mesh {
  points: [number, number, number][];
  faces: [number, number, number][];
}

/** An octahedron: eight faces, and the seed every rounded form grows from. */
const octahedron = (): Mesh => ({
  points: [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ],
  faces: [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ],
});

/** Split every face into four, and push the new points out onto the sphere. */
const subdivide = (mesh: Mesh): Mesh => {
  const points = [...mesh.points];
  const faces: [number, number, number][] = [];
  const middles = new Map<string, number>();
  const middle = (a: number, b: number): number => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const found = middles.get(key);
    if (found !== undefined) return found;
    const [ax, ay, az] = points[a];
    const [bx, by, bz] = points[b];
    const x = (ax + bx) / 2;
    const y = (ay + by) / 2;
    const z = (az + bz) / 2;
    const length = Math.hypot(x, y, z) || 1;
    points.push([x / length, y / length, z / length]);
    const index = points.length - 1;
    middles.set(key, index);
    return index;
  };
  for (const [a, b, c] of mesh.faces) {
    const ab = middle(a, b);
    const bc = middle(b, c);
    const ca = middle(c, a);
    faces.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }
  return { points, faces };
};

const SPHERE = subdivide(octahedron());

/** How each shape is built out of the sphere. */
const SHAPES: Record<RetroShape, { jitter: number; squash: number; lift: number }> = {
  // A leaf mass: round, gently irregular, a touch flattened.
  blob: { jitter: 0.26, squash: 0.88, lift: 0 },
  // A rock: hard facets, and only a little flatter than the brush it fills.
  // Squashed hard it stopped being a rock and became crumpled sheet.
  rock: { jitter: 0.34, squash: 0.94, lift: -0.02 },
  // Not built from the sphere; the numbers are unused.
  pole: { jitter: 0, squash: 1, lift: 0 },
};

/**
 * A pole: a tapered prism, drawn with few enough sides to read as drawn.
 *
 * Six. Five looks like a mistake and eight is a cylinder; six is what the
 * era used for anything round it could not afford to round.
 */
const pole = (brush: BoxBrush, texelMetres: number): BrushGeometry => {
  const sides = 6;
  const halfHeight = brush.height / 2;
  const radius = Math.min(brush.width, brush.depth) / 2;
  const geometry: BrushGeometry = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
  };
  const around = Math.max(0.25, (radius * 2 * Math.PI) / texelMetres);
  const along = Math.max(0.25, brush.height / texelMetres);
  // Narrower at the top, the way anything that grew or was turned is.
  const taper = 0.76;

  const push = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    shade: number,
  ): number => {
    geometry.positions.push(x, y, z);
    geometry.normals.push(nx, ny, nz);
    geometry.uvs.push(u, v);
    geometry.colors.push(shade, shade, shade, 1);
    return geometry.positions.length / 3 - 1;
  };

  for (let i = 0; i < sides; i += 1) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const mid = (a0 + a1) / 2;
    const nx = Math.sin(mid);
    const nz = Math.cos(mid);
    const u0 = (i / sides) * around;
    const u1 = ((i + 1) / sides) * around;
    const corner = (angle: number, top: boolean): [number, number, number] => [
      Math.sin(angle) * radius * (top ? taper : 1),
      top ? halfHeight : -halfHeight,
      Math.cos(angle) * radius * (top ? taper : 1),
    ];
    const [bx0, by0, bz0] = corner(a0, false);
    const [bx1, by1, bz1] = corner(a1, false);
    const [tx0, ty0, tz0] = corner(a0, true);
    const [tx1, ty1, tz1] = corner(a1, true);
    // Darker at the foot, the way anything standing on the ground is.
    const a = push(bx0, by0, bz0, nx, 0, nz, u0, 0, 0.74);
    const b = push(bx1, by1, bz1, nx, 0, nz, u1, 0, 0.74);
    const c = push(tx1, ty1, tz1, nx, 0, nz, u1, along, 1);
    const d = push(tx0, ty0, tz0, nx, 0, nz, u0, along, 1);
    // Wound so the face points outward, as the box builder winds.
    geometry.indices.push(a, d, c, a, c, b);
  }
  // A cap on top, so a pole seen from above is not a hole.
  const capCentre = push(0, halfHeight, 0, 0, 1, 0, around / 2, along / 2, 1.05);
  const rim: number[] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = (i / sides) * Math.PI * 2;
    rim.push(
      push(
        Math.sin(angle) * radius * taper,
        halfHeight,
        Math.cos(angle) * radius * taper,
        0,
        1,
        0,
        around / 2 + Math.sin(angle) * around * 0.3,
        along / 2 + Math.cos(angle) * along * 0.3,
        1.05,
      ),
    );
  }
  for (let i = 0; i < sides; i += 1) {
    geometry.indices.push(capCentre, rim[(i + 1) % sides], rim[i]);
  }
  return geometry;
};

/**
 * A faceted lump, filling the brush it replaces.
 *
 * Every vertex is pushed in or out by a hash of the direction it points, so
 * two copies of the same vertex move together and the surface never tears,
 * and every lump in the level is its own shape rather than the same rock
 * repeated. Each triangle then takes its own three vertices and one normal:
 * flat facets are the whole point, and a smooth-shaded rock is a balloon.
 */
const lump = (brush: BoxBrush, shape: RetroShape, texelMetres: number): BrushGeometry => {
  const { jitter, squash, lift } = SHAPES[shape];
  const seed = Math.round((brush.x * 73.1 + brush.z * 151.7 + brush.y * 31.3) * 16) >>> 0;
  const half = [brush.width / 2, (brush.height / 2) * squash, brush.depth / 2];

  const moved = SPHERE.points.map(([x, y, z]) => {
    const push = 1 - jitter + hash(x, y, z, seed) * jitter * 2;
    return [
      x * push * half[0],
      y * push * half[1] + lift * half[1],
      z * push * half[2],
    ] as [number, number, number];
  });

  const geometry: BrushGeometry = {
    positions: [],
    normals: [],
    uvs: [],
    colors: [],
    indices: [],
  };
  const scale = [
    Math.max(0.25, brush.width / texelMetres),
    Math.max(0.25, brush.height / texelMetres),
    Math.max(0.25, brush.depth / texelMetres),
  ];

  for (const [ia, ib, ic] of SPHERE.faces) {
    const corners = [moved[ia], moved[ib], moved[ic]];
    const [ax, ay, az] = corners[0];
    const [bx, by, bz] = corners[1];
    const [cx, cy, cz] = corners[2];
    // The face's own normal, from its winding. The sphere winds so that the
    // cross of its edges points outward, and the renderer wants the other
    // way round, so the geometry is emitted reversed below.
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;

    // Project the texture on whichever way the face mostly points, which is
    // all a tiling pattern on an irregular lump needs.
    const axis =
      Math.abs(nx) > Math.abs(ny) && Math.abs(nx) > Math.abs(nz)
        ? 0
        : Math.abs(ny) > Math.abs(nz)
          ? 1
          : 2;
    const uv = (p: [number, number, number]): [number, number] =>
      axis === 0
        ? [(p[2] / brush.depth + 0.5) * scale[2], (p[1] / brush.height + 0.5) * scale[1]]
        : axis === 1
          ? [(p[0] / brush.width + 0.5) * scale[0], (p[2] / brush.depth + 0.5) * scale[2]]
          : [(p[0] / brush.width + 0.5) * scale[0], (p[1] / brush.height + 0.5) * scale[1]];

    // A lump has no edges to darken, so the shading that a box gets from its
    // contact ring comes from how the facet sits instead: what faces up is
    // lighter, what faces down is darker. On a leaf mass that is the whole
    // read of a canopy.
    const shade = 0.72 + (ny * 0.5 + 0.5) * 0.42;
    const base = geometry.positions.length / 3;
    for (const corner of corners) {
      geometry.positions.push(corner[0], corner[1], corner[2]);
      geometry.normals.push(nx, ny, nz);
      const [u, v] = uv(corner);
      geometry.uvs.push(u, v);
      geometry.colors.push(shade, shade, shade, 1);
    }
    geometry.indices.push(base, base + 2, base + 1);
  }
  return geometry;
};

/** The sculpted geometry for one brush, or null if it stays a box. */
export const retroGeometry = (brush: BoxBrush, texelMetres: number): BrushGeometry | null => {
  const shape = retroShapeFor(brush);
  if (!shape) return null;
  return shape === "pole" ? pole(brush, texelMetres) : lump(brush, shape, texelMetres);
};
