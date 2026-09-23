import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import "@babylonjs/core/Meshes/instancedMesh";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import type { AmmoPickup } from "../sim/zombies";

/**
 * Ammunition on the ground: a small crate with a band that glows.
 *
 * It has to be found at night, in mist, among bodies, so the band is lit
 * from inside rather than by the torch, and the crate turns and bobs so the
 * eye catches it moving. In its last few seconds it blinks, which is the
 * only warning a player gets that it is about to go.
 *
 * Two source meshes, instanced per crate: however many are lying about,
 * they cost two draw calls.
 */

const BLINK_SECONDS = 5;

interface Crate {
  root: TransformNode;
  parts: InstancedMesh[];
  /** Seconds since it appeared, for the bob and the spin. */
  age: number;
}

export class PickupField {
  private readonly body: Mesh;
  private readonly band: Mesh;
  private readonly crates = new Map<string, Crate>();

  constructor(private readonly scene: Scene) {
    const bodyMaterial = new StandardMaterial("mat_ammo_body", scene);
    bodyMaterial.diffuseColor = Color3.FromHexString("#56613a");
    bodyMaterial.emissiveColor = Color3.FromHexString("#1a1d10");
    bodyMaterial.specularColor = new Color3(0.2, 0.2, 0.18);
    bodyMaterial.freeze();
    const bandMaterial = new StandardMaterial("mat_ammo_band", scene);
    bandMaterial.disableLighting = true;
    bandMaterial.emissiveColor = Color3.FromHexString("#ffc94d");
    bandMaterial.freeze();

    this.body = CreateBox("ammo_body", { width: 0.4, height: 0.22, depth: 0.24 }, scene);
    this.body.material = bodyMaterial;
    this.band = CreateBox("ammo_band", { width: 0.41, height: 0.05, depth: 0.25 }, scene);
    this.band.material = bandMaterial;
    for (const source of [this.body, this.band]) {
      source.isPickable = false;
      source.setEnabled(false);
    }
  }

  /** Show exactly these pickups, creating and removing crates to match. */
  render(pickups: readonly AmmoPickup[], deltaSeconds: number): void {
    const live = new Set<string>();
    for (const pickup of pickups) {
      live.add(pickup.id);
      let crate = this.crates.get(pickup.id);
      if (!crate) {
        const root = new TransformNode(`ammo_${pickup.id}`, this.scene);
        const parts = [this.body, this.band].map((source) => {
          const part = source.createInstance(`${source.name}_${pickup.id}`);
          part.parent = root;
          part.isPickable = false;
          return part;
        });
        crate = { root, parts, age: 0 };
        this.crates.set(pickup.id, crate);
      }
      crate.age += deltaSeconds;
      const bob = 0.22 + Math.sin(crate.age * 2.4) * 0.05;
      crate.root.position.set(pickup.position.x, pickup.position.y + bob, pickup.position.z);
      crate.root.rotation.y = crate.age * 1.3;
      const blinking = pickup.life < BLINK_SECONDS && Math.floor(pickup.life * 6) % 2 === 0;
      crate.root.setEnabled(!blinking);
    }
    for (const [id, crate] of this.crates) {
      if (live.has(id)) continue;
      for (const part of crate.parts) part.dispose();
      crate.root.dispose();
      this.crates.delete(id);
    }
  }

  clear(): void {
    this.render([], 0);
  }
}
