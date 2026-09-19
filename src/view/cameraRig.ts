import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CAMERA, STANCE } from "../sim/config";
import { eyeOffset } from "../sim/player";
import type { PlayerState } from "../sim/types";
import type { Vec3 } from "../sim/vec3";
import type { QualitySettings } from "../engine/quality";

const DEG_TO_RAD = Math.PI / 180;

/**
 * Drives the first-person camera from simulation state.
 *
 * The camera sits at eye height with a plain perspective projection. This is
 * the presentation choice that separates the game from a body-worn-camera
 * look: no lens distortion, no chest mount, no post-process grain.
 */
export class CameraRig {
  readonly camera: FreeCamera;
  private bobOffset = 0;
  private bobRoll = 0;
  private currentFov: number = CAMERA.defaultFovDegrees;
  /** How hard the view is shaking right now, from a shot; decays fast. */
  private shake = 0;

  constructor(
    scene: Scene,
    quality: QualitySettings,
    fovDegrees: number = CAMERA.defaultFovDegrees,
  ) {
    this.camera = new FreeCamera("player_camera", new Vector3(0, STANCE.standEyeHeight, 0), scene);
    // Babylon takes a vertical field of view; the familiar shooter number is
    // horizontal, so convert to keep the setting meaningful across aspects.
    this.currentFov = fovDegrees;
    this.setFieldOfView(fovDegrees);
    this.camera.minZ = CAMERA.nearClip;
    this.camera.maxZ = Math.min(quality.viewDistance, CAMERA.farClip);
    this.camera.rotation.set(0, 0, 0);
    // Input is handled entirely by the input manager, so the camera's own
    // controls are never attached.
    this.camera.inputs.clear();
    scene.activeCamera = this.camera;
  }

  setFieldOfView(horizontalDegrees: number): void {
    const aspect = this.camera.getEngine().getAspectRatio(this.camera) || 16 / 9;
    const horizontal = horizontalDegrees * DEG_TO_RAD;
    this.camera.fov = 2 * Math.atan(Math.tan(horizontal / 2) / aspect);
  }

  /**
   * Place the camera for this frame.
   * `alpha` interpolates between the previous and current simulation states so
   * that rendering stays smooth when the frame rate and tick rate differ.
   */
  /**
   * Ease the world field of view toward a target.
   * Aiming narrows it, which is most of what makes a sight picture feel
   * closer; snapping instead of easing reads as a glitch.
   */
  blendFieldOfView(targetDegrees: number, deltaSeconds: number): void {
    const blend = Math.min(1, deltaSeconds * 14);
    this.currentFov += (targetDegrees - this.currentFov) * blend;
    this.setFieldOfView(this.currentFov);
  }

  /**
   * How much closer the view is than the player's own setting makes it, as a
   * scale rather than an angle.
   *
   * Aiming narrows the field of view, and magnification is what that narrowing
   * means: half the width of the view at a given distance against what it was.
   * The weapon camera needs the same figure so the sights grow with the target
   * they are measured against.
   */
  magnification(baseDegrees: number): number {
    return (
      Math.tan((baseDegrees * DEG_TO_RAD) / 2) / Math.tan((this.currentFov * DEG_TO_RAD) / 2)
    );
  }

  /**
   * Shake the view. Called once per shot.
   *
   * The weapon's recoil pitches the aim; this is the rest of it, the jolt
   * through the shoulder that the sights do not follow. It is small, random
   * from frame to frame, and gone in a tenth of a second, which is what
   * keeps it a jolt rather than a wobble.
   */
  addShake(strength: number): void {
    this.shake = Math.min(1, this.shake + strength);
  }

  update(
    previousPosition: Vec3,
    current: PlayerState,
    alpha: number,
    deltaSeconds: number,
    recoilPitch = 0,
    recoilYaw = 0,
  ): void {
    const x = previousPosition.x + (current.position.x - previousPosition.x) * alpha;
    const y = previousPosition.y + (current.position.y - previousPosition.y) * alpha;
    const z = previousPosition.z + (current.position.z - previousPosition.z) * alpha;

    this.updateBob(current, deltaSeconds);

    const eye = eyeOffset(current) + this.bobOffset - current.landingOffset;
    const lean = this.leanOffset(current);

    this.shake *= Math.exp(-deltaSeconds * SHAKE.decay);
    if (this.shake < 0.005) this.shake = 0;
    const jolt = this.shake;
    const shakePitch = (Math.random() * 2 - 1) * SHAKE.pitch * jolt;
    const shakeYaw = (Math.random() * 2 - 1) * SHAKE.yaw * jolt;
    const shakeRoll = (Math.random() * 2 - 1) * SHAKE.roll * jolt;

    this.camera.position.set(
      x + lean.x,
      y + eye + (Math.random() * 2 - 1) * SHAKE.lift * jolt,
      z + lean.z,
    );
    // Rotation is taken from the current state directly, never interpolated:
    // smoothing the aim would read as input lag.
    // Recoil is added here rather than folded into the player's aim, so that
    // kick moves the view and the shots without also steering movement.
    // Babylon's rotation.x pitches the camera downward as it grows, while the
    // simulation measures pitch above the horizon, so the sign flips here.
    this.camera.rotation.set(
      -(current.pitch + recoilPitch) + shakePitch,
      current.yaw + recoilYaw + shakeYaw,
      current.leanAmount * STANCE.leanRollRadians + this.bobRoll + shakeRoll,
    );
  }

  /** Sideways camera shift when leaning, perpendicular to the facing. */
  private leanOffset(state: PlayerState): { x: number; z: number } {
    const distance = state.leanAmount * STANCE.leanDistance;
    if (distance === 0) return { x: 0, z: 0 };
    const right = state.yaw + Math.PI / 2;
    return { x: Math.sin(right) * distance, z: Math.cos(right) * distance };
  }

  private updateBob(state: PlayerState, deltaSeconds: number): void {
    if (!state.grounded) {
      this.bobOffset += (0 - this.bobOffset) * Math.min(1, deltaSeconds * 8);
      this.bobRoll += (0 - this.bobRoll) * Math.min(1, deltaSeconds * 8);
      return;
    }
    const phase = state.bobDistance * CAMERA.bobFrequency * Math.PI * 2;
    const speedScale = Math.min(1, Math.hypot(state.velocity.x, state.velocity.z) / 4);
    // The vertical bob runs at twice the roll frequency: one dip per footfall,
    // one sway per stride.
    const targetOffset = Math.sin(phase * 2) * CAMERA.bobAmplitude * speedScale;
    const targetRoll = Math.sin(phase) * CAMERA.bobRollAmplitude * speedScale;
    const blend = Math.min(1, deltaSeconds * 14);
    this.bobOffset += (targetOffset - this.bobOffset) * blend;
    this.bobRoll += (targetRoll - this.bobRoll) * blend;
  }
}

/** The shake of a shot, in radians and metres at full strength, and how fast it dies away. */
const SHAKE = {
  pitch: 0.0055,
  yaw: 0.004,
  roll: 0.007,
  lift: 0.004,
  decay: 16,
};
