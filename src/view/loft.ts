import type { Vec3 } from "../sim/vec3";

/**
 * Lofted surfaces: the primitive everything human is built from.
 *
 * A box can describe a crate. It cannot describe a shoulder, a thigh that
 * narrows to a knee, or the back of a skull, and a figure assembled from
 * boxes reads as an assembly of boxes however many you use. What those
 * shapes have in common is that they are a cross-section that changes as it
 * travels: a ring of some width and depth, swept along a line, growing and
 * shrinking as it goes. That is a loft, and one of them draws an upper arm,
 * a ribcage, a helmet or a boot depending only on the numbers fed to it.
 *
 * Nothing here knows about the engine. It takes rings and gives back the
 * buffers a mesh is made of, including the bone each vertex follows, so the
 * shape can be checked without a canvas.
 */

/** One cross-section along a loft. */
export interface Ring {
  /** Centre of the ring, in the figure's own space. */
  at: Vec3;
  /** Half-size across the two axes of the loft's frame. */
  across: number;
  through: number;
  /**
   * Nought is a rectangle, one is an ellipse, and between them is the
   * rounded rectangle that most of a person actually is.
   */
  round: number;
  /** Multiplier on the part's colour here. Creases and hollows go darker. */
  shade?: number;
  /** The bone these vertices follow. */
  bone: number;
  /** A second bone to share them with, for the last stretch before a joint. */
  blendBone?: number;
  /** How much of the share goes to the second bone, nought to one. */
  blend?: number;
}

export interface Loft {
  rings: Ring[];
  /** Points around one ring. Eight reads as round at these sizes. */
  sides: number;
  /** Base colour, as a hex string. */
  colour: string;
  capStart?: boolean;
  capEnd?: boolean;
  /** Turn the cross-section about the loft's axis, in radians. */
  roll?: number;
}

/** Everything a skinned mesh is made of, as plain arrays. */
export interface Skin {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  /** Four bone slots per vertex, as the engine's skinning expects. */
  boneIndices: number[];
  boneWeights: number[];
}

const hex = (value: string): [number, number, number] => {
  const n = parseInt(value.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const norm = (v: Vec3): Vec3 => {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
};

/**
 * The frame a loft's rings sit in.
 *
 * One frame for the whole loft rather than one per ring: a per-ring frame
 * twists where the path bends, and every part here travels close enough to
 * a straight line that a swept frame is both simpler and steadier.
 */
const frameOf = (first: Vec3, last: Vec3): { right: Vec3; forward: Vec3; axis: Vec3 } => {
  const span = sub(last, first);
  const axis = Math.hypot(span.x, span.y, span.z) < 1e-6 ? { x: 0, y: 1, z: 0 } : norm(span);
  // A reference that is never parallel to the axis, so the cross product
  // below has something to work with.
  const reference = Math.abs(axis.y) > 0.85 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const right = norm(cross(reference, axis));
  const forward = cross(axis, right);
  return { right, forward, axis };
};

/**
 * A point on the unit cross-section.
 *
 * The rectangle and the ellipse are walked with the same angle, so blending
 * between them keeps the points evenly spread rather than bunching them at
 * the corners.
 */
const section = (angle: number, round: number): [number, number] => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const reach = Math.max(Math.abs(c), Math.abs(s)) || 1;
  return [c * (round + (1 - round) / reach), s * (round + (1 - round) / reach)];
};

/** Turn a set of lofts into one skinned mesh. */
export const buildSkin = (lofts: Loft[]): Skin => {
  const skin: Skin = {
    positions: [],
    normals: [],
    colors: [],
    indices: [],
    boneIndices: [],
    boneWeights: [],
  };

  for (const loft of lofts) {
    if (loft.rings.length < 2) continue;
    const [r, g, b] = hex(loft.colour);
    const { right, forward, axis } = frameOf(loft.rings[0].at, loft.rings[loft.rings.length - 1].at);
    const roll = loft.roll ?? 0;
    const base = skin.positions.length / 3;
    const count = loft.sides;

    for (const ring of loft.rings) {
      const shade = ring.shade ?? 1;
      for (let k = 0; k < count; k += 1) {
        const angle = (k / count) * Math.PI * 2 + roll;
        const [u, v] = section(angle, ring.round);
        const a = u * ring.across;
        const c = v * ring.through;
        skin.positions.push(
          ring.at.x + right.x * a + forward.x * c,
          ring.at.y + right.y * a + forward.y * c,
          ring.at.z + right.z * a + forward.z * c,
        );
        // Filled in below, once every face touching this vertex is known.
        skin.normals.push(0, 0, 0);
        skin.colors.push(r * shade, g * shade, b * shade, 1);
        const blend = ring.blendBone === undefined ? 0 : Math.min(1, Math.max(0, ring.blend ?? 0));
        skin.boneIndices.push(ring.bone, ring.blendBone ?? 0, 0, 0);
        skin.boneWeights.push(1 - blend, blend, 0, 0);
      }
    }

    const wallFrom = skin.indices.length;
    // The wall. Wound so that each face points away from the loft's axis;
    // the engine treats a triangle as front-facing when the cross product
    // of its edges opposes the outward normal.
    for (let i = 0; i + 1 < loft.rings.length; i += 1) {
      for (let k = 0; k < count; k += 1) {
        const next = (k + 1) % count;
        const a = base + i * count + k;
        const bIndex = base + i * count + next;
        const c = base + (i + 1) * count + next;
        const d = base + (i + 1) * count + k;
        skin.indices.push(a, d, c, a, c, bIndex);
      }
    }

    // Smooth normals, accumulated over the faces of this loft alone. Parts
    // stay separate from each other, so a limb reads round while the gear
    // strapped to it keeps its own edges.
    const first = base * 3;
    const last = skin.positions.length;
    for (let i = wallFrom; i < skin.indices.length; i += 3) {
      const [ia, ib, ic] = [skin.indices[i], skin.indices[i + 1], skin.indices[i + 2]];
      const at = (index: number): Vec3 => ({
        x: skin.positions[index * 3],
        y: skin.positions[index * 3 + 1],
        z: skin.positions[index * 3 + 2],
      });
      const face = cross(sub(at(ib), at(ia)), sub(at(ic), at(ia)));
      for (const index of [ia, ib, ic]) {
        // The winding points into the surface, so the normal is the other way.
        skin.normals[index * 3] -= face.x;
        skin.normals[index * 3 + 1] -= face.y;
        skin.normals[index * 3 + 2] -= face.z;
      }
    }
    for (let i = first; i < last; i += 3) {
      const length = Math.hypot(skin.normals[i], skin.normals[i + 1], skin.normals[i + 2]);
      if (length < 1e-9) continue;
      skin.normals[i] /= length;
      skin.normals[i + 1] /= length;
      skin.normals[i + 2] /= length;
    }

    const cap = (index: number, outward: 1 | -1): void => {
      const ring = loft.rings[index];
      const start = skin.positions.length / 3;
      const shade = (ring.shade ?? 1) * 0.94;
      const blend = ring.blendBone === undefined ? 0 : Math.min(1, Math.max(0, ring.blend ?? 0));
      const push = (x: number, y: number, z: number): void => {
        skin.positions.push(x, y, z);
        skin.normals.push(axis.x * outward, axis.y * outward, axis.z * outward);
        skin.colors.push(r * shade, g * shade, b * shade, 1);
        skin.boneIndices.push(ring.bone, ring.blendBone ?? 0, 0, 0);
        skin.boneWeights.push(1 - blend, blend, 0, 0);
      };
      push(ring.at.x, ring.at.y, ring.at.z);
      for (let k = 0; k < count; k += 1) {
        const angle = (k / count) * Math.PI * 2 + roll;
        const [u, v] = section(angle, ring.round);
        const a = u * ring.across;
        const c = v * ring.through;
        push(
          ring.at.x + right.x * a + forward.x * c,
          ring.at.y + right.y * a + forward.y * c,
          ring.at.z + right.z * a + forward.z * c,
        );
      }
      for (let k = 0; k < count; k += 1) {
        const next = (k + 1) % count;
        if (outward > 0) skin.indices.push(start, start + 1 + next, start + 1 + k);
        else skin.indices.push(start, start + 1 + k, start + 1 + next);
      }
    };
    if (loft.capStart !== false) cap(0, -1);
    if (loft.capEnd !== false) cap(loft.rings.length - 1, 1);
  }

  return skin;
};

/**
 * Darken what faces away from the sky.
 *
 * The level gets this from its lighting; a figure standing in it needs the
 * same thing baked in, because a person is mostly curved and a curve lit by
 * one key and one fill still comes out flatter than the eye expects. This
 * is the occlusion a body casts on itself: under the jaw, under the vest,
 * inside the arms.
 */
export const bakeAmbient = (skin: Skin, floor: number): void => {
  for (let i = 0; i < skin.colors.length; i += 4) {
    const up = skin.normals[(i / 4) * 3 + 1];
    const shade = floor + (1 - floor) * (up * 0.5 + 0.5);
    skin.colors[i] *= shade;
    skin.colors[i + 1] *= shade;
    skin.colors[i + 2] *= shade;
  }
};
