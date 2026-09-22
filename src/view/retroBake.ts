import type { BrushGeometry } from "./brushGeometry";
import { lightAt, type LightRig } from "./lightRig";

/**
 * Lighting baked into the level's vertices, for the retro look.
 *
 * The hardware this look is after lit nothing per pixel. A level's light was
 * worked out once, at the vertices, and the triangles between them were
 * filled by blending it across; a wall facing the sun was a brighter wall
 * and that was the whole of it. Doing the same here takes every lit
 * fragment off the phone: the level's shader has nothing left to do but
 * look a colour up and multiply it.
 *
 * Nothing in this file touches the engine. It takes the geometry a brush is
 * built from, the way the brush is turned, and the rig's numbers, and
 * writes the light into the colour channel the edge shading already lives
 * in.
 */

/** Rotate a direction the way the engine rotates a mesh set to (pitch, yaw, 0). */
export const rotateNormal = (
  nx: number,
  ny: number,
  nz: number,
  pitch: number,
  yaw: number,
): [number, number, number] => {
  // The engine's yaw-pitch-roll quaternion, applied as any quaternion is.
  // Written out this way rather than as two axis rotations so that there is
  // no convention to get wrong: this is the same arithmetic the engine runs.
  const hy = yaw * 0.5;
  const hp = pitch * 0.5;
  const sy = Math.sin(hy);
  const cy = Math.cos(hy);
  const sp = Math.sin(hp);
  const cp = Math.cos(hp);
  const qx = cy * sp;
  const qy = sy * cp;
  const qz = -sy * sp;
  const qw = cy * cp;
  // v' = q v q*, expanded.
  const ix = qw * nx + qy * nz - qz * ny;
  const iy = qw * ny + qz * nx - qx * nz;
  const iz = qw * nz + qx * ny - qy * nx;
  const iw = -qx * nx - qy * ny - qz * nz;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
};

/**
 * How far past white the best-lit face is pushed before it is clamped.
 *
 * The modern look clamps its lighting at white and then lifts the whole
 * picture by this much in its grade, so a sunlit floor saturates and every
 * other face rides up with it. The bake has no grade, so it does the same
 * lift here: without it the retro level came out a third darker than the
 * modern one under the same sun.
 */
export const LIFT = 1.25;

/**
 * How dark the least-lit direction is allowed to go, as a fraction of the
 * best-lit, before the lift.
 *
 * The rig's numbers run from a sunlit floor at the top to the underside of
 * a slab at a quarter of it. The modern materials never show that range,
 * because they clamp the sum at white and nearly every face reaches it; an
 * underside there is nine tenths of a floor. Period vertex lighting is
 * meant to show a range — a wall the sun misses is plainly a darker wall,
 * and that is most of what makes the look read as lit at all — but the
 * whole of it left the shadowed side of the level black. A floor under the
 * range keeps every face readable and keeps the order between them.
 */
const SHADE_FLOOR = 0.3;

/**
 * How much to scale the rig's light by so the best-lit direction is one.
 *
 * The rig's numbers are set for the engine's own materials, which clamp what
 * they add up; multiplied straight into a colour they would blow everything
 * out. Scaled so the best-lit of the six axis directions lands at one,
 * everything else is a shade of that.
 */
export const exposureFor = (rig: LightRig): number => {
  let brightest = 0;
  for (const [x, y, z] of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]) {
    const light = lightAt(rig, x, y, z);
    brightest = Math.max(brightest, light.r, light.g, light.b);
  }
  return brightest > 0 ? 1 / brightest : 1;
};

/**
 * Multiply the rig's light into a brush's vertex colours.
 *
 * The geometry is built about its own origin and turned when it is placed,
 * so the normals it carries are turned the same way here before they meet
 * the light. The colours already hold the edge shading; the light multiplies
 * into them, so a shaded corner stays shaded and a sunlit one stays bright.
 */
export const bakeBrushLighting = (
  geometry: BrushGeometry,
  turn: { pitch?: number; yaw?: number },
  rig: LightRig,
  exposure: number,
  /** How much colour to push back into the light; one leaves it alone. */
  saturation = 1,
): void => {
  const pitch = turn.pitch ?? 0;
  const yaw = turn.yaw ?? 0;
  const count = geometry.normals.length / 3;
  for (let v = 0; v < count; v += 1) {
    const [nx, ny, nz] = rotateNormal(
      geometry.normals[v * 3],
      geometry.normals[v * 3 + 1],
      geometry.normals[v * 3 + 2],
      pitch,
      yaw,
    );
    // The era's light was coloured: a warm sun on one face and a cool sky
    // on the next, more than the modern grade lets through.
    const light = saturateRgb(lightAt(rig, nx, ny, nz), saturation);
    const i = v * 4;
    // Where the face sits between the darkest direction and the brightest,
    // held above the floor, then lifted the way the grade would have.
    const shade = (channel: number): number =>
      Math.min(1, LIFT * (SHADE_FLOOR + (1 - SHADE_FLOOR) * Math.min(1, channel * exposure)));
    geometry.colors[i] = Math.min(1, geometry.colors[i] * shade(light.r));
    geometry.colors[i + 1] = Math.min(1, geometry.colors[i + 1] * shade(light.g));
    geometry.colors[i + 2] = Math.min(1, geometry.colors[i + 2] * shade(light.b));
  }
};

/**
 * Push a colour's channels apart from its own lightness, in place.
 *
 * A factor of one leaves it alone; above one is more colour, below one is
 * less. Lightness is held, so a wall gets redder without getting brighter.
 */
export const saturate = (
  data: Uint8ClampedArray | Uint8Array | number[],
  factor: number,
): void => {
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    for (let c = 0; c < 3; c += 1) {
      data[i + c] = Math.max(0, Math.min(255, Math.round(lum + (data[i + c] - lum) * factor)));
    }
  }
};

/**
 * The same, for one colour as a light: unbounded above, because a light sum
 * runs well past one before it is exposed, and clipping it here would throw
 * the sunlit floor away before the exposure ever saw it.
 */
export const saturateRgb = (
  colour: { r: number; g: number; b: number },
  factor: number,
): { r: number; g: number; b: number } => {
  const lum = colour.r * 0.299 + colour.g * 0.587 + colour.b * 0.114;
  const push = (c: number): number => Math.max(0, lum + (c - lum) * factor);
  return { r: push(colour.r), g: push(colour.g), b: push(colour.b) };
};

/**
 * Quantise bytes to a few shades of lightness, leaving hue and alpha alone.
 *
 * A texture of a few dozen texels with every shade a byte can hold reads as
 * a photograph shrunk; the same texels held to six shades read as painted.
 * That is most of the difference between a small texture and a period one.
 *
 * It is the lightness that is quantised, not each channel on its own. A
 * grey a shade bluer than its neighbour, snapped channel by channel, lands
 * on a different rung in blue than in red and comes out purple; a brick a
 * shade warmer comes out yellow. Holding the channels in their ratio and
 * stepping only how light the texel is keeps a grey grey and a brick a
 * brick, in fewer shades of each.
 */
export const posterize = (
  data: Uint8ClampedArray | Uint8Array | number[],
  levels: number,
): void => {
  const steps = Math.max(2, Math.round(levels)) - 1;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    if (lum <= 0) continue;
    const quantised = (Math.round((lum / 255) * steps) / steps) * 255;
    const scale = quantised / lum;
    data[i] = Math.min(255, Math.round(r * scale));
    data[i + 1] = Math.min(255, Math.round(g * scale));
    data[i + 2] = Math.min(255, Math.round(b * scale));
  }
};
