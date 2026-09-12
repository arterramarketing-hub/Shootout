import { CAMERA, LOOK } from "./config";
import { clamp } from "./vec3";

export interface LookSettings {
  touchSensitivity: number;
  mouseSensitivity: number;
  gyroScale: number;
  invertY: boolean;
}

export const defaultLookSettings = (): LookSettings => ({
  touchSensitivity: LOOK.defaultTouchSensitivity,
  mouseSensitivity: LOOK.defaultMouseSensitivity,
  gyroScale: LOOK.defaultGyroScale,
  invertY: LOOK.invertY,
});

export interface LookState {
  yaw: number;
  pitch: number;
}

export const createLook = (yaw = 0, pitch = 0): LookState => ({ yaw, pitch });

/**
 * Apply a drag in CSS pixels to the look angles.
 * Look runs at render rate rather than on the fixed step: interpolating aim
 * introduces latency that players read as input lag.
 */
export const applyLookDelta = (
  look: LookState,
  deltaX: number,
  deltaY: number,
  settings: LookSettings,
  source: "touch" | "mouse",
  aiming = false,
): LookState => {
  const userScale =
    source === "touch" ? settings.touchSensitivity : settings.mouseSensitivity;
  const adsScale = aiming ? LOOK.adsSensitivityScale : 1;
  const scale = LOOK.baseSensitivity * userScale * adsScale;
  const pitchSign = settings.invertY ? -1 : 1;

  look.yaw += deltaX * scale;
  look.pitch = clamp(
    look.pitch + deltaY * scale * pitchSign,
    -CAMERA.maxPitchRadians,
    CAMERA.maxPitchRadians,
  );
  // Keep yaw in a sane range so it never loses float precision in a long match.
  if (look.yaw > Math.PI * 2) look.yaw -= Math.PI * 2;
  if (look.yaw < -Math.PI * 2) look.yaw += Math.PI * 2;
  return look;
};
