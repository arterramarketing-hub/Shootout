import "@babylonjs/core/Meshes/Builders/boxBuilder";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { STANCE } from "../sim/config";
import { eyeOffset } from "../sim/player";
import type { PlayerState } from "../sim/types";
import type { DamageableMetadata } from "./hitscanWorld";

export const PLAYER_ID = "player";

/**
 * Invisible hitboxes that follow the player.
 *
 * Bots resolve their shots through the same hitscan path the player uses, so
 * the player needs geometry to be hit. One shared path means cover, range
 * falloff and headshots behave identically in both directions; a separate
 * "did the bot hit the player" test would inevitably drift from it.
 */
export class PlayerHitbox {
  private readonly body: Mesh;
  private readonly head: Mesh;

  constructor(scene: Scene) {
    const bodyMeta: DamageableMetadata = { targetId: PLAYER_ID, isHead: false };
    const headMeta: DamageableMetadata = { targetId: PLAYER_ID, isHead: true };

    this.body = MeshBuilder.CreateBox(
      "player_hitbox_body",
      { width: STANCE.radius * 2, height: 1.3, depth: STANCE.radius * 2 },
      scene,
    );
    this.head = MeshBuilder.CreateBox(
      "player_hitbox_head",
      { width: 0.26, height: 0.26, depth: 0.26 },
      scene,
    );

    for (const mesh of [this.body, this.head]) {
      mesh.isVisible = false;
      mesh.isPickable = true;
      // Never solid: this is a target, not an obstacle the player collides with.
      mesh.checkCollisions = false;
    }
    this.body.metadata = { damageable: bodyMeta };
    this.head.metadata = { damageable: headMeta };
  }

  update(player: PlayerState, alive: boolean): void {
    this.body.isPickable = alive;
    this.head.isPickable = alive;
    if (!alive) return;

    const eye = player.position.y + eyeOffset(player);
    this.body.position.set(player.position.x, eye - 0.72, player.position.z);
    this.head.position.set(player.position.x, eye + 0.02, player.position.z);
  }
}
