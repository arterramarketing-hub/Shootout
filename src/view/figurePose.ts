/**
 * What the skeleton does, frame by frame.
 *
 * Kept away from the engine for the same reason the shape is: a walk cycle
 * is a set of angles over time, and angles over time can be checked. The
 * old figure swung two boxes about their hips and called it walking. This
 * drives a spine, two arms, two legs with knees, and ankles that keep the
 * boots flat on the ground, from one phase and one speed.
 *
 * Every angle is in radians, about the joint's own axes, and is added to the
 * skeleton's rest pose rather than replacing it. The rest pose is already a
 * soldier standing with a rifle up, so a figure with every number here at
 * zero is not a mannequin: it is a soldier standing still.
 */

/** What one bone is asked to do this frame. */
export interface JointPose {
  /** Swing about the side-to-side axis: forward and back. */
  pitch: number;
  /** About the vertical: turning. */
  yaw: number;
  /** About the front-to-back axis: leaning sideways. */
  roll: number;
}

export interface FigurePose {
  /** Lift and drop of the whole figure, in metres. */
  bob: number;
  /** Sway of the whole figure, in metres, side to side. */
  sway: number;
  joints: Record<string, JointPose>;
}

export interface PoseInput {
  /** Where the figure is in its stride, in radians. */
  stride: number;
  /** Metres per second over the ground. */
  speed: number;
  /** Nought to one: how much of the walk cycle is showing at all. */
  gait: number;
  /** Where the figure is looking, in radians. Positive is up. */
  pitch: number;
  /** Seconds since it went down, or null if it is still standing. */
  dying: number | null;
  /** Which way it falls. */
  fallSide: number;
  /** Seconds since the figure appeared, for the idle to be out of step. */
  clock: number;
  /** A zombie's walk rather than a soldier's. */
  shamble?: boolean;
  /**
   * How far through a swing a zombie is, nought to one, or null when it is
   * not swinging: the arms go up for the first part and come down after.
   */
  swing?: number | null;
}

const flat = (): JointPose => ({ pitch: 0, yaw: 0, roll: 0 });

/** How long the figure takes to reach the ground. */
export const FALL_SECONDS = 0.55;

/**
 * The stride, as a set of angles.
 *
 * A leg does not swing like a pendulum. It reaches forward almost straight,
 * plants, passes under the body with the knee folded to clear the ground,
 * then drives back. So the knee is not in phase with the hip: it folds
 * hardest a little after the foot leaves the ground, and is nearly straight
 * at the moment of the plant. Getting that one offset right is most of the
 * difference between walking and skating.
 */
const legSwing = (phase: number, reach: number): { hip: number; knee: number; ankle: number } => {
  const hip = Math.sin(phase) * reach;
  // Folded through the swing, straight through the stance.
  const fold = Math.max(0, Math.sin(phase - 1.1));
  const knee = -fold * fold * reach * 2.1;
  // The ankle takes up what is left, so the boot stays flat as it passes,
  // and lifts the toe to clear the ground by an amount that goes with how
  // far the leg is reaching. Scaled by the reach rather than fixed: a
  // figure at a halt has a reach of nought, and a cocked foot on a soldier
  // standing still is worse than no toe lift at all.
  const ankle = -(hip + knee) * 0.32 - fold * 0.18 * reach;
  return { hip, knee, ankle };
};

/**
 * Everything the skeleton is asked to do this frame.
 *
 * Returns only the joints that have moved; anything absent stays at rest.
 */
export const figurePose = (input: PoseInput): FigurePose => {
  const joints: Record<string, JointPose> = {};
  const set = (name: string, pose: Partial<JointPose>): void => {
    joints[name] = { ...flat(), ...pose };
  };

  if (input.dying !== null) {
    // Going down. The knees buckle first and the weight follows them: a body
    // does not tip over like a plank, it drops and then falls.
    const t = Math.min(1, input.dying / FALL_SECONDS);
    const collapse = 1 - (1 - t) * (1 - t) * (1 - t);
    const buckle = Math.min(1, t / 0.45);
    set("pelvis", { roll: input.fallSide * collapse * 0.5, pitch: collapse * 0.22 });
    set("spine", { roll: input.fallSide * collapse * 0.34, pitch: collapse * 0.3 });
    set("chest", { roll: input.fallSide * collapse * 0.26, pitch: collapse * 0.26 });
    set("head", { pitch: collapse * 0.4, roll: -input.fallSide * collapse * 0.3 });
    for (const side of ["R", "L"] as const) {
      const lead = side === "R" ? 1 : 0.7;
      set(`thigh${side}`, { pitch: -buckle * 0.95 * lead });
      set(`shin${side}`, { pitch: buckle * 1.5 * lead });
      set(`foot${side}`, { pitch: -buckle * 0.3 });
      set(`arm${side}`, { pitch: collapse * 0.5, roll: side === "R" ? 0.4 : -0.4 });
      set(`fore${side}`, { pitch: -collapse * 0.7 });
    }
    return { bob: -collapse * 0.42, sway: input.fallSide * collapse * 0.16, joints };
  }

  if (input.shamble) return shamblePose(input, joints, set);

  const gait = Math.max(0, Math.min(1, input.gait));
  // How far the legs reach. A walk is a short stride; a run opens it up.
  const reach = (0.28 + Math.min(1, input.speed / 6.5) * 0.3) * gait;
  const right = legSwing(input.stride, reach);
  const left = legSwing(input.stride + Math.PI, reach);

  set("thighR", { pitch: right.hip });
  set("shinR", { pitch: -right.knee });
  set("footR", { pitch: right.ankle });
  set("thighL", { pitch: left.hip });
  set("shinL", { pitch: -left.knee });
  set("footL", { pitch: left.ankle });

  // Hips roll onto the standing leg and turn with the stride; the chest
  // turns back against them, which is what stops a walk reading as a shuffle.
  const hipTurn = Math.sin(input.stride) * 0.1 * gait;
  const breathe = Math.sin(input.clock * 1.5) * 0.012;
  set("pelvis", {
    yaw: hipTurn,
    roll: -Math.cos(input.stride) * 0.06 * gait,
    pitch: 0.02 + breathe,
  });
  set("spine", { yaw: -hipTurn * 0.7, pitch: -input.pitch * 0.2 + breathe });
  set("chest", { yaw: -hipTurn * 0.5, pitch: -input.pitch * 0.35 - gait * 0.06 });
  // The head stays level and keeps looking where the figure is looking, so
  // the rest of the body can move under it.
  set("head", {
    pitch: -input.pitch * 0.45,
    yaw: hipTurn * 0.4,
    roll: Math.cos(input.stride) * 0.03 * gait,
  });

  // The arms are on the rifle, so they mostly ride the chest. What is left
  // is the small counter-swing that keeps them from looking welded on.
  const armSwing = Math.sin(input.stride) * 0.08 * gait;
  set("armR", { pitch: -armSwing, yaw: -hipTurn * 0.3 });
  set("armL", { pitch: armSwing, yaw: -hipTurn * 0.3 });
  set("foreR", { pitch: Math.abs(armSwing) * 0.5 });
  set("foreL", { pitch: Math.abs(armSwing) * 0.5 });

  return {
    // Two bobs per stride: the body rises over each standing leg.
    bob: -Math.abs(Math.cos(input.stride)) * 0.028 * gait + breathe * 0.4,
    sway: Math.sin(input.stride) * 0.018 * gait,
    joints,
  };
};

/**
 * A zombie's walk.
 *
 * Hunched, head lolling, one leg dragging behind the other, and the arms out
 * in front bobbing with the step instead of swinging against it. The hunch
 * is kept small on purpose: the head hitbox does not bend with the spine,
 * and a head drawn well in front of where it is shot is a miss the player
 * did not earn.
 */
const shamblePose = (
  input: PoseInput,
  joints: Record<string, JointPose>,
  set: (name: string, pose: Partial<JointPose>) => void,
): FigurePose => {
  const gait = Math.max(0, Math.min(1, input.gait));
  const reach = (0.22 + Math.min(1, input.speed / 5) * 0.34) * gait;
  // The good leg steps out; the bad one comes after it, shorter and stiffer.
  const right = legSwing(input.stride, reach);
  const left = legSwing(input.stride + Math.PI, reach * 0.62);
  set("thighR", { pitch: right.hip });
  set("shinR", { pitch: -right.knee });
  set("footR", { pitch: right.ankle });
  set("thighL", { pitch: left.hip, roll: -0.05 });
  set("shinL", { pitch: -left.knee * 0.5 });
  set("footL", { pitch: left.ankle + 0.12 * gait });

  const loll = Math.sin(input.clock * 0.9) * 0.14;
  const lurch = Math.sin(input.stride) * 0.12 * gait;
  set("pelvis", { yaw: lurch * 0.6, roll: -Math.cos(input.stride) * 0.1 * gait, pitch: 0.04 });
  set("spine", { pitch: 0.12, roll: lurch * 0.4 });
  set("chest", { pitch: 0.08, yaw: -lurch * 0.5, roll: 0.05 });
  set("head", { pitch: -0.16 - input.pitch * 0.3, roll: 0.18 + loll, yaw: -loll * 0.5 });

  // Out in front, rising and falling with each step, out of step with each
  // other. A swing lifts them both and brings them down together.
  const bobR = Math.sin(input.stride * 2) * 0.05 * gait + Math.sin(input.clock * 1.3) * 0.03;
  const bobL = Math.sin(input.stride * 2 + 1.3) * 0.05 * gait + Math.sin(input.clock * 1.1) * 0.03;
  let raise = 0;
  if (input.swing !== undefined && input.swing !== null) {
    const t = Math.max(0, Math.min(1, input.swing));
    // Up over the first sixty per cent, down hard after it.
    raise = t < 0.6 ? -(t / 0.6) * 0.75 : -0.75 + ((t - 0.6) / 0.4) * 1.2;
  }
  set("armR", { pitch: bobR + raise, yaw: -0.04 });
  set("armL", { pitch: bobL + raise, yaw: 0.04 });
  set("foreR", { pitch: -0.08 + Math.abs(bobR) * 0.5 });
  set("foreL", { pitch: -0.04 + Math.abs(bobL) * 0.5 });

  return {
    bob: -Math.abs(Math.cos(input.stride)) * 0.045 * gait,
    sway: Math.sin(input.stride) * 0.04 * gait,
    joints,
  };
};
