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

  constructor(scene: Scene, quality: QualitySettings, fovDegrees = CAMERA.defaultFovDegrees) {
    this.camera = new FreeCamera("player_camera", new Vector3(0, STANCE.standEyeHeight, 0), scene);
    // Babylon takes a vertical field of view; the familiar shooter number is
    // horizontal, so convert to keep the setting meaningful across aspects.
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
  update(
    previousPosition: Vec3,
    current: PlayerState,
    alpha: number,
    deltaSeconds: number,
  ): void {
    const x = previousPosition.x + (current.position.x - previousPosition.x) * alpha;
    const y = previousPosition.y + (current.position.y - previousPosition.y) * alpha;
    const z = previousPosition.z + (current.position.z - previousPosition.z) * alpha;

    this.updateBob(current, deltaSeconds);

    const eye = eyeOffset(current) + this.bobOffset - current.landingOffset;
    const lean = this.leanOffset(current);

    this.camera.position.set(x + lean.x, y + eye, z + lean.z);
    // Rotation is taken from the current state directly, never interpolated:
    // smoothing the aim would read as input lag.
    this.camera.rotation.set(
      -current.pitch,
      current.yaw,
      current.leanAmount * STANCE.leanRollRadians + this.bobRoll,
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
