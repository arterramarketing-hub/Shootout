import { stepPlayer } from "../sim/player";
import type { CollisionWorld, InputFrame, PlayerState } from "../sim/types";
import { vec3, type Vec3 } from "../sim/vec3";
import type { PlayerSnapshot } from "./protocol";
import { lerpAngle } from "./history";

export interface PendingCommand {
  seq: number;
  frame: InputFrame;
  dt: number;
}

export interface ReconcileResult {
  /** How far the prediction had drifted, before correcting. */
  error: Vec3;
  /** Distance of that drift, in metres. */
  distance: number;
  /** True when the drift was too large to hide and the view snapped. */
  snapped: boolean;
}

/**
 * Correct a predicted player against the server, then replay the input the
 * server has not acknowledged yet.
 *
 * This is the heart of client prediction. The server's answer is always
 * authoritative but always late, so it describes a moment the player has
 * already moved on from. Replaying the unacknowledged commands from that
 * moment brings the authoritative state back up to the present, and what
 * remains is genuine prediction error rather than latency.
 */
export const reconcilePlayer = (
  state: PlayerState,
  body: CollisionWorld,
  authoritative: PlayerSnapshot,
  pending: readonly PendingCommand[],
  snapDistance = 2.5,
): ReconcileResult => {
  const predicted = vec3(state.position.x, state.position.y, state.position.z);

  body.setPosition(vec3(authoritative.x, authoritative.y, authoritative.z));
  state.position = vec3(authoritative.x, authoritative.y, authoritative.z);
  state.velocity = vec3(authoritative.vx, authoritative.vy, authoritative.vz);

  for (const command of pending) {
    stepPlayer(state, command.frame, command.dt, body);
  }

  const error = vec3(
    predicted.x - state.position.x,
    predicted.y - state.position.y,
    predicted.z - state.position.z,
  );
  const distance = Math.hypot(error.x, error.y, error.z);
  const snapped = distance > snapDistance;
  return { error: snapped ? vec3() : error, distance, snapped };
};

/** Blend two snapshots of the same combatant. */
export const interpolateSnapshot = (
  from: PlayerSnapshot,
  to: PlayerSnapshot,
  t: number,
): {
  position: Vec3;
  yaw: number;
  pitch: number;
  dead: boolean;
  health: number;
  firing: boolean;
} => ({
  position: vec3(
    from.x + (to.x - from.x) * t,
    from.y + (to.y - from.y) * t,
    from.z + (to.z - from.z) * t,
  ),
  yaw: lerpAngle(from.yaw, to.yaw, t),
  pitch: from.pitch + (to.pitch - from.pitch) * t,
  // State flags take the newer value rather than being blended.
  dead: to.dead,
  health: to.health,
  firing: to.firing,
});

export interface TimedSnapshot {
  serverTime: number;
}

/**
 * The two snapshots that bracket a moment, and how far between them it sits.
 *
 * Drawing remote players at the newest snapshot would mean redrawing them
 * every time one arrives, in jumps. Drawing them slightly in the past means
 * there is always a later snapshot to interpolate toward, so motion is
 * continuous and never guessed.
 */
export const bracket = <T extends TimedSnapshot>(
  snapshots: readonly T[],
  target: number,
): { from: T; to: T; t: number } | null => {
  if (snapshots.length === 0) return null;
  if (snapshots.length === 1) return { from: snapshots[0], to: snapshots[0], t: 0 };

  const oldest = snapshots[0];
  const newest = snapshots[snapshots.length - 1];
  // Outside the buffer, hold at the nearest end rather than extrapolating.
  if (target <= oldest.serverTime) return { from: oldest, to: oldest, t: 0 };
  if (target >= newest.serverTime) return { from: newest, to: newest, t: 0 };

  for (let i = snapshots.length - 1; i > 0; i -= 1) {
    const from = snapshots[i - 1];
    const to = snapshots[i];
    if (target < from.serverTime) continue;
    const span = to.serverTime - from.serverTime;
    const t = span > 1e-6 ? (target - from.serverTime) / span : 0;
    return { from, to, t: Math.max(0, Math.min(1, t)) };
  }
  return { from: oldest, to: snapshots[1], t: 0 };
};
