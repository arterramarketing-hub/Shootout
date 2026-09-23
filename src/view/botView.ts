import { Bone } from "@babylonjs/core/Bones/bone";
import { Skeleton } from "@babylonjs/core/Bones/skeleton";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { ContactShadows } from "./contactShadow";
import { FALL_SECONDS, figurePose } from "./figurePose";
import { BONES, FIGURE_HEIGHT, TEAM_PALETTES, soldierSkin } from "./soldier";
import type { BotState, Team } from "../sim/bots";
import type { Vec3 } from "../sim/vec3";
import { damp } from "../sim/vec3";

/**
 * Combatant figures: one skinned soldier per body on the field.
 *
 * The shape is in `soldier.ts` and the movement is in `figurePose.ts`, both
 * engine-free. What is here is the wiring: a skeleton whose rest pose is the
 * pose that shape was drawn in, a single mesh bound to it, and a per-frame
 * pass that turns the game's idea of a figure — where it is, how fast it is
 * moving, whether it is dead — into angles on seventeen bones.
 *
 * One mesh, one material, one draw call per figure, where the blocky figure
 * it replaces took four. The geometry is built once per team and shared by
 * every figure on that team; only the skeleton is per figure, because that
 * is the only part of it that differs from one frame to the next.
 *
 * The head sits where the head hitbox is and the body where the body hitbox
 * is: the figure is drawn to the shape that is shot, not the other way
 * round.
 */

/**
 * The two sides, as the colours that carry them.
 *
 * Both sides now wear the same kit, so these are doing the whole job on
 * their own. That makes the distance between them, and between each of them
 * and everything in the level, a correctness problem rather than a matter
 * of taste: a player who cannot tell who shot them has been failed by these
 * two numbers. `tests/teamContrast.test.ts` measures them in a space where
 * distance means what the eye means by it, against every colour the level
 * paints and every tint it applies.
 *
 * What separates them is saturation as much as hue. The world is a
 * washed-out place -- nothing in it above forty-five per cent saturated and
 * most of it under ten -- so a strong colour on a figure reads against all
 * of it at once, at any distance, in sun or in shade. They are no louder
 * than they have to be, and finding out how loud that was took quieting the
 * level first.
 */
export const TEAM_COLOURS: Record<Team, { body: string; trim: string }> = {
  a: { body: TEAM_PALETTES.a.uniform, trim: TEAM_PALETTES.a.lens },
  b: { body: TEAM_PALETTES.b.uniform, trim: TEAM_PALETTES.b.lens },
};

/** How long a figure lies on the ground before it is taken away. */
const FALLEN_SECONDS = 3.2;

export interface BotBinding {
  id: string;
  team: Team;
  root: TransformNode;
  /** Yaw is smoothed for rendering so figures do not snap between frames. */
  renderYaw: number;
  mesh: Mesh;
  skeleton: Skeleton;
  /** Bones by name, so the pose can be applied without searching. */
  bones: Map<string, Bone>;
  /** Where the figure was last frame, for working out how fast it walks. */
  lastPosition: Vec3;
  /** The stride, advanced by distance walked. */
  stride: number;
  /** How much of the walk cycle is showing, eased so a stop does not snap. */
  gait: number;
  dead: boolean;
  deathTime: number;
  /** Which way it fell: to its left or its right. */
  fallSide: number;
  /** Seconds since the figure appeared, so idles are out of step. */
  clock: number;
  /** The shadow laid on the ground, where the tier has no shadow map. */
  patch: Mesh | null;
}

/** Geometry and material for one team, built once and shared by every figure. */
interface TeamBuild {
  source: Mesh;
  material: StandardMaterial;
}

export class BotField {
  readonly bindings: BotBinding[] = [];
  /** Called with every mesh a new figure is built from, for shadow casting. */
  onFigure: ((mesh: Mesh) => void) | null = null;
  private readonly byId = new Map<string, BotBinding>();
  private readonly builds = new Map<Team, TeamBuild>();
  private readonly spin = new Quaternion();
  /**
   * Set where the sun casts no shadow map, so figures still read as
   * standing on something.
   */
  private readonly contact: ContactShadows | null;

  constructor(
    private readonly scene: Scene,
    contact: ContactShadows | null = null,
  ) {
    this.contact = contact;
  }

  /**
   * The mesh and material for a team, made on first sight of one.
   *
   * The source mesh is never drawn. Figures are instances cloned from it,
   * which share its vertex buffers, so a team of six costs one upload.
   */
  private build(team: Team): TeamBuild {
    const existing = this.builds.get(team);
    if (existing) return existing;

    const skin = soldierSkin(team);
    const source = new Mesh(`soldier_${team}`, this.scene);
    const data = new VertexData();
    data.positions = skin.positions;
    data.normals = skin.normals;
    data.colors = skin.colors;
    data.indices = skin.indices;
    data.matricesIndices = skin.boneIndices;
    data.matricesWeights = skin.boneWeights;
    data.applyToMesh(source);
    source.setEnabled(false);

    // Colour lives in the vertices, so one material covers a whole soldier:
    // uniform, carrier, skin, boots and rifle in a single draw.
    const material = new StandardMaterial(`mat_soldier_${team}`, this.scene);
    material.diffuseColor = new Color3(1, 1, 1);
    material.ambientColor = new Color3(1, 1, 1);
    material.specularColor = new Color3(0.06, 0.06, 0.06);
    material.specularPower = 28;
    material.freeze();
    source.material = material;

    const built = { source, material };
    this.builds.set(team, built);
    return built;
  }

  /**
   * A skeleton whose rest pose is the pose the geometry was drawn in.
   *
   * Each bone's local matrix is the offset from its parent's joint and
   * nothing else, so a skeleton with every bone at rest reproduces the mesh
   * exactly as it was built, and every angle the pose asks for is a
   * departure from a soldier standing up rather than from a star shape.
   */
  private makeSkeleton(id: string): { skeleton: Skeleton; bones: Map<string, Bone> } {
    const skeleton = new Skeleton(`skel_${id}`, `skel_${id}`, this.scene);
    const made: Bone[] = [];
    const bones = new Map<string, Bone>();
    for (const spec of BONES) {
      const parent = spec.parent < 0 ? null : made[spec.parent];
      const anchor = spec.parent < 0 ? { x: 0, y: 0, z: 0 } : BONES[spec.parent].at;
      const local = Matrix.Translation(
        spec.at.x - anchor.x,
        spec.at.y - anchor.y,
        spec.at.z - anchor.z,
      );
      const bone = new Bone(spec.name, skeleton, parent, local);
      made.push(bone);
      bones.set(spec.name, bone);
    }
    return { skeleton, bones };
  }

  /** A figure for anyone the local player can see: a bot or a remote player. */
  add(id: string, team: Team, position: Vec3, yaw: number): BotBinding {
    const root = new TransformNode(`figure_${id}`, this.scene);
    root.position.set(position.x, position.y, position.z);

    const { source, material } = this.build(team);
    const mesh = source.clone(`soldier_${id}`, root);
    mesh.setEnabled(true);
    mesh.material = material;
    // Hit detection runs against the shared world's boxes, not against
    // meshes, so the server can reach the same answer.
    mesh.isPickable = false;
    // Two bones reach any vertex: one on each side of a joint is all a limb
    // needs, and it halves what the vertex shader does per figure.
    mesh.numBoneInfluencers = 2;

    const { skeleton, bones } = this.makeSkeleton(id);
    mesh.skeleton = skeleton;

    if (this.onFigure) this.onFigure(mesh);

    // The patch is not parented to the figure: it belongs to the ground, and
    // a figure that goes down must not take the ground with it.
    const patch = this.contact?.create() ?? null;
    if (patch) this.contact?.place(patch, position.x, position.y, position.z, FIGURE_HEIGHT);

    const binding: BotBinding = {
      id,
      team,
      root,
      patch,
      mesh,
      skeleton,
      bones,
      renderYaw: yaw,
      dead: false,
      deathTime: 0,
      fallSide: 1,
      lastPosition: { ...position },
      stride: 0,
      gait: 0,
      clock: (id.charCodeAt(id.length - 1) % 32) * 0.19,
    };
    this.bindings.push(binding);
    this.byId.set(id, binding);
    return binding;
  }

  /** Push one frame of the pose onto a figure's bones. */
  private applyPose(binding: BotBinding, speed: number, pitch: number): void {
    const pose = figurePose({
      stride: binding.stride,
      speed,
      gait: binding.gait,
      pitch,
      dying: binding.dead ? binding.deathTime : null,
      fallSide: binding.fallSide,
      clock: binding.clock,
    });
    for (const [name, joint] of Object.entries(pose.joints)) {
      const bone = binding.bones.get(name);
      if (!bone) continue;
      Quaternion.RotationYawPitchRollToRef(joint.yaw, joint.pitch, joint.roll, this.spin);
      // Local space: the rotation replaces the bone's own, and the offset
      // from its parent that the rest pose set is kept.
      bone.setRotationQuaternion(this.spin, 0);
    }
    binding.mesh.position.set(pose.sway, pose.bob, 0);
  }

  /** Place one figure. Creates it on first sight. */
  place(
    id: string,
    team: Team,
    position: Vec3,
    yaw: number,
    dead: boolean,
    deltaSeconds: number,
  ): void {
    const binding = this.byId.get(id) ?? this.add(id, team, position, yaw);
    binding.clock += deltaSeconds;
    if (dead) {
      this.fall(binding, deltaSeconds);
      binding.lastPosition = { ...position };
      return;
    }
    if (binding.dead) {
      // Back on their feet, somewhere else: stand the figure up before it
      // is seen again.
      binding.dead = false;
      binding.root.rotation.x = 0;
      binding.root.rotation.z = 0;
      binding.root.setEnabled(true);
    }
    binding.root.position.set(position.x, position.y, position.z);
    if (binding.patch && this.contact) {
      binding.patch.setEnabled(true);
      this.contact.place(binding.patch, position.x, position.y, position.z, FIGURE_HEIGHT);
    }
    binding.renderYaw = dampAngle(binding.renderYaw, yaw, deltaSeconds);
    binding.root.rotation.y = binding.renderYaw;

    // The walk cycle is driven by the distance actually covered, so the feet
    // keep time with the ground whatever speed the figure is moving at.
    const moved = Math.hypot(
      position.x - binding.lastPosition.x,
      position.z - binding.lastPosition.z,
    );
    binding.lastPosition = { ...position };
    const speed = deltaSeconds > 0 ? moved / deltaSeconds : 0;
    // One full cycle — two steps — per metre and a half, which is a walking
    // pace, and is what keeps the boots from sliding across the ground.
    binding.stride += moved * 4.2;
    binding.gait = damp(binding.gait, Math.min(1, speed / 2.6), 0.001, deltaSeconds);
    this.applyPose(binding, speed, 0);
  }

  /**
   * Put a figure down where it died.
   *
   * The knees go first and the weight follows them, because a body does not
   * tip over like a plank: it drops, and then it falls. The skeleton does
   * most of that; the root supplies the last of the roll and the drop to
   * the ground. The side is fixed per figure so a kill replayed on another
   * screen falls the same way.
   */
  private fall(binding: BotBinding, deltaSeconds: number): void {
    if (!binding.dead) {
      binding.dead = true;
      binding.deathTime = 0;
      binding.fallSide = binding.id.charCodeAt(binding.id.length - 1) % 2 === 0 ? 1 : -1;
    }
    binding.deathTime += deltaSeconds;
    if (binding.deathTime >= FALLEN_SECONDS) {
      binding.root.setEnabled(false);
      binding.patch?.setEnabled(false);
      return;
    }
    // The shadow gathers in as the figure goes down, because what was
    // standing up to cast it no longer is.
    if (binding.patch && this.contact) {
      const down = Math.min(1, binding.deathTime / FALL_SECONDS);
      const { x, y, z } = binding.root.position;
      this.contact.place(binding.patch, x, y, z, FIGURE_HEIGHT * (1 - down * 0.72), 1 + down * 0.3);
    }
    const t = Math.min(1, binding.deathTime / FALL_SECONDS);
    // Fast out, easing into the ground: most of the fall happens early.
    const eased = 1 - (1 - t) * (1 - t) * (1 - t);
    binding.root.rotation.z = binding.fallSide * eased * 1.16;
    binding.root.rotation.x = eased * 0.2;
    this.applyPose(binding, 0, 0);
  }

  /** Remove every figure whose id is not in the given set. */
  retain(ids: Set<string>): void {
    for (const binding of [...this.bindings]) {
      if (ids.has(binding.id)) continue;
      binding.skeleton.dispose();
      binding.root.dispose(false, true);
      binding.patch?.dispose();
      this.byId.delete(binding.id);
      this.bindings.splice(this.bindings.indexOf(binding), 1);
    }
  }

  clear(): void {
    this.retain(new Set());
  }

  /** Push local bot state into the scene. */
  renderBots(bots: readonly BotState[], deltaSeconds: number): void {
    for (const bot of bots) {
      this.place(bot.id, bot.team, bot.position, bot.yaw, bot.health.dead, deltaSeconds);
    }
  }
}

/** Smooth a yaw toward a target the short way round. */
const dampAngle = (current: number, target: number, deltaSeconds: number): number => {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return damp(current, current + delta, 0.0000005, deltaSeconds);
};
