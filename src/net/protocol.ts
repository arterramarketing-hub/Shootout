import type { Team } from "../sim/bots";
import type { WeaponId } from "../sim/weapons";

/**
 * The wire format, shared by client and server.
 *
 * JSON rather than a packed binary format. At thirty ticks a second with ten
 * players a snapshot is a couple of kilobytes, which a LAN and any usable
 * mobile connection carry comfortably, and being able to read a capture makes
 * netcode bugs findable. Coordinates are rounded on the way out, which is
 * where most of the size would otherwise go.
 */
export const PROTOCOL_VERSION = 1;

/** Authoritative simulation rate. Clients still run at sixty locally. */
export const SERVER_TICK_RATE = 30;
export const SERVER_TICK_SECONDS = 1 / SERVER_TICK_RATE;

/** How far behind the newest snapshot remote players are drawn. */
export const INTERPOLATION_DELAY_MS = 100;

/** The furthest back the server will rewind to validate a shot. */
export const MAX_REWIND_MS = 200;

export type GameMode = "tdm" | "ffa";

// --- Client to server -------------------------------------------------------

export interface JoinMessage {
  type: "join";
  version: number;
  name: string;
}

/** One simulated step of player intent, with the sequence used to acknowledge it. */
export interface InputCommand {
  seq: number;
  /** Seconds this command covers. Clamped by the server. */
  dt: number;
  moveX: number;
  moveY: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
  crouch: boolean;
  fire: boolean;
  aim: boolean;
  reload: boolean;
  swap: boolean;
}

export interface InputMessage {
  type: "input";
  /** A short run of recent commands, so one lost packet costs nothing. */
  commands: InputCommand[];
}

export interface PingMessage {
  type: "ping";
  /** The client's own clock, echoed back untouched. */
  time: number;
}

export type ClientMessage = JoinMessage | InputMessage | PingMessage;

// --- Server to client -------------------------------------------------------

export interface WelcomeMessage {
  type: "welcome";
  version: number;
  /** The id the client should treat as its own. */
  id: string;
  name: string;
  team: Team;
  tickRate: number;
  mode: GameMode;
  mapId: string;
  serverTime: number;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  team: Team;
  x: number;
  y: number;
  z: number;
  /** Velocity travels too, so a client can reconcile without guessing it. */
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  health: number;
  dead: boolean;
  weapon: WeaponId;
  /** 0 standing, 1 crouched. */
  crouch: number;
  /** True while the trigger is down, so the view can show muzzle flashes. */
  firing: boolean;
}

export interface ShotEventMessage {
  shooter: string;
  weapon: WeaponId;
  ox: number;
  oy: number;
  oz: number;
  /** Where each pellet ended up. */
  hits: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[];
}

export interface KillEventMessage {
  killer: string;
  killerName: string;
  killerTeam: Team;
  victim: string;
  victimName: string;
  victimTeam: Team;
  headshot: boolean;
}

export interface DamageEventMessage {
  victim: string;
  amount: number;
  /** Direction the damage came from, for the indicator. */
  fromYaw: number;
  headshot: boolean;
}

export interface SnapshotMessage {
  type: "snapshot";
  tick: number;
  serverTime: number;
  /** The newest input command from this client the server has applied. */
  ack: number;
  players: PlayerSnapshot[];
  shots: ShotEventMessage[];
  kills: KillEventMessage[];
  damage: DamageEventMessage[];
  scores: Record<Team, number>;
  phase: "warmup" | "active" | "over";
  timeRemaining: number;
}

export interface PongMessage {
  type: "pong";
  time: number;
  serverTime: number;
}

export interface ErrorMessage {
  type: "error";
  reason: string;
}

export type ServerMessage =
  | WelcomeMessage
  | SnapshotMessage
  | PongMessage
  | ErrorMessage;

// --- Encoding ---------------------------------------------------------------

/** Centimetre precision for positions, milliradian for angles. */
export const roundPosition = (value: number): number => Math.round(value * 100) / 100;
export const roundAngle = (value: number): number => Math.round(value * 1000) / 1000;

export const encode = (message: ServerMessage | ClientMessage): string =>
  JSON.stringify(message);

/** Parse a message, returning null rather than throwing on rubbish. */
export const decode = <T>(raw: string): T | null => {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof (parsed as { type?: unknown }).type !== "string") return null;
    return parsed as T;
  } catch {
    return null;
  }
};

/** Guard against a client claiming an enormous step to move further per tick. */
export const clampCommandDt = (dt: number): number => {
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  return Math.min(dt, 1 / 20);
};

export const sanitiseName = (name: unknown): string => {
  if (typeof name !== "string") return "Player";
  const trimmed = name.replace(/[^\w \-.]/g, "").trim().slice(0, 16);
  return trimmed.length > 0 ? trimmed : "Player";
};
