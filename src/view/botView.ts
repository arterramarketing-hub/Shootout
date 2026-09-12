import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { BotState, Team } from "../sim/bots";
import { damp } from "../sim/vec3";

/**
 * Blocked-out combatant figures, built from primitives.
 *
 * Original shapes, and deliberately abstract: a readable silhouette and a
 * clear head box is all Phase 2 needs to tune fights. Team identity comes from
 * value and hue, so the two sides are told apart at a glance even in the
 * darker corners of the level.
 */
const TEAM_COLOURS: Record<Team, { body: string; trim: string }> = {
  a: { body: "#4f7fa8", trim: "#8fc4e8" },
  b: { body: "#a8654f", trim: "#e8a68f" },
};

const PARTS = {
  torso: { y: 1.12, width: 0.46, height: 0.68, depth: 0.28 },
  hips: { y: 0.7, width: 0.4, height: 0.24, depth: 0.26 },
  head: { y: 1.62, width: 0.24, height: 0.26, depth: 0.24 },
  legLeft: { x: -0.12, y: 0.3, width: 0.16, height: 0.6, depth: 0.2 },
  legRight: { x: 0.12, y: 0.3, width: 0.16, height: 0.6, depth: 0.2 },
  armLeft: { x: -0.3, y: 1.15, width: 0.13, height: 0.55, depth: 0.16 },
  armRight: { x: 0.3, y: 1.15, width: 0.13, height: 0.55, depth: 0.16 },
  weapon: { x: 0.22, y: 1.2, z: 0.34, width: 0.08, height: 0.1, depth: 0.5 },
} as const;

export interface BotBinding {
  bot: BotState;
  root: TransformNode;
  /** Yaw is smoothed for rendering so bots do not snap between frames. */
  renderYaw: number;
  meshes: Mesh[];
}

export class BotField {
  readonly bindings: BotBinding[] = [];
  private readonly materials = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  add(bot: BotState): BotBinding {
    const root = new TransformNode(`bot_${bot.id}`, this.scene);
    root.position.set(bot.position.x, bot.position.y, bot.position.z);

    const colours = TEAM_COLOURS[bot.team];
    const body = this.material(`bot_${bot.team}_body`, colours.body);
    const trim = this.material(`bot_${bot.team}_trim`, colours.trim);
    const gun = this.material("bot_weapon", "#2b2f35");

    // Build every body part, then merge them into one mesh. Eight draw calls
    // per bot is a real cost with ten on screen; the head stays separate
    // because it needs its own hitbox for headshots.
    const bodyParts: Mesh[] = [
      PARTS.torso, PARTS.hips, PARTS.legLeft, PARTS.legRight, PARTS.armLeft, PARTS.armRight,
    ].map((spec, index) => {
      const mesh = MeshBuilder.CreateBox(
        `bot_${bot.id}_part_${index}`,
        { width: spec.width, height: spec.height, depth: spec.depth },
        this.scene,
      );
      mesh.position.set("x" in spec ? (spec as { x: number }).x : 0, spec.y, 0);
      return mesh;
    });

    const meshes: Mesh[] = [];
    const merged = Mesh.MergeMeshes(bodyParts, true, true, undefined, false, false);
    if (merged) {
      merged.name = `bot_${bot.id}_body`;
      merged.material = body;
      merged.parent = root;
      merged.isPickable = true;
      merged.metadata = { damageable: { targetId: bot.id, isHead: false } };
      meshes.push(merged);
    }

    const head = MeshBuilder.CreateBox(
      `bot_${bot.id}_head`,
      { width: PARTS.head.width, height: PARTS.head.height, depth: PARTS.head.depth },
      this.scene,
    );
    head.position.set(0, PARTS.head.y, 0);
    head.material = trim;
    head.parent = root;
    head.isPickable = true;
    head.metadata = { damageable: { targetId: bot.id, isHead: true } };
    meshes.push(head);

    const gunMesh = MeshBuilder.CreateBox(
      `bot_${bot.id}_weapon`,
      { width: PARTS.weapon.width, height: PARTS.weapon.height, depth: PARTS.weapon.depth },
      this.scene,
    );
    gunMesh.position.set(PARTS.weapon.x, PARTS.weapon.y, PARTS.weapon.z);
    gunMesh.material = gun;
    gunMesh.parent = root;
    // The weapon is scenery, not a hitbox: shooting a rifle should not count.
    gunMesh.isPickable = false;
    meshes.push(gunMesh);

    const binding: BotBinding = { bot, root, renderYaw: bot.yaw, meshes };
    this.bindings.push(binding);
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

  /** Push simulation state into the scene. */
  render(deltaSeconds: number): void {
    for (const binding of this.bindings) {
      const { bot, root } = binding;
      const dead = bot.health.dead;
      root.setEnabled(!dead);
      // Hitboxes follow the body: a downed bot must not soak rounds.
      for (const mesh of binding.meshes) mesh.isPickable = !dead && mesh.metadata != null;
      if (dead) continue;

      root.position.set(bot.position.x, bot.position.y, bot.position.z);
      binding.renderYaw = dampAngle(binding.renderYaw, bot.yaw, deltaSeconds);
      root.rotation.y = binding.renderYaw;
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
