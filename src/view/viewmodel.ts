import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";
import { activeWeapon, isSwapping, type LoadoutState } from "../sim/loadout";
import type { PlayerState } from "../sim/types";
import type { WeaponId } from "../sim/weapons";
import { clamp, damp } from "../sim/vec3";
import { createWeaponModels, type FinishPainter, type WeaponModel } from "./weaponModels";
import type { Finish } from "../sim/cosmetics";

/** Meshes on this layer render only through the viewmodel camera. */
export const VIEWMODEL_LAYER = 0x20000000;
/** Everything else. Babylon's default mesh mask. */
export const WORLD_LAYER = 0x0fffffff;

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

const POSE = {
  /**
   * Hip-fire rest pose, right of centre and low.
   *
   * The z figure is what keeps the weapon in proportion. Its parts run from
   * roughly a quarter metre behind the origin to two thirds of a metre ahead,
   * so a small z puts the stock level with the eye, where perspective blows
   * the near end up until it swallows the screen.
   */
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

const RECOIL = {
  /** Metres the weapon travels back per unit of kick. */
  back: 0.055,
  up: 0.018,
  pitch: 1.9,
  /** Random roll per shot, so a burst does not look stamped. */
  roll: 0.5,
  /** Fraction of the kick left after one second. */
  recovery: 0.000002,
} as const;

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
  private current: WeaponId | null = null;

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
    this.camera.minZ = 0.01;
    this.camera.maxZ = 5;
    this.camera.inputs.clear();
    this.setFieldOfView(fovDegrees);

    // A dedicated light so the weapon reads the same in a dark corner as in
    // the open. Restricted to the viewmodel meshes so it cannot leak.
    const light = new HemisphericLight("vm_light", new Vector3(-0.3, 1, -0.6), scene);
    light.intensity = 0.75;
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
  }

  /** Set the weapon camera's vertical field of view, in degrees. */
  /** Repaint the weapon in the equipped finish. */
  setFinish(finish: Finish): void {
    this.painter.apply(finish);
  }

  setFieldOfView(verticalDegrees: number = VIEWMODEL_FOV_DEGREES): void {
    this.camera.fov = verticalDegrees * DEG_TO_RAD;
  }

  /** Muzzle position in world space, used as the tracer origin. */
  muzzleWorldPosition(): Vector3 | null {
    if (!this.current) return null;
    return this.models[this.current].muzzle.getAbsolutePosition();
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
    this.recoilAmount = Math.min(2.4, this.recoilAmount + strength);
    this.recoilRoll = (randomRoll * 2 - 1) * RECOIL.roll;
  }

  update(
    player: PlayerState,
    loadout: LoadoutState,
    worldCamera: FreeCamera,
    deltaSeconds: number,
  ): void {
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

    this.updateSway(player, deltaSeconds);
    this.recoilAmount = this.recoilAmount * Math.pow(RECOIL.recovery, deltaSeconds);
    this.recoilRoll = this.recoilRoll * Math.pow(RECOIL.recovery, deltaSeconds);

    const model = this.models[weapon.definition.id];
    const ads = clamp(loadout.adsProgress, 0, 1);
    const sprinting = player.sprinting ? 1 : 0;
    const reloading = weapon.reloading ? 1 : 0;
    const swapping = isSwapping(loadout) ? 1 : 0;

    this.applyPose(model, player, ads, sprinting, reloading, swapping, deltaSeconds);
  }

  private showWeapon(id: WeaponId): void {
    if (this.current === id) return;
    if (this.current) this.models[this.current].root.setEnabled(false);
    this.models[id].root.setEnabled(true);
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
  ): void {
    // Aiming puts the sight on the screen centre: cancel the sight's own
    // offset rather than guessing a pose, so every weapon lines up exactly.
    const aimX = -model.sight.x;
    const aimY = -model.sight.y;
    const aimZ = POSE.aimZ;

    let x = POSE.hip.x + (aimX - POSE.hip.x) * ads;
    let y = POSE.hip.y + (aimY - POSE.hip.y) * ads;
    let z = POSE.hip.z + (aimZ - POSE.hip.z) * ads;
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
    z -= this.recoilAmount * RECOIL.back;
    y += this.recoilAmount * RECOIL.up;
    pitch -= this.recoilAmount * RECOIL.pitch * DEG_TO_RAD * 10;
    roll += this.recoilRoll;

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
