import type { CollisionWorld, InputFrame, PlayerState } from "../sim/types";
import { bracket, interpolateSnapshot, reconcilePlayer } from "./reconcile";
import {
  INTERPOLATION_DELAY_MS,
  PROTOCOL_VERSION,
  decode,
  encode,
  roundAngle,
  roundPosition,
  type ClientMessage,
  type InputCommand,
  type ServerMessage,
  type SnapshotMessage,
  type WelcomeMessage,
} from "./protocol";
import { vec3, type Vec3 } from "../sim/vec3";

export type ConnectionState = "idle" | "connecting" | "connected" | "closed" | "error";

/** A remote combatant, already interpolated to the moment being drawn. */
export interface RemoteView {
  id: string;
  name: string;
  team: "a" | "b";
  position: Vec3;
  yaw: number;
  pitch: number;
  dead: boolean;
  health: number;
  firing: boolean;
}

export interface NetEvents {
  onWelcome?: (message: WelcomeMessage) => void;
  onSnapshot?: (message: SnapshotMessage) => void;
  onClose?: (reason: string) => void;
  onError?: (reason: string) => void;
}

/** How much of the prediction error is corrected per second. */
const ERROR_CORRECTION = 0.0001;
/** Beyond this the correction is applied at once rather than eased. */
const SNAP_DISTANCE = 2.5;
/** Snapshots kept for interpolation. */
const SNAPSHOT_BUFFER = 24;

/**
 * The client half of the netcode.
 *
 * Three jobs. It predicts the local player forward so that moving feels
 * immediate rather than costing a round trip; it reconciles that prediction
 * against the server's authoritative answer by replaying whatever input the
 * server had not yet seen; and it draws everyone else slightly in the past,
 * interpolating between snapshots, because the alternative is guessing where
 * they went and being wrong every time they change direction.
 */
export class NetClient {
  state: ConnectionState = "idle";
  selfId: string | null = null;
  welcome: WelcomeMessage | null = null;
  latest: SnapshotMessage | null = null;
  /** Round trip in milliseconds, smoothed. */
  rttMs = 0;

  private socket: WebSocket | null = null;
  private readonly events: NetEvents;
  private seq = 0;
  private readonly unacknowledged: { seq: number; frame: InputFrame; dt: number }[] = [];
  private readonly outbox: InputCommand[] = [];
  private readonly snapshots: SnapshotMessage[] = [];
  /** serverTime minus local clock, smoothed. */
  private clockOffset = 0;
  private clockInitialised = false;
  /** Visual offset that absorbs a correction instead of teleporting. */
  private errorOffset: Vec3 = vec3();
  private pingTimer: number | null = null;

  constructor(events: NetEvents = {}) {
    this.events = events;
  }

  connect(url: string, name: string): void {
    this.disconnect();
    this.state = "connecting";
    try {
      this.socket = new WebSocket(url);
    } catch {
      this.state = "error";
      this.events.onError?.("could not open a connection");
      return;
    }

    this.socket.addEventListener("open", () => {
      this.state = "connected";
      this.send({ type: "join", version: PROTOCOL_VERSION, name });
      this.pingTimer = window.setInterval(() => {
        this.send({ type: "ping", time: Date.now() });
      }, 1000);
    });

    this.socket.addEventListener("message", (event) => {
      const message = decode<ServerMessage>(String(event.data));
      if (message) this.handle(message);
    });

    this.socket.addEventListener("close", () => {
      this.state = "closed";
      this.stopPing();
      this.events.onClose?.("connection closed");
    });

    this.socket.addEventListener("error", () => {
      this.state = "error";
      this.events.onError?.("connection failed");
    });
  }

  disconnect(): void {
    this.stopPing();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    this.state = "idle";
    this.selfId = null;
    this.welcome = null;
    this.latest = null;
    this.snapshots.length = 0;
    this.unacknowledged.length = 0;
    this.outbox.length = 0;
    this.clockInitialised = false;
    this.errorOffset = vec3();
  }

  get isLive(): boolean {
    return this.state === "connected" && this.selfId !== null;
  }

  private stopPing(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encode(message));
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case "welcome":
        this.welcome = message;
        this.selfId = message.id;
        this.clockOffset = message.serverTime - Date.now();
        this.clockInitialised = true;
        this.events.onWelcome?.(message);
        break;
      case "snapshot":
        this.receiveSnapshot(message);
        break;
      case "pong": {
        const rtt = Date.now() - message.time;
        // Smooth, so one slow packet does not swing lag compensation.
        this.rttMs = this.rttMs === 0 ? rtt : this.rttMs * 0.8 + rtt * 0.2;
        const offset = message.serverTime + rtt / 2 - Date.now();
        this.clockOffset = this.clockInitialised
          ? this.clockOffset * 0.9 + offset * 0.1
          : offset;
        this.clockInitialised = true;
        break;
      }
      case "error":
        this.state = "error";
        this.events.onError?.(message.reason);
        break;
    }
  }

  private receiveSnapshot(snapshot: SnapshotMessage): void {
    this.latest = snapshot;
    this.snapshots.push(snapshot);
    if (this.snapshots.length > SNAPSHOT_BUFFER) this.snapshots.shift();
    // Drop the input the server has already accounted for.
    while (this.unacknowledged.length > 0 && this.unacknowledged[0].seq <= snapshot.ack) {
      this.unacknowledged.shift();
    }
    this.events.onSnapshot?.(snapshot);
  }

  /** Queue one step of local input and send it on. */
  recordInput(frame: InputFrame, dt: number): void {
    if (!this.isLive) return;
    this.seq += 1;
    this.unacknowledged.push({ seq: this.seq, frame: { ...frame }, dt });
    if (this.unacknowledged.length > 120) this.unacknowledged.shift();

    this.outbox.push({
      seq: this.seq,
      dt: Math.round(dt * 10000) / 10000,
      moveX: roundAngle(frame.moveX),
      moveY: roundAngle(frame.moveY),
      yaw: roundAngle(frame.yaw),
      pitch: roundAngle(frame.pitch),
      sprint: frame.sprint,
      crouch: frame.crouch,
      fire: frame.fire,
      aim: frame.aim,
      reload: frame.reloadPressed,
      swap: frame.swapPressed,
    });
    // Resend a short tail, so one dropped packet costs nothing.
    if (this.outbox.length > 6) this.outbox.shift();
    this.send({ type: "input", commands: [...this.outbox] });
  }

  /**
   * Correct the predicted player against the server, then replay whatever the
   * server has not yet seen. Called once per snapshot.
   */
  reconcile(state: PlayerState, body: CollisionWorld): void {
    const snapshot = this.latest;
    if (!snapshot || !this.selfId) return;
    const authoritative = snapshot.players.find((entry) => entry.id === this.selfId);
    if (!authoritative) return;

    // Whatever survives the replay is genuine prediction error. It is carried
    // as a visual offset that decays, so a small correction is invisible
    // rather than a jolt.
    const result = reconcilePlayer(
      state,
      body,
      authoritative,
      this.unacknowledged,
      SNAP_DISTANCE,
    );
    this.errorOffset = result.error;
  }

  /** Decay the visual correction. Call once per rendered frame. */
  updateErrorOffset(deltaSeconds: number): Vec3 {
    const keep = Math.pow(ERROR_CORRECTION, deltaSeconds);
    this.errorOffset = vec3(
      this.errorOffset.x * keep,
      this.errorOffset.y * keep,
      this.errorOffset.z * keep,
    );
    return this.errorOffset;
  }

  /** The server clock as this client best understands it. */
  serverNow(): number {
    return Date.now() + this.clockOffset;
  }

  /**
   * Everyone but the local player, interpolated to a moment slightly in the
   * past so that motion is drawn from data that has actually arrived.
   */
  remoteViews(): RemoteView[] {
    if (this.snapshots.length === 0) return [];
    const target = this.serverNow() - INTERPOLATION_DELAY_MS;

    let before: SnapshotMessage | null = null;
    let after: SnapshotMessage | null = null;
    for (let i = this.snapshots.length - 1; i >= 0; i -= 1) {
      const candidate = this.snapshots[i];
      if (candidate.serverTime <= target) {
        before = candidate;
        after = this.snapshots[i + 1] ?? null;
        break;
      }
    }
    // Not enough history yet, or the target is older than everything held:
    // fall back to the oldest and newest snapshots available.
    if (!before) before = this.snapshots[0];
    if (!after) after = this.snapshots[this.snapshots.length - 1];

    const pair = bracket(
      [before, after].sort((a, b) => a.serverTime - b.serverTime),
      target,
    );
    const t = pair?.t ?? 0;

    const laterById = new Map(after.players.map((entry) => [entry.id, entry]));
    const views: RemoteView[] = [];
    for (const entry of before.players) {
      if (entry.id === this.selfId) continue;
      const next = laterById.get(entry.id) ?? entry;
      const blended = interpolateSnapshot(entry, next, t);
      views.push({
        id: entry.id,
        name: entry.name,
        team: entry.team,
        position: blended.position,
        yaw: blended.yaw,
        pitch: blended.pitch,
        dead: blended.dead,
        health: blended.health,
        firing: blended.firing,
      });
    }
    return views;
  }
}

export { roundPosition };
