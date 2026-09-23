import type { Vec3 } from "../sim/vec3";
import { bakeAmbient, buildSkin, type Loft, type Skin } from "./loft";
import { BONES, at, block, limb, ring, type BoneSpec } from "./soldier";

/**
 * The dead that walk, for survival.
 *
 * Built the same way as the soldier and driven by the same seventeen bones,
 * so the walk, the fall and the shadow all come for free. What differs is
 * everything that tells a player at thirty metres what they are looking at:
 * no helmet, no carrier, no rifle; a bare head with dark sockets; torn work
 * clothes over grey-green skin; and arms held out in front, reaching.
 *
 * The arms are drawn reaching rather than posed there, which is why the
 * skeleton is a copy of the soldier's with the elbows and wrists moved. A
 * bone turns about its joint, so the joint has to be where the elbow in the
 * mesh is, or a forearm swings about a point in the air beside it.
 *
 * Original work from numbers in this file, like the soldier.
 */

/** The soldier's skeleton with the arms out in front instead of on a rifle. */
export const ZOMBIE_BONES: BoneSpec[] = BONES.map((bone) => {
  const moved: Record<string, Vec3> = {
    foreR: at(0.2, 1.36, 0.26),
    handR: at(0.19, 1.32, 0.5),
    // The left arm hangs lower than the right. Symmetry reads as a mannequin.
    foreL: at(-0.2, 1.32, 0.23),
    handL: at(-0.2, 1.23, 0.45),
  };
  return moved[bone.name] ? { ...bone, at: moved[bone.name] } : bone;
});

const B: Record<string, number> = Object.fromEntries(
  ZOMBIE_BONES.map((bone, index) => [bone.name, index]),
);
const bone = (name: string): number => B[name];

export interface ZombiePalette {
  skin: string;
  /** Skin where it is sunken or bruised. */
  skinDeep: string;
  shirt: string;
  trousers: string;
  shoe: string;
  hair: string;
  /** Old blood, dried dark. */
  wound: string;
  /** The sockets, and the mouth. */
  hollow: string;
  /** What catches the light in the sockets. */
  eye: string;
}

/**
 * Three sets of clothes, so a crowd is not one figure repeated.
 *
 * The skin is the same on all of them and is what reads as "not a soldier"
 * before anything else does: a grey-green with no warmth in it, well away
 * from the blue and the rust the two teams wear. The last look goes to the
 * runners, so the fast ones can be picked out of a crowd.
 */
export const ZOMBIE_PALETTES: ZombiePalette[] = [
  {
    skin: "#8d9a74",
    skinDeep: "#66704f",
    shirt: "#7f7565",
    trousers: "#3f3b35",
    shoe: "#26231f",
    hair: "#2a2522",
    wound: "#5a1d18",
    hollow: "#1f1d17",
    eye: "#d9d37c",
  },
  {
    skin: "#879577",
    skinDeep: "#5f6a50",
    shirt: "#58687a",
    trousers: "#4a4d3d",
    shoe: "#221f1c",
    hair: "#4a3a2a",
    wound: "#561a16",
    hollow: "#1d1b16",
    eye: "#d9d37c",
  },
  {
    skin: "#96a07a",
    skinDeep: "#6b7353",
    shirt: "#8c3f2f",
    trousers: "#2f3137",
    shoe: "#1f1d1b",
    hair: "#1c1a18",
    wound: "#4f1612",
    hollow: "#1a1814",
    eye: "#f0e36a",
  },
];

export type ZombieLook = "zombie0" | "zombie1" | "zombie2";

export const isZombieLook = (look: string): look is ZombieLook =>
  look === "zombie0" || look === "zombie1" || look === "zombie2";

/** Which clothes a zombie wears: runners their own, the rest by id. */
export const zombieLook = (id: string, runner: boolean): ZombieLook => {
  if (runner) return "zombie2";
  return id.charCodeAt(id.length - 1) % 2 === 0 ? "zombie0" : "zombie1";
};

const lofts = (p: ZombiePalette): Loft[] => {
  const out: Loft[] = [];

  // Hips, in trousers.
  out.push({
    colour: p.trousers,
    sides: 12,
    rings: [
      ring(0, 0.85, 0.005, 0.14, 0.1, 0.8, bone("pelvis"), { shade: 0.86 }),
      ring(0, 0.94, 0.005, 0.148, 0.106, 0.8, bone("pelvis")),
      ring(0, 1.0, 0.004, 0.142, 0.102, 0.8, bone("pelvis"), {
        blendBone: bone("spine"),
        blend: 0.3,
      }),
    ],
    capEnd: false,
  });
  // Bare belly, where the shirt has torn away above the belt.
  out.push({
    colour: p.skinDeep,
    sides: 12,
    rings: [
      ring(0, 0.995, 0.004, 0.136, 0.097, 0.8, bone("pelvis"), {
        blendBone: bone("spine"),
        blend: 0.3,
      }),
      ring(0, 1.06, 0.003, 0.128, 0.092, 0.8, bone("spine"), { shade: 0.9 }),
    ],
    capStart: false,
    capEnd: false,
  });
  // The shirt, narrower in the shoulder than a soldier in kit.
  out.push({
    colour: p.shirt,
    sides: 12,
    rings: [
      ring(0, 1.05, 0.003, 0.138, 0.1, 0.78, bone("spine"), { shade: 0.8 }),
      ring(0, 1.12, 0.002, 0.136, 0.098, 0.8, bone("spine")),
      ring(0, 1.2, 0.001, 0.14, 0.1, 0.78, bone("spine"), {
        blendBone: bone("chest"),
        blend: 0.5,
      }),
      ring(0, 1.3, 0, 0.152, 0.106, 0.76, bone("chest")),
      ring(0, 1.4, -0.004, 0.172, 0.106, 0.7, bone("chest")),
      ring(0, 1.46, -0.006, 0.15, 0.096, 0.74, bone("chest"), { shade: 1.04 }),
    ],
    capStart: false,
  });
  // Old wounds on the shirt, front and back.
  out.push(
    block(at(0.05, 1.3, 0.103), at(0.045, 0.06, 0.008), bone("chest"), p.wound, 0.7),
    block(at(-0.06, 1.16, 0.098), at(0.035, 0.03, 0.007), bone("spine"), p.wound, 0.7),
    block(at(0.03, 1.36, -0.105), at(0.05, 0.045, 0.008), bone("chest"), p.wound, 0.7),
  );

  // Neck.
  out.push({
    colour: p.skinDeep,
    sides: 8,
    rings: [
      ring(0, 1.43, 0.004, 0.054, 0.054, 1, bone("chest"), {
        blendBone: bone("head"),
        blend: 0.4,
        shade: 0.8,
      }),
      ring(0, 1.5, 0.008, 0.05, 0.052, 1, bone("head"), { shade: 0.88 }),
    ],
    capStart: false,
    capEnd: false,
  });
  // The head: a bare skull under skin, gaunt at the cheek, no helmet.
  out.push({
    colour: p.skin,
    sides: 12,
    rings: [
      ring(0, 1.5, 0.012, 0.05, 0.058, 1, bone("head"), { shade: 0.78 }),
      ring(0, 1.54, 0.016, 0.066, 0.08, 0.95, bone("head"), { shade: 0.88 }),
      ring(0, 1.58, 0.012, 0.07, 0.088, 1, bone("head"), { shade: 0.94 }),
      ring(0, 1.63, 0.006, 0.079, 0.096, 1, bone("head")),
      ring(0, 1.68, 0, 0.078, 0.094, 1, bone("head"), { shade: 1.04 }),
      ring(0, 1.72, -0.006, 0.064, 0.076, 1, bone("head"), { shade: 1.06 }),
      ring(0, 1.748, -0.008, 0.038, 0.044, 1, bone("head")),
    ],
  });
  // What is left of the hair, over the crown and to one side.
  out.push({
    colour: p.hair,
    sides: 12,
    rings: [
      ring(-0.01, 1.675, -0.012, 0.083, 0.098, 1, bone("head"), { shade: 0.85 }),
      ring(-0.012, 1.72, -0.018, 0.068, 0.08, 1, bone("head")),
      ring(-0.014, 1.754, -0.02, 0.034, 0.04, 1, bone("head"), { shade: 1.05 }),
    ],
    capStart: false,
  });
  // Sunken sockets, a glint in each, and a slack mouth.
  for (const side of [-1, 1]) {
    out.push(
      block(at(side * 0.032, 1.63, 0.087), at(0.022, 0.016, 0.012), bone("head"), p.hollow, 0.8),
      block(at(side * 0.032, 1.63, 0.097), at(0.008, 0.006, 0.004), bone("head"), p.eye, 0.9),
    );
  }
  out.push(
    block(at(0, 1.555, 0.086), at(0.026, 0.02, 0.01), bone("head"), p.hollow, 0.7),
    block(at(0.004, 1.595, 0.094), at(0.012, 0.018, 0.012), bone("head"), p.skinDeep, 0.6),
  );

  // Arms, out in front: shirt sleeve to a torn elbow, then bare forearm and
  // a long hand.
  const arm = (suffix: "R" | "L", shoulder: Vec3, elbow: Vec3, wrist: Vec3): void => {
    const side = suffix === "R" ? 1 : -1;
    out.push(
      {
        colour: p.shirt,
        sides: 10,
        rings: [
          ring(side * 0.12, 1.445, -0.004, 0.064, 0.07, 1, bone("chest"), { shade: 1.02 }),
          ring(side * 0.19, 1.43, 0, 0.07, 0.074, 1, bone(`arm${suffix}`), {
            blendBone: bone("chest"),
            blend: 0.4,
          }),
        ],
        capStart: false,
        capEnd: false,
      },
      limb(shoulder, elbow, 0.058, 0.05, bone(`arm${suffix}`), bone(`fore${suffix}`), p.shirt, {
        steps: 3,
      }),
      limb(elbow, wrist, 0.04, 0.032, bone(`fore${suffix}`), bone(`hand${suffix}`), p.skin, {
        steps: 3,
      }),
      block(
        at(wrist.x, wrist.y - 0.01, wrist.z + 0.06),
        at(0.03, 0.018, 0.07),
        bone(`hand${suffix}`),
        p.skinDeep,
        0.6,
      ),
    );
  };
  arm("R", at(0.185, 1.43, 0), at(0.2, 1.36, 0.26), at(0.19, 1.32, 0.5));
  arm("L", at(-0.185, 1.43, 0), at(-0.2, 1.32, 0.23), at(-0.2, 1.23, 0.45));
  // A wound on the right forearm, where the sleeve came off.
  out.push(block(at(0.2, 1.36, 0.36), at(0.034, 0.02, 0.03), bone("foreR"), p.wound, 0.7));

  // Legs and shoes. One trouser leg is torn off at the knee.
  for (const suffix of ["R", "L"] as const) {
    const side = suffix === "R" ? 1 : -1;
    const hip = at(side * 0.095, 0.93, 0);
    const knee = at(side * 0.095, 0.5, 0.015);
    const ankle = at(side * 0.095, 0.1, 0);
    out.push(
      limb(hip, knee, 0.082, 0.058, bone(`thigh${suffix}`), bone(`shin${suffix}`), p.trousers, {
        steps: 4,
        squash: 0.94,
      }),
      limb(
        knee,
        ankle,
        suffix === "L" ? 0.046 : 0.058,
        suffix === "L" ? 0.036 : 0.044,
        bone(`shin${suffix}`),
        bone(`foot${suffix}`),
        suffix === "L" ? p.skinDeep : p.trousers,
        { steps: 3, squash: 0.92 },
      ),
      {
        colour: p.shoe,
        sides: 8,
        rings: [
          ring(side * 0.095, 0.085, -0.068, 0.044, 0.052, 0.5, bone(`foot${suffix}`), {
            shade: 0.82,
          }),
          ring(side * 0.095, 0.06, -0.02, 0.05, 0.058, 0.45, bone(`foot${suffix}`)),
          ring(side * 0.095, 0.045, 0.06, 0.05, 0.046, 0.4, bone(`foot${suffix}`)),
          ring(side * 0.095, 0.036, 0.11, 0.042, 0.036, 0.45, bone(`foot${suffix}`), {
            shade: 1.04,
          }),
        ],
      },
      {
        colour: suffix === "L" ? p.skinDeep : p.trousers,
        sides: 8,
        rings: [
          ring(side * 0.095, 0.09, -0.01, 0.05, 0.052, 0.8, bone(`foot${suffix}`), { shade: 0.9 }),
          ring(side * 0.095, 0.14, -0.006, 0.046, 0.048, 0.9, bone(`foot${suffix}`), {
            blendBone: bone(`shin${suffix}`),
            blend: 0.5,
          }),
        ],
        capEnd: false,
      },
    );
  }

  return out;
};

const LOOK_INDEX: Record<ZombieLook, number> = { zombie0: 0, zombie1: 1, zombie2: 2 };

/** One zombie's mesh, at rest, in one of the three sets of clothes. */
export const zombieSkin = (look: ZombieLook): Skin => {
  const skin = buildSkin(lofts(ZOMBIE_PALETTES[LOOK_INDEX[look]]));
  bakeAmbient(skin, 0.62);
  return skin;
};
