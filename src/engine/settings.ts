import { DEFAULT_MAP_ID, MAPS } from "../maps";
import type { BotDifficulty } from "../sim/bots";
import { CAMERA, LOOK } from "../sim/config";
import type { QualityTier } from "./quality";

export interface GameSettings {
  touchSensitivity: number;
  mouseSensitivity: number;
  gyroScale: number;
  invertY: boolean;
  fovDegrees: number;
  hudScale: number;
  /** "auto" lets the benchmark decide. */
  quality: QualityTier | "auto";
  audioEnabled: boolean;
  difficulty: BotDifficulty["id"];
  teamSize: number;
  /** Play against a server rather than local bots. */
  online: boolean;
  serverUrl: string;
  playerName: string;
  /** Which level solo matches load. */
  mapId: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  touchSensitivity: LOOK.defaultTouchSensitivity,
  mouseSensitivity: LOOK.defaultMouseSensitivity,
  gyroScale: LOOK.defaultGyroScale,
  invertY: LOOK.invertY,
  fovDegrees: CAMERA.defaultFovDegrees,
  hudScale: 1,
  quality: "auto",
  audioEnabled: true,
  difficulty: "regular",
  teamSize: 4,
  online: false,
  serverUrl: "",
  playerName: "Player",
  mapId: DEFAULT_MAP_ID,
};

export const SETTINGS_LIMITS = {
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  gyro: { min: 0, max: 2, step: 0.05 },
  fov: { min: CAMERA.minFovDegrees, max: CAMERA.maxFovDegrees, step: 1 },
  hudScale: { min: 0.8, max: 1.4, step: 0.05 },
  teamSize: { min: 1, max: 5, step: 1 },
} as const;

const STORAGE_KEY = "shootout.settings.v1";

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

/**
 * Read saved settings.
 *
 * Storage can be empty, stale, or throw outright in a private window, and a
 * settings file is not worth losing a session over, so every field is
 * validated against its own limits and anything unusable falls back.
 */
export const loadSettings = (): GameSettings => {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw) return { ...DEFAULT_SETTINGS };

  try {
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const limits = SETTINGS_LIMITS;
    return {
      touchSensitivity: clampNumber(
        parsed.touchSensitivity, limits.sensitivity.min, limits.sensitivity.max,
        DEFAULT_SETTINGS.touchSensitivity,
      ),
      mouseSensitivity: clampNumber(
        parsed.mouseSensitivity, limits.sensitivity.min, limits.sensitivity.max,
        DEFAULT_SETTINGS.mouseSensitivity,
      ),
      gyroScale: clampNumber(
        parsed.gyroScale, limits.gyro.min, limits.gyro.max, DEFAULT_SETTINGS.gyroScale,
      ),
      invertY: typeof parsed.invertY === "boolean" ? parsed.invertY : DEFAULT_SETTINGS.invertY,
      fovDegrees: clampNumber(
        parsed.fovDegrees, limits.fov.min, limits.fov.max, DEFAULT_SETTINGS.fovDegrees,
      ),
      hudScale: clampNumber(
        parsed.hudScale, limits.hudScale.min, limits.hudScale.max, DEFAULT_SETTINGS.hudScale,
      ),
      quality: isQuality(parsed.quality) ? parsed.quality : DEFAULT_SETTINGS.quality,
      audioEnabled:
        typeof parsed.audioEnabled === "boolean"
          ? parsed.audioEnabled
          : DEFAULT_SETTINGS.audioEnabled,
      difficulty: isDifficulty(parsed.difficulty)
        ? parsed.difficulty
        : DEFAULT_SETTINGS.difficulty,
      teamSize: Math.round(
        clampNumber(
          parsed.teamSize, limits.teamSize.min, limits.teamSize.max, DEFAULT_SETTINGS.teamSize,
        ),
      ),
      online: typeof parsed.online === "boolean" ? parsed.online : DEFAULT_SETTINGS.online,
      serverUrl: sanitiseServerUrl(parsed.serverUrl),
      playerName: sanitisePlayerName(parsed.playerName),
      // A map that no longer exists falls back rather than failing to load.
      mapId:
        typeof parsed.mapId === "string" && parsed.mapId in MAPS
          ? parsed.mapId
          : DEFAULT_MAP_ID,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

export const saveSettings = (settings: GameSettings): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // A full or blocked store is not worth interrupting play for.
  }
};

const isQuality = (value: unknown): value is QualityTier | "auto" =>
  value === "auto" || value === "low" || value === "medium" || value === "high";

const isDifficulty = (value: unknown): value is BotDifficulty["id"] =>
  value === "recruit" || value === "regular" || value === "veteran";

/**
 * Only websocket addresses are accepted, and only up to a sane length.
 * The value is stored, replayed on the next visit, and used to open a socket,
 * so anything else is dropped rather than carried around.
 */
export const sanitiseServerUrl = (value: unknown): string => {
  if (typeof value !== "string") return DEFAULT_SETTINGS.serverUrl;
  const trimmed = value.trim().slice(0, 200);
  if (trimmed === "") return "";
  if (!/^wss?:\/\//i.test(trimmed)) return "";
  try {
    // Reject anything the URL parser will not accept, before it reaches a socket.
    const parsed = new URL(trimmed);
    return parsed.protocol === "ws:" || parsed.protocol === "wss:" ? trimmed : "";
  } catch {
    return "";
  }
};

export const sanitisePlayerName = (value: unknown): string => {
  if (typeof value !== "string") return DEFAULT_SETTINGS.playerName;
  const cleaned = value.replace(/[^\w \-.]/g, "").trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : DEFAULT_SETTINGS.playerName;
};
