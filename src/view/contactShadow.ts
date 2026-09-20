import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Scene } from "@babylonjs/core/scene";

/**
 * A shadow on the ground for someone standing on it, drawn rather than cast.
 *
 * Two jobs, and they are not the same job.
 *
 * The player gets one on every tier, because in first person there is
 * nobody there to cast a real one: the camera is the whole character, so the
 * sun crosses the street, every crate and every other figure lays a shadow
 * over it, and the one person the player is certain is standing there leaves
 * the ground untouched. It is the kind of absence nobody names and everybody
 * notices.
 *
 * Everyone else gets one only where the tier has no shadow map to cast with.
 * There it is doing the one thing a real shadow does that nothing else does,
 * which is say where the feet are: without it a figure in the street and a
 * figure a step above it on a slab are the same picture, and every shot at
 * range is a guess.
 *
 * It is laid along the sun rather than dropped straight down, and stretched
 * by how low the sun is, so it falls the same way as every cast shadow
 * around it. What it cannot do is climb a wall or break over a kerb. At the
 * length these are -- a metre and a half from the feet of someone standing
 * in the open -- that almost never comes up, and a soft patch lying the
 * right way is a great deal closer to right than nothing at all.
 *
 * One texture and one material for all of them, so the cost is a draw call
 * per figure on screen and nothing else.
 */

const SIZE = 64;
/** How wide a standing figure's shadow is across the sun's line, in metres. */
const WIDTH = 1.05;
/** Past this the projection is too long to be believed and is held back. */
const MAX_STRETCH = 2.6;

/** A soft disc, darkest in the middle, drawn once and shared. */
const discTexture = (scene: Scene): Texture => {
  const texture = new DynamicTexture("contact_shadow", SIZE, scene, false);
  const context = texture.getContext() as unknown as CanvasRenderingContext2D;
  const middle = SIZE / 2;
  const gradient = context.createRadialGradient(middle, middle, 0, middle, middle, middle);
  // Soft at the rim: a hard edge reads as a sticker, and the ground under a
  // standing figure is not sharply edged even in full sun.
  gradient.addColorStop(0, "rgba(0, 0, 0, 0.58)");
  gradient.addColorStop(0.45, "rgba(0, 0, 0, 0.38)");
  gradient.addColorStop(0.78, "rgba(0, 0, 0, 0.11)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, SIZE, SIZE);
  texture.update(false);
  texture.hasAlpha = true;
  texture.wrapU = Texture.CLAMP_ADDRESSMODE;
  texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
};

export interface SunDirection {
  x: number;
  y: number;
  z: number;
}

export class ContactShadows {
  private readonly material: StandardMaterial;
  /** Which way along the ground a shadow runs, as a unit vector. */
  private readonly awayX: number;
  private readonly awayZ: number;
  /** Where the shadow runs, as a yaw. */
  private readonly bearing: number;
  /** Ground length per metre of height: how low the sun is. */
  private readonly stretch: number;

  constructor(private readonly scene: Scene, sun: SunDirection) {
    const material = new StandardMaterial("mat_contact_shadow", scene);
    material.diffuseTexture = discTexture(scene);
    material.useAlphaFromDiffuseTexture = true;
    material.diffuseColor = Color3.Black();
    material.specularColor = Color3.Black();
    material.emissiveColor = Color3.Black();
    material.disableLighting = true;
    // It lies on the ground it darkens, so it must not write depth or it
    // fights the floor it is a fraction above.
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    material.freeze();
    this.material = material;

    // The key light points the way the light travels, so a shadow runs the
    // same way along the ground. A sun directly overhead would divide by
    // nothing and a sun on the horizon would run to the far wall, so the
    // stretch is held inside what a shadow on a street looks like.
    const flat = Math.hypot(sun.x, sun.z) || 1e-6;
    this.awayX = sun.x / flat;
    this.awayZ = sun.z / flat;
    this.bearing = Math.atan2(this.awayX, this.awayZ);
    const drop = Math.max(0.2, Math.abs(sun.y));
    this.stretch = Math.min(MAX_STRETCH, flat / drop);
  }

  /** A patch for one figure, laid flat and turned along the sun. */
  create(): Mesh {
    const mesh = MeshBuilder.CreatePlane("contact_shadow", { size: 1 }, this.scene);
    mesh.material = this.material;
    mesh.rotation.set(Math.PI / 2, this.bearing, 0);
    mesh.isPickable = false;
    return mesh;
  }

  /**
   * Lay one patch out for a figure of a given height standing at a point.
   *
   * `feetY` is the ground the figure is standing on, not the middle of it:
   * a figure on a slab casts on the slab.
   */
  place(mesh: Mesh, x: number, feetY: number, z: number, height: number, spread = 1): void {
    const length = height * this.stretch;
    // The shadow of a standing figure runs from the feet outward, so its
    // middle is half its length along the sun.
    const reach = (length - WIDTH) / 2;
    mesh.position.set(x + this.awayX * reach, feetY + 0.03, z + this.awayZ * reach);
    mesh.scaling.set(WIDTH * spread, length * spread, 1);
  }
}
