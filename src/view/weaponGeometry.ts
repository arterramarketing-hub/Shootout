import type { WeaponId } from "../sim/weapons";

/**
 * The shapes the weapon viewmodels are built from, and the maths for asking
 * where they sit on the screen.
 *
 * Kept free of any engine import so the one rule the viewmodel has to obey —
 * that the weapon never covers what the player is shooting at — can be
 * checked against the actual geometry rather than against a remembered number.
 * The renderer builds its boxes from exactly these specs, so a test that walks
 * them is testing the weapon the player sees.
 */

const DEG_TO_RAD = Math.PI / 180;

export interface Part {
  /** Local offset from the weapon's grip, in metres. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  tone: "body" | "metal" | "accent";
  /**
   * Marks the sight post.
   *
   * Aiming deliberately parks this part on the screen centre — that is what
   * aiming is — so it is the one piece of the weapon excused from the rule
   * that nothing may cover the crosshair.
   */
  role?: "sight";
}

export interface ModelSpec {
  parts: Part[];
  /**
   * Where the sight sits. Aiming lines this point up with the screen centre,
   * which is what makes the transition read as looking down the weapon.
   */
  sight: { x: number; y: number; z: number };
  /** Where the muzzle flash sits, at the front of the barrel. */
  muzzle: { y: number; z: number };
}

/**
 * Local space runs from the rear of the receiver forward.
 *
 * No shoulder stock is modelled. On a real weapon it sits against the
 * shooter, which in first person means behind the camera, and modelling it
 * only puts geometry a few centimetres from the near plane where perspective
 * blows it up until it covers the screen.
 */
export const MODELS: Record<WeaponId, ModelSpec> = {
  ar: {
    parts: [
      { x: 0, y: 0.012, z: 0.17, width: 0.062, height: 0.085, depth: 0.34, tone: "body" },
      { x: 0, y: 0.004, z: 0.40, width: 0.050, height: 0.055, depth: 0.16, tone: "accent" },
      { x: 0, y: 0.030, z: 0.46, width: 0.032, height: 0.032, depth: 0.26, tone: "metal" },
      { x: 0, y: -0.105, z: 0.15, width: 0.046, height: 0.17, depth: 0.10, tone: "accent" },
      { x: 0, y: -0.072, z: 0.02, width: 0.044, height: 0.13, depth: 0.10, tone: "body" },
      { x: 0, y: 0.072, z: 0.30, width: 0.018, height: 0.030, depth: 0.026, tone: "metal", role: "sight" },
    ],
    sight: { x: 0, y: 0.078, z: 0.30 },
    muzzle: { y: 0.030, z: 0.60 },
  },
  smg: {
    parts: [
      { x: 0, y: 0.010, z: 0.13, width: 0.058, height: 0.078, depth: 0.26, tone: "body" },
      { x: 0, y: 0.026, z: 0.33, width: 0.028, height: 0.028, depth: 0.14, tone: "metal" },
      { x: 0, y: -0.118, z: 0.12, width: 0.040, height: 0.20, depth: 0.072, tone: "accent" },
      { x: 0, y: -0.068, z: 0.01, width: 0.042, height: 0.12, depth: 0.098, tone: "body" },
      { x: 0, y: 0.066, z: 0.22, width: 0.016, height: 0.026, depth: 0.024, tone: "metal", role: "sight" },
    ],
    sight: { x: 0, y: 0.072, z: 0.22 },
    muzzle: { y: 0.026, z: 0.41 },
  },
  shotgun: {
    parts: [
      { x: 0, y: 0.010, z: 0.18, width: 0.060, height: 0.078, depth: 0.34, tone: "body" },
      // Barrel sunk into the receiver line and sighted over a raised rib. A
      // long barrel level with the sight leaves the muzzle a degree under the
      // crosshair, which is authentic and unplayable: the first shot of a
      // burst then puts the barrel over the target.
      { x: 0, y: 0.024, z: 0.50, width: 0.040, height: 0.036, depth: 0.30, tone: "metal" },
      { x: 0, y: -0.032, z: 0.44, width: 0.068, height: 0.052, depth: 0.15, tone: "accent" },
      { x: 0, y: -0.068, z: 0.03, width: 0.044, height: 0.12, depth: 0.10, tone: "body" },
      { x: 0, y: 0.070, z: 0.60, width: 0.015, height: 0.026, depth: 0.022, tone: "metal", role: "sight" },
      { x: 0, y: 0.050, z: 0.60, width: 0.010, height: 0.024, depth: 0.018, tone: "metal", role: "sight" },
    ],
    sight: { x: 0, y: 0.080, z: 0.60 },
    muzzle: { y: 0.024, z: 0.66 },
  },
  pistol: {
    parts: [
      { x: 0, y: 0.020, z: 0.08, width: 0.040, height: 0.062, depth: 0.20, tone: "metal" },
      { x: 0, y: -0.004, z: 0.19, width: 0.028, height: 0.028, depth: 0.06, tone: "metal" },
      { x: 0, y: -0.088, z: 0.0, width: 0.038, height: 0.15, depth: 0.082, tone: "accent" },
      { x: 0, y: 0.056, z: 0.15, width: 0.013, height: 0.019, depth: 0.019, tone: "metal", role: "sight" },
    ],
    sight: { x: 0, y: 0.058, z: 0.15 },
    muzzle: { y: -0.004, z: 0.23 },
  },
};

/**
 * Where the weapon rests in the hands.
 *
 * The z figure is what keeps the weapon in proportion. Its parts run from
 * roughly a quarter metre behind the origin to two thirds of a metre ahead,
 * so a small z puts the stock level with the eye, where perspective blows
 * the near end up until it swallows the screen.
 */
export const POSE = {
  /** Hip-fire rest pose, right of centre and low. */
  hip: { x: 0.13, y: -0.095, z: 0.40 },
  /** Pulled in and tilted when sprinting, so the sights are plainly unusable. */
  sprint: { x: 0.14, y: -0.15, z: 0.32 },
  sprintRoll: -0.42,
  sprintPitch: 0.30,
  sprintYaw: 0.34,
  /** Lowered and rolled during a reload. */
  reload: { x: 0.11, y: -0.23, z: 0.34 },
  reloadRoll: 0.55,
  reloadPitch: 0.42,
  /** Dropped out of frame while a swap is in progress. */
  swap: { x: 0.105, y: -0.40, z: 0.36 },
  swapPitch: 0.55,
  /** Distance the weapon sits at when aimed. */
  aimZ: 0.30,
} as const;

/**
 * Where the weapon is held at a given aim progress, from the hip at 0 to fully
 * down the sights at 1.
 *
 * Aiming cancels the sight's own offset rather than blending toward a guessed
 * pose, which is what lines every weapon's sight up on the screen centre
 * exactly. Shared with the renderer so a test of what the player can see is
 * looking at the pose the player actually gets.
 */
export const holdPosition = (
  spec: ModelSpec,
  ads: number,
): { x: number; y: number; z: number } => {
  const aim = Math.min(1, Math.max(0, ads));
  return {
    x: POSE.hip.x + (-spec.sight.x - POSE.hip.x) * aim,
    y: POSE.hip.y + (-spec.sight.y - POSE.hip.y) * aim,
    z: POSE.hip.z + (POSE.aimZ - POSE.hip.z) * aim,
  };
};

/**
 * Where the weapon is held: the position and rotation the viewmodel writes
 * onto the model root each frame, in the camera's own frame.
 */
export interface WeaponPose {
  x: number;
  y: number;
  z: number;
  /** Radians, as the node's rotation: negative pitches the muzzle up. */
  pitch: number;
  yaw: number;
  roll: number;
}

type Vec = [number, number, number];

/**
 * Undo the renderer's rotation — roll, then pitch, then yaw, in Babylon's
 * left-handed frame — to carry the view ray into the weapon's own space.
 */
const unrotate = (v: Vec, yaw: number, pitch: number, roll: number): Vec => {
  let [x, y, z] = v;
  const cr = Math.cos(-roll);
  const sr = Math.sin(-roll);
  [x, y] = [x * cr - y * sr, x * sr + y * cr];
  const cp = Math.cos(-pitch);
  const sp = Math.sin(-pitch);
  [y, z] = [y * cp - z * sp, y * sp + z * cp];
  const cy = Math.cos(-yaw);
  const sy = Math.sin(-yaw);
  [x, z] = [x * cy + z * sy, -x * sy + z * cy];
  return [x, y, z];
};

/** Does the ray straight out of the middle of the screen strike this box? */
const rayHitsPart = (part: Part, pose: WeaponPose): boolean => {
  // Carry the ray into the weapon's own frame instead of turning eight
  // corners: in there the box is axis aligned and the test is three slabs.
  const origin = unrotate(
    [-pose.x, -pose.y, -pose.z],
    pose.yaw,
    pose.pitch,
    pose.roll,
  );
  const direction = unrotate([0, 0, 1], pose.yaw, pose.pitch, pose.roll);

  const half: Vec = [part.width / 2, part.height / 2, part.depth / 2];
  const centre: Vec = [part.x, part.y, part.z];

  let near = 0;
  let far = Number.POSITIVE_INFINITY;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis];
    const d = direction[axis];
    const min = centre[axis] - half[axis];
    const max = centre[axis] + half[axis];
    if (Math.abs(d) < 1e-9) {
      // Parallel to this pair of faces: either inside them or missing outright.
      if (o < min || o > max) return false;
      continue;
    }
    const t1 = (min - o) / d;
    const t2 = (max - o) / d;
    near = Math.max(near, Math.min(t1, t2));
    far = Math.min(far, Math.max(t1, t2));
    if (near > far) return false;
  }
  return far >= near;
};

/**
 * Is any solid part of the weapon sitting on the screen centre?
 *
 * The sight post is exempt, because putting it there is the whole point of
 * aiming. Everything else covering that point means the player has lost sight
 * of what they are shooting at.
 */
export const coversCentre = (spec: ModelSpec, pose: WeaponPose): boolean =>
  spec.parts.some((part) => part.role !== "sight" && rayHitsPart(part, pose));

/** The largest muzzle rise the search below will look for, in degrees. */
const SEARCH_LIMIT_DEGREES = 60;

/**
 * How much further the muzzle could rise from this pose before the weapon
 * covers the crosshair, in degrees.
 *
 * This is the headroom a shot has to spend. It is measured rather than
 * asserted because it depends on the whole pose — how far the weapon has been
 * pulled back, how high it is held, which weapon it is — and every one of
 * those is a number somebody may reasonably want to change.
 */
export const riseHeadroomDegrees = (spec: ModelSpec, pose: WeaponPose): number => {
  const at = (degrees: number): boolean =>
    coversCentre(spec, { ...pose, pitch: pose.pitch - degrees * DEG_TO_RAD });

  if (at(0)) return 0;
  if (!at(SEARCH_LIMIT_DEGREES)) return Number.POSITIVE_INFINITY;

  let clear = 0;
  let covered = SEARCH_LIMIT_DEGREES;
  for (let i = 0; i < 40; i += 1) {
    const middle = (clear + covered) / 2;
    if (at(middle)) covered = middle;
    else clear = middle;
  }
  return clear;
};

/**
 * How far a weapon's muzzle can rise from its rest pose, at a given point in
 * the aim, before its body reaches the crosshair.
 *
 * This is the number recoil has to live inside, and it is a property of the
 * weapon's own shape: a long barrel under a low sight has almost none, a
 * stubby one with a raised post has plenty. From the hip it is unbounded,
 * because the weapon is held off to the side and never passes in front of the
 * crosshair at all. Deriving it rather than writing it down means a change to
 * a model changes the recoil budget with it, instead of quietly spending
 * clearance that is no longer there.
 *
 * Sampled and cached, because it is wanted every frame and depends on nothing
 * that changes within one. The aim is rounded upward to the next sample: the
 * weapon rises and centres as it comes up, so a later point in the aim always
 * has less room, and rounding that way can only be cautious.
 */
export const headroomDegrees = (spec: ModelSpec, ads: number): number => {
  let samples = HEADROOM_CACHE.get(spec);
  if (!samples) {
    samples = new Float64Array(HEADROOM_SAMPLES + 1).fill(Number.NaN);
    HEADROOM_CACHE.set(spec, samples);
  }
  const aim = Math.min(1, Math.max(0, ads));
  const index = Math.ceil(aim * HEADROOM_SAMPLES);
  const known = samples[index];
  if (!Number.isNaN(known)) return known;

  const rest = holdPosition(spec, index / HEADROOM_SAMPLES);
  const measured = riseHeadroomDegrees(spec, { ...rest, pitch: 0, yaw: 0, roll: 0 });
  samples[index] = measured;
  return measured;
};

const HEADROOM_SAMPLES = 64;
const HEADROOM_CACHE = new WeakMap<ModelSpec, Float64Array>();

/** The headroom a weapon has with the sights fully up, where it is tightest. */
export const aimedHeadroomDegrees = (spec: ModelSpec): number => headroomDegrees(spec, 1);
