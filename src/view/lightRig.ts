import type { MapStyle } from "../maps/types";

/**
 * The level's lights, as numbers.
 *
 * Two of them: one directional key and one hemispheric fill, plus a flat
 * ambient. The engine builds real lights from this for anything drawn lit,
 * and the retro look bakes the same numbers straight into the level's
 * vertices instead. Both read from here, so a wall comes out the same shade
 * whichever way it was lit and a figure standing against it is lit to match.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface LightRig {
  /** The way the key light travels, unit length. */
  key: [number, number, number];
  keyColour: Rgb;
  keyIntensity: number;
  /** The axis the fill is centred on, unit length. */
  fillAxis: [number, number, number];
  /** What the fill is overhead, and what it is from below. */
  skyColour: Rgb;
  groundColour: Rgb;
  fillIntensity: number;
  ambient: Rgb;
}

/**
 * How far the hemispheric fill leans off vertical, as a tangent.
 *
 * It leans across the sun rather than with it. Upright, with a sun this
 * steep, three of the five ways a face can point come out at the same
 * value: the wall the sun misses and both walls side-on to it all sit at
 * the midpoint of the hemisphere, so a corner between two of them
 * disappears. Leaning it across gives those two side walls the sky and the
 * ground respectively, which separates them by a good part of the fill's
 * whole range, and costs nothing on the two walls the sun already sorts out.
 * Far enough for that; short enough that the floor is still the brightest
 * thing in the level and the sky is still overhead.
 */
export const FILL_LEAN = 0.46;

export const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
};

const unit = (x: number, y: number, z: number): [number, number, number] => {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
};

export const lightRigFor = (style: MapStyle): LightRig => {
  const key = unit(style.keyDirection.x, style.keyDirection.y, style.keyDirection.z);
  // Across the sun on the ground: the key's horizontal turned a quarter.
  const flat = Math.hypot(key[0], key[2]);
  const acrossX = flat > 1e-6 ? -key[2] / flat : 0;
  const acrossZ = flat > 1e-6 ? key[0] / flat : 0;
  return {
    key,
    keyColour: rgb(style.keyLight),
    keyIntensity: style.keyIntensity,
    fillAxis: unit(acrossX * FILL_LEAN, 1, acrossZ * FILL_LEAN),
    skyColour: rgb(style.skyLight),
    groundColour: rgb(style.groundLight),
    fillIntensity: style.fillIntensity,
    ambient: rgb(style.ambient),
  };
};

/**
 * What the rig makes of a surface facing one way, before any texture.
 *
 * The same sum the engine's standard material does: the ambient, the fill
 * blended from ground to sky by how far the face turns towards the fill's
 * axis, and the key by how squarely the face meets it.
 */
export const lightAt = (rig: LightRig, nx: number, ny: number, nz: number): Rgb => {
  const towardsFill = nx * rig.fillAxis[0] + ny * rig.fillAxis[1] + nz * rig.fillAxis[2];
  const overhead = towardsFill * 0.5 + 0.5;
  const facingKey = Math.max(0, -(nx * rig.key[0] + ny * rig.key[1] + nz * rig.key[2]));
  const fill = rig.fillIntensity;
  const key = rig.keyIntensity * facingKey;
  return {
    r:
      rig.ambient.r +
      (rig.groundColour.r + (rig.skyColour.r - rig.groundColour.r) * overhead) * fill +
      rig.keyColour.r * key,
    g:
      rig.ambient.g +
      (rig.groundColour.g + (rig.skyColour.g - rig.groundColour.g) * overhead) * fill +
      rig.keyColour.g * key,
    b:
      rig.ambient.b +
      (rig.groundColour.b + (rig.skyColour.b - rig.groundColour.b) * overhead) * fill +
      rig.keyColour.b * key,
  };
};
