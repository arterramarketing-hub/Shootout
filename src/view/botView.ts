import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BotState, Team } from "../sim/bots";
import type { Vec3 } from "../sim/vec3";
import { damp } from "../sim/vec3";

/**
 * Combatant figures, built from primitives.
 *
 * Original shapes: a soldier of blocks with a helmet, a plate carrier, a pack,
 * boots, and a rifle held across the chest, whose legs swing as it moves.
 * The silhouette is what matters at the ranges these fights happen at —
 * helmet, shoulders, the rifle across the front — and the team reads from
 * the colour of the body and the trim.
 *
 * The head sits where the head hitbox is, and the body where the body hitbox
 * is; the figure is drawn to the shape that is shot, not the other way round.
 */
const TEAM_COLOURS: Record<Team, { body: string; trim: string }> = {
  a: { body: "#4f7fa8", trim: "#9fd0ee" },
  b: { body: "#a8654f", trim: "#eeb08f" },
};

/** Gear that is the same on both sides: boots, pack, webbing, rifle. */
const GEAR = "#2b2a2c";
const HEAD_HEIGHT = 1.62;
const HIP_HEIGHT = 0.92;

interface Part {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  tone: "body" | "trim" | "gear";
  /** Radians about the part's own centre, yaw then pitch. */
  yaw?: number;
  pitch?: number;
}

const box = (part: Part): Part => part;

/**
 * A limb: a box laid from one point to another, which is how arms are put
 * on the rifle without working the angles out by hand.
 */
const limb = (from: Vec3, to: Vec3, thickness: number, tone: Part["tone"]): Part => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  return {
    x: (from.x + to.x) / 2,
    y: (from.y + to.y) / 2,
    z: (from.z + to.z) / 2,
    width: thickness,
    height: thickness,
    depth: length,
    tone,
    yaw: Math.atan2(dx, dz),
    pitch: -Math.atan2(dy, Math.hypot(dx, dz)),
  };
};

/** Everything that does not move: torso, arms, gear, and the rifle. */
const BODY: Part[] = [
  // Belt and hips.
  box({ x: 0, y: 0.98, z: 0, width: 0.42, height: 0.16, depth: 0.26, tone: "gear" }),
  // Torso, with the plate carrier on the front and the pack on the back.
  box({ x: 0, y: 1.26, z: 0, width: 0.44, height: 0.4, depth: 0.26, tone: "body" }),
  box({ x: 0, y: 1.25, z: 0.15, width: 0.34, height: 0.32, depth: 0.06, tone: "trim" }),
  box({ x: 0, y: 1.22, z: -0.17, width: 0.3, height: 0.3, depth: 0.12, tone: "gear" }),
  // Shoulders and neck.
  box({ x: -0.28, y: 1.4, z: 0, width: 0.16, height: 0.14, depth: 0.24, tone: "body" }),
  box({ x: 0.28, y: 1.4, z: 0, width: 0.16, height: 0.14, depth: 0.24, tone: "body" }),
  box({ x: 0, y: 1.48, z: 0, width: 0.12, height: 0.08, depth: 0.12, tone: "body" }),
  // Arms: upper arm from the shoulder to the elbow, forearm to the hand.
  limb({ x: 0.3, y: 1.38, z: 0 }, { x: 0.28, y: 1.14, z: 0.1 }, 0.13, "body"),
  limb({ x: 0.28, y: 1.14, z: 0.1 }, { x: 0.16, y: 1.22, z: 0.22 }, 0.11, "body"),
  limb({ x: -0.3, y: 1.38, z: 0 }, { x: -0.2, y: 1.18, z: 0.22 }, 0.13, "body"),
  limb({ x: -0.2, y: 1.18, z: 0.22 }, { x: 0.02, y: 1.28, z: 0.48 }, 0.11, "body"),
  // Hands.
  box({ x: 0.16, y: 1.22, z: 0.24, width: 0.1, height: 0.1, depth: 0.1, tone: "gear" }),
  box({ x: 0.02, y: 1.29, z: 0.5, width: 0.1, height: 0.1, depth: 0.1, tone: "gear" }),
  // The rifle, across the chest and out.
  box({ x: 0.08, y: 1.3, z: 0.38, width: 0.06, height: 0.09, depth: 0.5, tone: "gear" }),
  box({ x: 0.08, y: 1.31, z: 0.74, width: 0.035, height: 0.035, depth: 0.24, tone: "gear" }),
  box({ x: 0.08, y: 1.21, z: 0.34, width: 0.045, height: 0.14, depth: 0.07, tone: "gear" }),
  box({ x: 0.08, y: 1.3, z: 0.08, width: 0.05, height: 0.09, depth: 0.16, tone: "gear" }),
  box({ x: 0.08, y: 1.36, z: 0.3, width: 0.03, height: 0.04, depth: 0.05, tone: "gear" }),
];

/** The head, on the hitbox, with a helmet over it. */
const HEAD: Part[] = [
  box({ x: 0, y: HEAD_HEIGHT, z: 0, width: 0.22, height: 0.24, depth: 0.22, tone: "body" }),
  box({ x: 0, y: HEAD_HEIGHT + 0.09, z: 0, width: 0.27, height: 0.13, depth: 0.28, tone: "trim" }),
  box({ x: 0, y: HEAD_HEIGHT + 0.03, z: 0.13, width: 0.24, height: 0.04, depth: 0.08, tone: "trim" }),
  // Chin strap and the shadow of the face under the brim.
  box({ x: 0, y: HEAD_HEIGHT - 0.02, z: 0.1, width: 0.18, height: 0.1, depth: 0.03, tone: "gear" }),
];

/** One leg, built about its hip so it can swing. */
const legParts = (side: -1 | 1): Part[] => [
  box({ x: 0, y: -0.2, z: 0, width: 0.17, height: 0.4, depth: 0.2, tone: "body" }),
  box({ x: 0, y: -0.58, z: 0.01, width: 0.15, height: 0.4, depth: 0.17, tone: "body" }),
  box({ x: 0, y: -0.85, z: 0.05, width: 0.19, height: 0.14, depth: 0.3, tone: "gear" }),
  // A knee pad, which is the kind of detail that reads at ten metres.
  box({ x: side * 0.0, y: -0.4, z: 0.1, width: 0.15, height: 0.14, depth: 0.05, tone: "gear" }),
];

export interface BotBinding {
  id: string;
  team: Team;
  root: TransformNode;
  /** Yaw is smoothed for rendering so figures do not snap between frames. */
  renderYaw: number;
  meshes: Mesh[];
  legs: [Mesh, Mesh];
  /** Where the figure was last frame, for working out how fast it walks. */
  lastPosition: Vec3;
  /** The stride, advanced by distance walked. */
  stride: number;
  /** Current leg swing, eased so a stop does not freeze mid-step. */
  swing: number;
}

export class BotField {
  readonly bindings: BotBinding[] = [];
  /** Called with every mesh a new figure is built from, for shadow casting. */
  onFigure: ((mesh: Mesh) => void) | null = null;
  private readonly byId = new Map<string, BotBinding>();
  private readonly materials = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  /** A figure for anyone the local player can see: a bot or a remote player. */
  add(id: string, team: Team, position: Vec3, yaw: number): BotBinding {
    const root = new TransformNode(`figure_${id}`, this.scene);
    root.position.set(position.x, position.y, position.z);

    const colours = TEAM_COLOURS[team];
    const tones = {
      body: this.material(`bot_${team}_body`, colours.body),
      trim: this.material(`bot_${team}_trim`, colours.trim),
      gear: this.material("bot_gear", GEAR),
    };

    const build = (name: string, parts: Part[]): Mesh => {
      // Each part is baked into place, then everything merges into one mesh
      // that keeps a submesh per material: one figure, four draw calls.
      const built = parts.map((part, index) => {
        const mesh = MeshBuilder.CreateBox(
          `${name}_${index}`,
          { width: part.width, height: part.height, depth: part.depth },
          this.scene,
        );
        mesh.bakeTransformIntoVertices(
          Matrix.RotationYawPitchRoll(part.yaw ?? 0, part.pitch ?? 0, 0).multiply(
            Matrix.Translation(part.x, part.y, part.z),
          ),
        );
        mesh.material = tones[part.tone];
        return mesh;
      });
      const merged = Mesh.MergeMeshes(built, true, true, undefined, false, true) as Mesh;
      merged.name = name;
      merged.parent = root;
      // Purely visual: hit detection runs against the shared world's boxes,
      // not against meshes, so the server can reach the same answer.
      merged.isPickable = false;
      return merged;
    };

    const body = build(`bot_${id}_body`, BODY);
    const head = build(`bot_${id}_head`, HEAD);
    const legLeft = build(`bot_${id}_leg_l`, legParts(-1));
    const legRight = build(`bot_${id}_leg_r`, legParts(1));
    legLeft.position.set(-0.12, HIP_HEIGHT, 0);
    legRight.position.set(0.12, HIP_HEIGHT, 0);

    const meshes = [body, head, legLeft, legRight];
    if (this.onFigure) for (const mesh of meshes) this.onFigure(mesh);

    const binding: BotBinding = {
      id,
      team,
      root,
      renderYaw: yaw,
      meshes,
      legs: [legLeft, legRight],
      lastPosition: { ...position },
      stride: 0,
      swing: 0,
    };
    this.bindings.push(binding);
    this.byId.set(id, binding);
    return binding;
  }

  private material(key: string, hex: string): StandardMaterial {
    const existing = this.materials.get(key);
    if (existing) return existing;
    const material = new StandardMaterial(`mat_${key}`, this.scene);
    const colour = Color3.FromHexString(hex);
    material.diffuseColor = colour;
    material.ambientColor = colour;
    material.specularColor = new Color3(0.04, 0.04, 0.04);
    material.emissiveColor = colour.scale(0.08);
    material.freeze();
    this.materials.set(key, material);
    return material;
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
    binding.root.setEnabled(!dead);
    if (dead) {
      binding.lastPosition = { ...position };
      return;
    }
    binding.root.position.set(position.x, position.y, position.z);
    binding.renderYaw = dampAngle(binding.renderYaw, yaw, deltaSeconds);
    binding.root.rotation.y = binding.renderYaw;

    // Walk cycle, driven by the distance actually covered so the feet keep
    // time with the ground whatever speed the figure is moving at.
    const moved = Math.hypot(position.x - binding.lastPosition.x, position.z - binding.lastPosition.z);
    binding.lastPosition = { ...position };
    const speed = deltaSeconds > 0 ? moved / deltaSeconds : 0;
    binding.stride += moved * 2.6;
    const target = Math.min(1, speed / 3.5);
    binding.swing = damp(binding.swing, target, 0.001, deltaSeconds);
    const angle = Math.sin(binding.stride) * 0.6 * binding.swing;
    binding.legs[0].rotation.x = angle;
    binding.legs[1].rotation.x = -angle;
  }

  /** Remove every figure whose id is not in the given set. */
  retain(ids: Set<string>): void {
    for (const binding of [...this.bindings]) {
      if (ids.has(binding.id)) continue;
      binding.root.dispose(false, true);
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
