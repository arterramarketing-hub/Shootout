import type { BoxBrush } from "../maps/types";

/**
 * Box geometry with the contact shading baked into it.
 *
 * Everything in this level is a box, and boxes stacked against boxes read as
 * stacked rather than built: two flat faces meeting at a perfectly sharp
 * corner give the eye nothing to tell it that one surface ends and another
 * begins, so a wall and the floor it stands on look like one painted plane
 * bent through ninety degrees.
 *
 * What is missing is what a real corner has: the light that reaches the last
 * few centimetres before a join has come past an obstruction, so it arrives
 * weaker. That is ambient occlusion, and it is the single cheapest thing
 * that makes blocky geometry read as carved. Here it is baked once, at load,
 * into a vertex colour: every face gets a border ring of geometry that is
 * dark at the outside edge and full brightness a hand's width in.
 *
 * It is a vertex colour rather than a texture because the textures tile —
 * one repeat covers three metres and has no idea where the brush it is
 * painted on ends. The geometry does.
 */

/** Positions, normals, uvs, colours and indices for one brush, engine-free. */
export interface BrushGeometry {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

/**
 * How far in from an edge the shading reaches, in metres.
 *
 * A hand's width. Wide enough to be seen from across the street, narrow
 * enough that a crate keeps a lit face in the middle of it.
 */
const EDGE_METRES = 0.085;

/**
 * How dark the outermost edge goes, as a fraction of the surface's colour.
 *
 * Far short of black: this stands in for ambient light arriving at a
 * grazing angle, not for a shadow. Anything heavier turns the level into a
 * wireframe of its own brushes.
 */
const EDGE_SHADE = 0.6;

/**
 * The span over which a face earns its full border, in metres.
 *
 * A face narrower than the first figure gets no border at all — a border a
 * hand wide on a pipe or a window mullion swallows the whole thing and the
 * trim goes to mud. Between the two the border fades in, so that two
 * neighbouring brushes of nearly the same size do not shade completely
 * differently.
 */
const NARROW = 0.3;
const WIDE = 0.8;

/** A face: its outward normal, and the two axes its surface runs along. */
interface Face {
  /** Which axis the normal is on, and which way. */
  axis: 0 | 1 | 2;
  sign: 1 | -1;
  /** Unit vectors across the face. `v` is chosen so the winding comes out
   *  front-facing: Babylon wants cross(u, v) pointing into the surface. */
  u: readonly [number, number, number];
  v: readonly [number, number, number];
}

// Ordered as Babylon orders a box's faces, so the UV scaling below matches
// what the rest of the renderer already assumed: back, front, right, left,
// top, bottom.
const FACES: readonly Face[] = [
  { axis: 2, sign: -1, u: [1, 0, 0], v: [0, 1, 0] },
  { axis: 2, sign: 1, u: [-1, 0, 0], v: [0, 1, 0] },
  { axis: 0, sign: 1, u: [0, 0, 1], v: [0, 1, 0] },
  { axis: 0, sign: -1, u: [0, 0, -1], v: [0, 1, 0] },
  { axis: 1, sign: 1, u: [1, 0, 0], v: [0, 0, 1] },
  { axis: 1, sign: -1, u: [1, 0, 0], v: [0, 0, -1] },
];

/** How far the border reaches in from the edges of a face this many metres across. */
const border = (span: number): number => {
  const ramp = Math.min(1, Math.max(0, (span - NARROW) / (WIDE - NARROW)));
  return EDGE_METRES * ramp;
};

/**
 * One box, centred on the origin, with its edges shaded.
 *
 * `texelMetres` is how many metres one repeat of the texture covers; the UVs
 * are scaled by the brush's real size against it so that texel density is
 * the same on a crate and on a forty metre floor.
 */
export const brushGeometry = (brush: BoxBrush, texelMetres: number): BrushGeometry => {
  const extents: readonly [number, number, number] = [brush.width, brush.height, brush.depth];
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (const face of FACES) {
    const normal: [number, number, number] = [0, 0, 0];
    normal[face.axis] = face.sign;
    const out = extents[face.axis] / 2;

    // How far the face runs along each of its two axes.
    const spanU = Math.abs(face.u[0]) * extents[0] + Math.abs(face.u[1]) * extents[1] + Math.abs(face.u[2]) * extents[2];
    const spanV = Math.abs(face.v[0]) * extents[0] + Math.abs(face.v[1]) * extents[1] + Math.abs(face.v[2]) * extents[2];
    const insetU = border(spanU);
    const insetV = border(spanV);
    // The texture repeats once per `texelMetres`, with a floor so that a
    // brush thinner than a repeat still gets a recognisable slice of it.
    const scaleU = Math.max(0.25, spanU / texelMetres);
    const scaleV = Math.max(0.25, spanV / texelMetres);

    const base = positions.length / 3;
    // A ring of four corners on the outside, and where there is room for it a
    // second ring set in from them at full brightness.
    const inset = insetU > 0 || insetV > 0;
    const rings: { du: number; dv: number; shade: number }[] = inset
      ? [
          { du: 0, dv: 0, shade: EDGE_SHADE },
          { du: insetU, dv: insetV, shade: 1 },
        ]
      : [{ du: 0, dv: 0, shade: 1 }];

    // Corners go round the face in one rotational direction, so the ring
    // between the two rings can be stitched a quad at a time.
    const corners: readonly [number, number][] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (const ring of rings) {
      for (const [su, sv] of corners) {
        const u = su * (spanU / 2 - ring.du);
        const v = sv * (spanV / 2 - ring.dv);
        positions.push(
          face.u[0] * u + face.v[0] * v + normal[0] * out,
          face.u[1] * u + face.v[1] * v + normal[1] * out,
          face.u[2] * u + face.v[2] * v + normal[2] * out,
        );
        normals.push(normal[0], normal[1], normal[2]);
        uvs.push((u / spanU + 0.5) * scaleU, (v / spanV + 0.5) * scaleV);
        colors.push(ring.shade, ring.shade, ring.shade, 1);
      }
    }

    const inner = inset ? base + 4 : base;
    indices.push(inner, inner + 1, inner + 2, inner, inner + 2, inner + 3);
    if (!inset) continue;
    for (let k = 0; k < 4; k += 1) {
      const next = (k + 1) % 4;
      indices.push(base + k, base + next, inner + next);
      indices.push(base + k, inner + next, inner + k);
    }
  }

  return { positions, normals, uvs, colors, indices };
};
