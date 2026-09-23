import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import "@babylonjs/core/Meshes/Builders/planeBuilder";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Constants } from "@babylonjs/core/Engines/constants";
import type { Scene } from "@babylonjs/core/scene";
import { activeWeapon, isSwapping, type LoadoutState } from "../sim/loadout";
import type { PlayerState } from "../sim/types";
import type { WeaponId } from "../sim/weapons";
import { clamp, damp } from "../sim/vec3";
import { createWeaponModels, type FinishPainter, type WeaponModel } from "./weaponModels";
import { RECOIL, recoilPose } from "./recoilPose";
import { POSE, headroomDegrees, holdPosition, COUNTER_SIZE } from "./weaponGeometry";
import type { Finish } from "../sim/cosmetics";

/** Meshes on this layer render only through the viewmodel camera. */
export const VIEWMODEL_LAYER = 0x20000000;
/** Everything else. Babylon's default mesh mask. */
export const WORLD_LAYER = 0x0fffffff;

/** How bright the weapon's own light is, in daylight. */
const VIEWMODEL_LIGHT = 0.75;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Vertical field of view for the weapon camera, in degrees.
 *
 * Specified vertically rather than converted from a horizontal figure:
 * Babylon's own field of view is vertical, and on a wide phone in landscape a
 * horizontal conversion produces a very narrow vertical angle, which pushes a
 * weapon held close to the camera straight off the bottom of the screen.
 */
export const VIEWMODEL_FOV_DEGREES = 45;

/**
 * How much of the world's aiming magnification the weapon camera takes.
 *
 * Narrowing the world's field of view is most of what makes a sight picture
 * feel closer, and if the weapon camera ignored that, the sights would stay
 * the same size while the target grew — the one thing they are supposed to be
 * measured against. Matching it exactly is too much the other way: the weapon
 * swells until it owns the screen. A share of it grows the sight picture
 * enough to aim with and leaves the weapon the size of a weapon.
 */
export const VIEWMODEL_ZOOM_SHARE = 0.6;

const BOLT = {
  /** Seconds for a full cycle, back and home again. */
  cycleSeconds: 0.075,
} as const;

const SWAY = {
  /** Metres of lag per radian of look movement. */
  positionPerRadian: 0.16,
  rotationPerRadian: 0.22,
  /** Clamp so a fast flick cannot throw the weapon off screen. */
  maxPosition: 0.055,
  maxRotation: 0.1,
  /** Fraction of the offset still present after one second. */
  smoothing: 0.0000001,
} as const;

const BOB = { amount: 0.016, roll: 0.022, frequency: 0.55 } as const;

/**
 * The weapon viewmodel.
 *
 * It renders through a second camera at a fixed narrow field of view. This is
 * the standard first-person shooter trick, and it matters more on a phone than
 * anywhere else: the world runs at a wide field of view so players can see
 * flanks, and a weapon drawn at that same angle would stretch into a fisheye.
 * Two cameras keep the world wide and the weapon in proportion.
 */
export class ViewmodelRig {
  private light!: HemisphericLight;
  readonly camera: FreeCamera;
  private readonly models: Record<WeaponId, WeaponModel>;
  private readonly painter: FinishPainter;
  /**
   * The weapon hangs off this node rather than off the camera.
   * Parenting directly to a Babylon camera inherits the camera's world
   * matrix, whose basis is not the plain right-up-forward frame the weapon
   * offsets are written in, and the weapon comes out mirrored and scaled.
   * A transform node carrying the camera's own position and rotation gives
   * exactly the frame these offsets expect.
   */
  private readonly holder: TransformNode;
  private readonly flash: Mesh;
  private flashLife = 0;
  /**
   * The ammunition count, projected off the side of the weapon.
   *
   * A small emissive plane with the count drawn on it, sitting high on the
   * left of the receiver and turned toward the eye, where it can be read from
   * the hip and past the rear sight when aiming. It is the reason the count
   * is not on the screen: the number lives on the thing it counts.
   */
  private readonly hologram: Mesh;
  private readonly hologramTexture: DynamicTexture;
  private hologramText = "";
  private hologramTime = 0;
  private current: WeaponId | null = null;

  private restFov = VIEWMODEL_FOV_DEGREES;
  private zoom = 1;
  private boltPhase = 1;

  private swayX = 0;
  private swayY = 0;
  private recoilAmount = 0;
  private recoilRoll = 0;
  private bobPhaseOffset = 0;
  private lastYaw = 0;
  private lastPitch = 0;

  private readonly position = new Vector3();
  private readonly rotation = new Vector3();

  constructor(scene: Scene, fovDegrees = VIEWMODEL_FOV_DEGREES) {
    this.camera = new FreeCamera("viewmodel_camera", Vector3.Zero(), scene);
    this.camera.layerMask = VIEWMODEL_LAYER;
    // The near plane sits as far out as the weapon allows, because the
    // distance between the two planes is what the depth buffer's precision is
    // spent on. At a centimetre against five metres, a phone's sixteen-bit
    // buffer cannot separate surfaces a millimetre apart, and the weapon is
    // made of parts that close together. Five centimetres costs nothing --
    // the nearest thing on the weapon is the butt of the stock, thirteen
    // centimetres out with the sights up -- and buys back a fivefold margin.
    this.camera.minZ = 0.05;
    this.camera.maxZ = 5;
    this.camera.inputs.clear();
    this.setFieldOfView(fovDegrees);

    // A dedicated light so the weapon reads the same in a dark corner as in
    // the open. Restricted to the viewmodel meshes so it cannot leak.
    const light = new HemisphericLight("vm_light", new Vector3(-0.3, 1, -0.6), scene);
    light.intensity = VIEWMODEL_LIGHT;
    this.light = light;
    light.diffuse = new Color3(0.95, 0.95, 1.0);
    light.groundColor = new Color3(0.3, 0.3, 0.34);
    light.includedOnlyMeshes = [];

    this.holder = new TransformNode("viewmodel_holder", scene);

    const built = createWeaponModels(scene, VIEWMODEL_LAYER);
    this.models = built.models;
    this.painter = built.painter;
    for (const model of Object.values(this.models)) {
      light.includedOnlyMeshes.push(...model.root.getChildMeshes());
      model.root.parent = this.holder;
    }

    // The muzzle flash belongs to the weapon, so it hangs off the muzzle node
    // and needs no per-frame positioning of its own.
    const flashMaterial = new StandardMaterial("mat_muzzle_flash", scene);
    const flashColour = Color3.FromHexString("#ffd27a");
    flashMaterial.diffuseColor = flashColour;
    flashMaterial.emissiveColor = flashColour;
    flashMaterial.disableLighting = true;
    flashMaterial.freeze();
    this.flash = MeshBuilder.CreateBox("muzzle_flash", { size: 0.055 }, scene);
    this.flash.material = flashMaterial;
    this.flash.isPickable = false;
    this.flash.layerMask = VIEWMODEL_LAYER;
    this.flash.setEnabled(false);

    // The round counter: a small hologram thrown up off a fitting on the
    // back of the weapon. It adds light rather than covering anything, so
    // the receiver shows through it and it never reads as a screen.
    this.hologramTexture = new DynamicTexture("tex_ammo_counter", { width: 256, height: 128 }, scene, true);
    this.hologramTexture.hasAlpha = true;
    const holoMaterial = new StandardMaterial("mat_ammo_counter", scene);
    holoMaterial.diffuseTexture = this.hologramTexture;
    holoMaterial.opacityTexture = this.hologramTexture;
    holoMaterial.emissiveColor = new Color3(1, 1, 1);
    holoMaterial.disableLighting = true;
    holoMaterial.backFaceCulling = false;
    holoMaterial.alphaMode = Constants.ALPHA_ADD;
    holoMaterial.separateCullingPass = false;
    this.hologram = MeshBuilder.CreatePlane("ammo_counter", COUNTER_SIZE, scene);
    this.hologram.material = holoMaterial;
    this.hologram.isPickable = false;
    this.hologram.layerMask = VIEWMODEL_LAYER;
    this.hologram.setEnabled(false);
  }

  /**
   * Paint the hologram: the rounds in the weapon large, the reserve small,
   * and a bar for the magazine that still reads when the digits are a few
   * pixels tall. Cyan while there is plenty, amber for the last quarter,
   * and orange on empty, so the colour alone says reload. The texture is
   * the expensive part, so it is only redrawn when the count changes.
   */
  private paintHologram(magazine: number, reserve: number, capacity: number): void {
    const text = `${magazine}|${reserve}|${capacity}`;
    if (text === this.hologramText) return;
    this.hologramText = text;
    const context = this.hologramTexture.getContext() as unknown as CanvasRenderingContext2D;
    const width = 256;
    const height = 128;
    context.clearRect(0, 0, width, height);
    const low = magazine > 0 && magazine <= Math.max(1, Math.floor(capacity * 0.25));
    const ink = magazine === 0 ? "#ff7a4a" : low ? "#ffc25c" : "#9ceeff";
    // No plate: the light is the whole thing. A faint field of scanlines
    // gives the projection an edge, and the glow around the digits does the
    // rest. The material adds all of this to whatever is behind it.
    context.save();
    roundedRect(context, 4, 4, width - 8, height - 8, 14);
    context.clip();
    context.fillStyle = ink;
    context.globalAlpha = 0.07;
    for (let y = 6; y < height; y += 4) context.fillRect(0, y, width, 1);
    context.globalAlpha = 0.9;
    context.shadowColor = ink;
    context.shadowBlur = 14;
    context.font = "bold 84px ui-monospace, Menlo, Consolas, monospace";
    context.textBaseline = "alphabetic";
    context.textAlign = "left";
    context.fillText(String(magazine).padStart(2, "0"), 16, 86);
    context.font = "bold 38px ui-monospace, Menlo, Consolas, monospace";
    context.textAlign = "right";
    context.globalAlpha = 0.7;
    context.fillText(String(Math.min(reserve, 999)), width - 16, 86);
    context.shadowBlur = 0;
    // The magazine bar.
    context.globalAlpha = 0.18;
    context.fillRect(16, 100, width - 32, 6);
    context.globalAlpha = 0.8;
    const fill = capacity > 0 ? clamp(magazine / capacity, 0, 1) : 0;
    context.fillRect(16, 100, Math.round((width - 32) * fill), 6);
    context.restore();
    this.hologramTexture.update();
  }

  /** Set the weapon camera's vertical field of view, in degrees. */
  /** Repaint the weapon in the equipped finish. */
  setFinish(finish: Finish): void {
    this.painter.apply(finish);
  }

  setFieldOfView(verticalDegrees: number = VIEWMODEL_FOV_DEGREES): void {
    this.restFov = verticalDegrees;
    this.applyFieldOfView();
  }

  /**
   * Apply the rest field of view narrowed by the current aiming zoom.
   *
   * The narrowing is done on the tangent rather than on the angle, because
   * that is what magnification actually is: half the width of the view at a
   * given distance, divided by what it was.
   */
  private applyFieldOfView(): void {
    const scale = Math.pow(Math.max(0.001, this.zoom), VIEWMODEL_ZOOM_SHARE);
    const rest = Math.tan((this.restFov * DEG_TO_RAD) / 2);
    this.camera.fov = 2 * Math.atan(rest / scale);
  }

  /** Muzzle position in world space, in the weapon camera's terms. */
  muzzleWorldPosition(): Vector3 | null {
    if (!this.current) return null;
    return this.models[this.current].muzzle.getAbsolutePosition();
  }

  /**
   * Where the muzzle appears to be, as a point in the world.
   *
   * The weapon is drawn through its own camera at a narrow field of view,
   * so the muzzle's true world position lands somewhere else entirely when
   * the world camera projects it — and a tracer started there leaves from a
   * point beside the gun rather than from its tip. This projects the muzzle
   * through the weapon camera to find where it is on the screen, then walks
   * the world camera's ray through that same pixel out to `distance`. A
   * tracer from that point starts exactly where the barrel ends.
   */
  muzzleOnScreen(worldCamera: FreeCamera, distance: number): Vector3 | null {
    const muzzle = this.muzzleWorldPosition();
    if (!muzzle) return null;
    const engine = this.camera.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const weaponView = this.camera.getViewMatrix().multiply(this.camera.getProjectionMatrix());
    const screen = Vector3.Project(muzzle, Matrix.Identity(), weaponView, this.camera.viewport.toGlobal(width, height));
    const far = Vector3.Unproject(
      new Vector3(screen.x, screen.y, 0.9),
      width,
      height,
      Matrix.Identity(),
      worldCamera.getViewMatrix(),
      worldCamera.getProjectionMatrix(),
    );
    const eye = worldCamera.globalPosition;
    const direction = far.subtract(eye).normalize();
    return eye.add(direction.scale(distance));
  }

  /**
   * Scale the weapon's own light, so it sits in the scene rather than
   * glowing in the dark in front of it. One is daylight.
   */
  setLightLevel(level: number): void {
    this.light.intensity = VIEWMODEL_LIGHT * level;
  }

  /** Light the muzzle flash for a frame or two. */
  fireFlash(scale: number): void {
    if (!this.current) return;
    this.flash.parent = this.models[this.current].muzzle;
    this.flash.position.setAll(0);
    this.flash.scaling.setAll(scale);
    this.flash.setEnabled(true);
    this.flashLife = 0.038;
  }

  /** Kick the weapon. Called once per shot. */
  addRecoil(strength: number, randomRoll: number): void {
    this.recoilAmount = Math.min(RECOIL.maxAccumulated, this.recoilAmount + strength);
    this.recoilRoll = (randomRoll * 2 - 1) * RECOIL.roll;
    // Start the bolt on its way back. This is the detail that says the weapon
    // is a mechanism rather than a prop playing an animation: the carrier
    // rides back, the port opens, and it is home before the next round.
    this.boltPhase = 0;
  }

  update(
    player: PlayerState,
    loadout: LoadoutState,
    worldCamera: FreeCamera,
    deltaSeconds: number,
    magnification = 1,
    /** How far through going down the player is; the weapon goes with them. */
    down = 0,
  ): void {
    if (magnification !== this.zoom) {
      this.zoom = magnification;
      this.applyFieldOfView();
    }

    this.camera.position.copyFrom(worldCamera.position);
    this.camera.rotation.copyFrom(worldCamera.rotation);
    // Babylon composes both cameras and transform nodes from the same
    // yaw-pitch-roll Euler order, so copying the rotation across gives the
    // node the camera's exact orientation.
    this.holder.position.copyFrom(worldCamera.position);
    this.holder.rotation.copyFrom(worldCamera.rotation);

    if (this.flashLife > 0) {
      this.flashLife -= deltaSeconds;
      if (this.flashLife <= 0) this.flash.setEnabled(false);
    }

    const weapon = activeWeapon(loadout);
    this.showWeapon(weapon.definition.id);
    this.updateBolt(deltaSeconds);
    const ads = clamp(loadout.adsProgress, 0, 1);
    this.paintHologram(weapon.magazine, weapon.reserve, weapon.definition.magazineSize);
    this.updateHologram(deltaSeconds);

    this.updateSway(player, deltaSeconds);
    this.recoilAmount = this.recoilAmount * Math.pow(RECOIL.recovery, deltaSeconds);
    this.recoilRoll = this.recoilRoll * Math.pow(RECOIL.recovery, deltaSeconds);

    const model = this.models[weapon.definition.id];
    const sprinting = player.sprinting ? 1 : 0;
    const reloading = weapon.reloading ? 1 : 0;
    const swapping = isSwapping(loadout) ? 1 : 0;

    this.applyPose(model, player, ads, sprinting, reloading, swapping, deltaSeconds, down);
  }

  /**
   * Run the bolt, slide or pump through its cycle.
   *
   * One smooth trip back and home rather than a snap each way: at sixty frames
   * a second a seventy-millisecond cycle is four frames, and a linear one
   * would read as the weapon flickering rather than working.
   */
  private updateBolt(deltaSeconds: number): void {
    if (this.boltPhase >= 1) return;
    this.boltPhase = Math.min(1, this.boltPhase + deltaSeconds / BOLT.cycleSeconds);
    if (!this.current) return;
    const model = this.models[this.current];
    model.bolt.position.z = -Math.sin(this.boltPhase * Math.PI) * model.spec.boltTravel;
  }

  /**
   * Keep the projection on the weapon and facing the eye.
   *
   * It rides the face it is projected from, so it follows the weapon
   * through every sway and cycle. A little waver in its brightness is what
   * says hologram. It stays up down the sights, under the rear aperture,
   * where a glance takes it in without leaving the target.
   */
  private updateHologram(deltaSeconds: number): void {
    if (!this.current) return;
    this.hologramTime += deltaSeconds;
    const model = this.models[this.current];
    const mount = model.spec.counter;
    this.hologram.parent = mount.group === "bolt" ? model.bolt : model.root;
    this.hologram.position.set(mount.x, mount.y, mount.z);
    this.hologram.setEnabled(true);
    const material = this.hologram.material as StandardMaterial;
    const waver = 1 + Math.sin(this.hologramTime * 23) * 0.08 + Math.sin(this.hologramTime * 3.1) * 0.06;
    material.alpha = HOLOGRAM_STRENGTH * waver;
  }

  private showWeapon(id: WeaponId): void {
    if (this.current === id) return;
    if (this.current) {
      // Put the outgoing weapon's bolt back where it belongs. Swapping part
      // way through a cycle would otherwise leave it hanging open until the
      // next time that weapon is fired.
      this.models[this.current].bolt.position.z = 0;
      this.models[this.current].root.setEnabled(false);
    }
    this.models[id].root.setEnabled(true);
    this.models[id].bolt.position.z = 0;
    this.boltPhase = 1;
    this.current = id;
    // Start the new weapon's bob where the old one left off, so a swap does
    // not snap the weapon to the top of its stride.
    this.bobPhaseOffset = 0;
  }

  private updateSway(player: PlayerState, deltaSeconds: number): void {
    let deltaYaw = player.yaw - this.lastYaw;
    if (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    if (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    const deltaPitch = player.pitch - this.lastPitch;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;

    // The weapon lags the view, then catches up. Without the clamp a fast
    // flick swings it clean off the side of the screen.
    const targetX = clamp(
      -deltaYaw * SWAY.positionPerRadian,
      -SWAY.maxPosition,
      SWAY.maxPosition,
    );
    const targetY = clamp(
      -deltaPitch * SWAY.positionPerRadian,
      -SWAY.maxPosition,
      SWAY.maxPosition,
    );
    this.swayX = damp(this.swayX, targetX, SWAY.smoothing, deltaSeconds);
    this.swayY = damp(this.swayY, targetY, SWAY.smoothing, deltaSeconds);
  }

  private applyPose(
    model: WeaponModel,
    player: PlayerState,
    ads: number,
    sprinting: number,
    reloading: number,
    swapping: number,
    deltaSeconds: number,
    down: number,
  ): void {
    // Where the weapon is held comes from the shared geometry, so the pose a
    // test inspects is the pose the player is given.
    const rest = holdPosition(model.spec, ads);
    let x = rest.x;
    let y = rest.y;
    let z = rest.z;
    let pitch = 0;
    let yaw = 0;
    let roll = 0;

    // Sprint, reload and swap each override the rest pose, and none of them
    // can be active while aiming, so they blend against the hip pose only.
    const blend = (
      weight: number,
      pose: { x: number; y: number; z: number },
      poseRoll: number,
      posePitch: number,
      poseYaw = 0,
    ) => {
      if (weight <= 0) return;
      x += (pose.x - x) * weight;
      y += (pose.y - y) * weight;
      z += (pose.z - z) * weight;
      roll += poseRoll * weight;
      pitch += posePitch * weight;
      yaw += poseYaw * weight;
    };

    blend(sprinting * (1 - ads), POSE.sprint, POSE.sprintRoll, POSE.sprintPitch, POSE.sprintYaw);
    blend(reloading, POSE.reload, POSE.reloadRoll, POSE.reloadPitch);
    blend(swapping, POSE.swap, 0, POSE.swapPitch);

    // Movement bob, muted while aiming because a bobbing sight is unusable.
    const bobScale = (1 - ads * 0.85) * Math.min(1, Math.hypot(player.velocity.x, player.velocity.z) / 4);
    const phase = (player.bobDistance + this.bobPhaseOffset) * BOB.frequency * Math.PI * 2;
    x += Math.cos(phase) * BOB.amount * bobScale;
    y += Math.abs(Math.sin(phase)) * -BOB.amount * bobScale;
    roll += Math.cos(phase) * BOB.roll * bobScale;

    // Sway, also muted while aiming.
    const swayScale = 1 - ads * 0.7;
    x += this.swayX * swayScale;
    y += this.swayY * swayScale;
    yaw += this.swayX * SWAY.rotationPerRadian * 8 * swayScale;
    pitch += -this.swayY * SWAY.rotationPerRadian * 8 * swayScale;

    // Recoil: back, up and rotated, easing out over the following frames.
    // The amounts come from recoilPose so the rule they have to obey — that
    // the weapon never climbs over what the player is shooting at — can be
    // asserted against the same numbers the renderer uses.
    const kick = recoilPose(this.recoilAmount, ads, headroomDegrees(model.spec, ads));
    z -= kick.back;
    y += kick.up;
    pitch -= kick.pitch;
    roll += this.recoilRoll * kick.rollScale;

    // Going down takes the weapon with it, and takes it over everything
    // else: a player shot in the middle of a burst does not keep shouldering
    // the rifle while the view falls to the floor. This one eases toward the
    // pose rather than adding to it, because by here there is a bob, a sway
    // and a kick on the rotation and none of them apply to a dropped gun.
    if (down > 0) {
      const t = down;
      x += (POSE.death.x - x) * t;
      y += (POSE.death.y - y) * t;
      z += (POSE.death.z - z) * t;
      roll += (POSE.deathRoll - roll) * t;
      pitch += (POSE.deathPitch - pitch) * t;
      yaw += (POSE.deathYaw - yaw) * t;
    }

    // One last smoothing pass so no pose change can pop in a single frame.
    this.position.set(x, y, z);
    this.rotation.set(pitch, yaw, roll);
    const smoothing = 0.000001;
    model.root.position.x = damp(model.root.position.x, this.position.x, smoothing, deltaSeconds);
    model.root.position.y = damp(model.root.position.y, this.position.y, smoothing, deltaSeconds);
    model.root.position.z = damp(model.root.position.z, this.position.z, smoothing, deltaSeconds);
    model.root.rotation.x = damp(model.root.rotation.x, this.rotation.x, smoothing, deltaSeconds);
    model.root.rotation.y = damp(model.root.rotation.y, this.rotation.y, smoothing, deltaSeconds);
    model.root.rotation.z = damp(model.root.rotation.z, this.rotation.z, smoothing, deltaSeconds);
  }
}

/** How bright the count is at the hip: light added to the weapon, well short of solid. */
const HOLOGRAM_STRENGTH = 0.62;

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
};
