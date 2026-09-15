import { WebSocketServer, type WebSocket } from "ws";
import { greyboxMap } from "../src/maps/greybox";
import {
  DIFFICULTIES,
  botAsCombatant,
  createBot,
  damageBot,
  respawnBot,
  stepBot,
  type BotState,
  type Combatant,
  type Team,
} from "../src/sim/bots";
import { BrushWorld, type CapsuleController } from "../src/sim/brushWorld";
import { bearingTo } from "../src/sim/aim";
import { resolveShot } from "../src/sim/combat";
import { STANCE, tickInterval } from "../src/sim/config";
import { applyDamage, createHealth, revive, stepHealth, type HealthState } from "../src/sim/health";
import {
  activeWeapon,
  createLoadout,
  stepLoadout,
  type LoadoutState,
} from "../src/sim/loadout";
import { bakeNavGrid } from "../src/sim/navBake";
import { createPlayer, eyeOffset, stepPlayer } from "../src/sim/player";
import { createRandom } from "../src/sim/random";
import { emptyInput, type InputFrame, type PlayerState } from "../src/sim/types";
import { copy, lengthXZ, vec3, type Vec3 } from "../src/sim/vec3";
import { DEFAULT_LOADOUT } from "../src/sim/weapons";
import { PositionHistory, rewindMillis } from "../src/net/history";
import {
  INTERPOLATION_DELAY_MS,
  PROTOCOL_VERSION,
  SERVER_TICK_RATE,
  SERVER_TICK_SECONDS,
  clampCommandDt,
  decode,
  encode,
  roundAngle,
  roundPosition,
  sanitiseName,
  type ClientMessage,
  type DamageEventMessage,
  type GameMode,
  type KillEventMessage,
  type PlayerSnapshot,
  type ShotEventMessage,
  type SnapshotMessage,
} from "../src/net/protocol";

const PORT = Number(process.env.PORT ?? 8080);
const MODE: GameMode = process.env.MODE === "ffa" ? "ffa" : "tdm";
const TEAM_SIZE = Math.max(1, Math.min(5, Number(process.env.TEAM_SIZE ?? 5)));
const DIFFICULTY = (process.env.DIFFICULTY ?? "regular") as keyof typeof DIFFICULTIES;
const ROUND_SECONDS = Number(process.env.ROUND_SECONDS ?? 360);
const SCORE_LIMIT = Number(process.env.SCORE_LIMIT ?? 50);
const RESPAWN_SECONDS = 4;

/** Bot callsigns. Original, and short enough to read in a kill feed. */
const CALLSIGNS = [
  "Mercer", "Vale", "Kestrel", "Odom", "Brant", "Wilder",
  "Nyx", "Corbin", "Ash", "Rell", "Sable", "Tavish",
];

interface HumanPlayer {
  id: string;
  name: string;
  team: Team;
  socket: WebSocket;
  state: PlayerState;
  body: CapsuleController;
  health: HealthState;
  loadout: LoadoutState;
  /** Commands received but not yet simulated, with the step each covers. */
  pending: { frame: InputFrame; seq: number; dt: number }[];
  lastAck: number;
  rttMs: number;
  respawnTimer: number;
  history: PositionHistory;
  kills: number;
  deaths: number;
  /** True while the last applied command held the trigger. */
  firing: boolean;
}

const world = new BrushWorld(greyboxMap.brushes);
const nav = bakeNavGrid(world);
const random = createRandom(0x9e3779b9);

const humans = new Map<string, HumanPlayer>();
const bots: BotState[] = [];
const botHistory = new Map<string, PositionHistory>();

let tick = 0;
let nextId = 1;
let phase: "warmup" | "active" | "over" = "warmup";
let timeRemaining = ROUND_SECONDS;
const scores: Record<Team, number> = { a: 0, b: 0 };

/** Per-tick event buffers, drained into the snapshot. */
let shotEvents: ShotEventMessage[] = [];
let killEvents: KillEventMessage[] = [];
let damageEvents: DamageEventMessage[] = [];

const now = (): number => Date.now();

// --- Combatant helpers ------------------------------------------------------

const humanEye = (player: HumanPlayer): Vec3 =>
  vec3(
    player.state.position.x,
    player.state.position.y + eyeOffset(player.state),
    player.state.position.z,
  );

const humanCentre = (player: HumanPlayer): Vec3 => {
  const eye = humanEye(player);
  return vec3(eye.x, eye.y - 0.5, eye.z);
};

const humanHitboxes = (position: Vec3, eyeY: number) => [
  {
    center: vec3(position.x, eyeY - 0.72, position.z),
    halfExtents: vec3(STANCE.radius, 0.65, STANCE.radius),
    isHead: false,
  },
  {
    center: vec3(position.x, eyeY + 0.02, position.z),
    halfExtents: vec3(0.13, 0.13, 0.13),
    isHead: true,
  },
];

const botHitboxes = (position: Vec3) => [
  {
    center: vec3(position.x, position.y + 1.0, position.z),
    halfExtents: vec3(0.24, 0.52, 0.2),
    isHead: false,
  },
  {
    center: vec3(position.x, position.y + 1.62, position.z),
    halfExtents: vec3(0.13, 0.14, 0.13),
    isHead: true,
  },
];

/**
 * In free-for-all everyone is hostile to everyone else. Teams still exist for
 * spawn placement and for the colours the client draws, they just stop
 * deciding who may be shot.
 */
const isEnemy = (self: { id: string; team: Team }, other: Combatant): boolean => {
  if (other.id === self.id) return false;
  return MODE === "ffa" ? true : other.team !== self.team;
};

const combatants = (): Combatant[] => {
  const list: Combatant[] = [];
  for (const player of humans.values()) {
    list.push({
      id: player.id,
      team: player.team,
      eye: humanEye(player),
      centre: humanCentre(player),
      alive: !player.health.dead,
      velocity: player.state.velocity,
    });
  }
  for (const bot of bots) list.push(botAsCombatant(bot));
  return list;
};

const displayName = (id: string): { name: string; team: Team } => {
  const human = humans.get(id);
  if (human) return { name: human.name, team: human.team };
  const bot = bots.find((entry) => entry.id === id);
  return bot ? { name: bot.name, team: bot.team } : { name: "Unknown", team: "a" };
};

/** Spawn point for a team, as far as possible from living enemies. */
const chooseSpawn = (team: Team, self: string): { position: Vec3; yaw: number } => {
  const options = greyboxMap.spawns.filter((point) => point.team === team);
  const enemies = combatants().filter(
    (entry) => entry.alive && isEnemy({ id: self, team }, entry),
  );
  let best = options[0];
  let bestScore = -Infinity;
  for (const option of options) {
    let nearest = Infinity;
    for (const enemy of enemies) {
      nearest = Math.min(nearest, Math.hypot(enemy.centre.x - option.x, enemy.centre.z - option.z));
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = option;
    }
  }
  return { position: vec3(best.x, STANCE.standHeight / 2 + 0.05, best.z), yaw: best.yaw };
};

// --- Roster -----------------------------------------------------------------

const teamCount = (team: Team): number => {
  let count = 0;
  for (const player of humans.values()) if (player.team === team) count += 1;
  for (const bot of bots) if (bot.team === team) count += 1;
  return count;
};

const smallerTeam = (): Team => (teamCount("a") <= teamCount("b") ? "a" : "b");

/** Keep both sides at the configured size by adding or removing bots. */
const balanceRoster = (): void => {
  for (const team of ["a", "b"] as const) {
    while (teamCount(team) > TEAM_SIZE) {
      const index = bots.findIndex((bot) => bot.team === team);
      if (index === -1) break;
      const [removed] = bots.splice(index, 1);
      botHistory.delete(removed.id);
      world.setHitboxes(removed.id, []);
    }
    while (teamCount(team) < TEAM_SIZE) {
      const id = `bot_${nextId++}`;
      const point = chooseSpawn(team, id);
      const bot = createBot(
        id,
        CALLSIGNS[bots.length % CALLSIGNS.length],
        team,
        DIFFICULTIES[DIFFICULTY] ?? DIFFICULTIES.regular,
        vec3(point.position.x, 0.05, point.position.z),
        point.yaw,
        bots.length % 3 === 0 ? ["smg", "pistol"] : ["ar", "pistol"],
      );
      bots.push(bot);
      botHistory.set(bot.id, new PositionHistory());
    }
  }
};

// --- Damage and scoring -----------------------------------------------------

const scoreKill = (killerId: string, victimId: string, headshot: boolean): void => {
  const killer = displayName(killerId);
  const victim = displayName(victimId);

  if (phase === "active") {
    // A team kill costs a point rather than earning one, in either mode.
    const friendly = MODE === "tdm" && killer.team === victim.team && killerId !== victimId;
    if (friendly) {
      scores[killer.team] = Math.max(0, scores[killer.team] - 1);
    } else if (killerId !== victimId) {
      scores[killer.team] += 1;
    }
    if (scores[killer.team] >= SCORE_LIMIT) endRound();
  }

  const killerHuman = humans.get(killerId);
  if (killerHuman && killerId !== victimId) killerHuman.kills += 1;
  const victimHuman = humans.get(victimId);
  if (victimHuman) victimHuman.deaths += 1;

  killEvents.push({
    killer: killerId,
    killerName: killer.name,
    killerTeam: killer.team,
    victim: victimId,
    victimName: victim.name,
    victimTeam: victim.team,
    headshot,
  });
};

const applyResolvedDamage = (
  resolution: ReturnType<typeof resolveShot>,
  attackerId: string,
  attackerOrigin: Vec3,
): void => {
  for (const entry of resolution.damage) {
    const victimHuman = humans.get(entry.targetId);
    if (victimHuman) {
      if (victimHuman.health.dead) continue;
      // Measured from the victim toward the shooter, which is the direction
      // the victim has to turn to find them.
      const bearing = bearingTo(victimHuman.state.position, attackerOrigin);
      const killed = applyDamage(victimHuman.health, entry.damage, bearing);
      damageEvents.push({
        victim: entry.targetId,
        amount: Math.round(entry.damage),
        fromBearing: roundAngle(bearing),
        headshot: entry.headshot,
      });
      if (killed) {
        victimHuman.respawnTimer = RESPAWN_SECONDS;
        scoreKill(attackerId, entry.targetId, entry.headshot);
      }
      continue;
    }

    const bot = bots.find((candidate) => candidate.id === entry.targetId);
    if (!bot || bot.health.dead) continue;
    const killed = damageBot(bot, entry.damage, bearingTo(bot.position, attackerOrigin));
    if (killed) {
      bot.respawnTimer = RESPAWN_SECONDS;
      bot.deaths += 1;
      scoreKill(attackerId, entry.targetId, entry.headshot);
    }
  }
};

/** Publish everyone's hitboxes at their current positions. */
const syncHitboxes = (): void => {
  for (const player of humans.values()) {
    world.setHitboxes(
      player.id,
      player.health.dead
        ? []
        : humanHitboxes(player.state.position, humanEye(player).y),
    );
  }
  for (const bot of bots) {
    world.setHitboxes(bot.id, bot.health.dead ? [] : botHitboxes(bot.position));
  }
};

/**
 * Resolve a human's shot against the world as it looked on their screen.
 *
 * Everyone else is rewound by half the round trip plus the interpolation delay
 * the client renders with. Without this, hitting a moving target over a
 * connection requires leading it by the latency, which no player can do and
 * none should have to.
 */
const resolveHumanShot = (
  player: HumanPlayer,
  shot: ReturnType<typeof stepLoadout>,
): void => {
  if (!shot) return;
  const rewind = rewindMillis(player.rttMs, INTERPOLATION_DELAY_MS);
  const at = now() - rewind;

  for (const other of humans.values()) {
    if (other.id === player.id) continue;
    const sample = other.history.sampleAt(at);
    if (!sample) continue;
    world.setHitboxes(
      other.id,
      sample.alive ? humanHitboxes(sample.position, sample.position.y + 0.75) : [],
    );
  }
  for (const bot of bots) {
    const sample = botHistory.get(bot.id)?.sampleAt(at);
    if (!sample) continue;
    world.setHitboxes(bot.id, sample.alive ? botHitboxes(sample.position) : []);
  }

  const origin = humanEye(player);
  const resolution = resolveShot(shot, origin, world, player.id);
  applyResolvedDamage(resolution, player.id, humanEye(player));

  shotEvents.push({
    shooter: player.id,
    weapon: shot.weapon.id,
    ox: roundPosition(origin.x),
    oy: roundPosition(origin.y),
    oz: roundPosition(origin.z),
    hits: resolution.impacts.map((impact) => ({
      x: roundPosition(impact.point.x),
      y: roundPosition(impact.point.y),
      z: roundPosition(impact.point.z),
      nx: roundAngle(impact.normal.x),
      ny: roundAngle(impact.normal.y),
      nz: roundAngle(impact.normal.z),
    })),
  });

  // Put everyone back where they actually are before the next shot resolves.
  syncHitboxes();
};

// --- Round flow -------------------------------------------------------------

const endRound = (): void => {
  phase = "over";
  timeRemaining = 0;
};

const startRound = (): void => {
  phase = "active";
  timeRemaining = ROUND_SECONDS;
  scores.a = 0;
  scores.b = 0;
  for (const player of humans.values()) {
    player.kills = 0;
    player.deaths = 0;
    respawnHuman(player);
  }
  for (const bot of bots) {
    const point = chooseSpawn(bot.team, bot.id);
    respawnBot(bot, vec3(point.position.x, 0.05, point.position.z), point.yaw);
  }
  console.log(`[server] round started: ${MODE}, ${TEAM_SIZE} per side`);
};

const respawnHuman = (player: HumanPlayer): void => {
  const point = chooseSpawn(player.team, player.id);
  player.body.setPosition(point.position);
  player.state.position = copy(point.position);
  player.state.velocity = vec3();
  player.state.yaw = point.yaw;
  player.state.pitch = 0;
  revive(player.health);
  Object.assign(player.loadout, createLoadout(DEFAULT_LOADOUT));
  player.respawnTimer = 0;
  player.history.clear();
};

// --- Simulation -------------------------------------------------------------

const stepHuman = (player: HumanPlayer, dt: number): void => {
  stepHealth(player.health, dt);

  if (player.respawnTimer > 0) {
    player.respawnTimer = Math.max(0, player.respawnTimer - dt);
    if (player.respawnTimer === 0) respawnHuman(player);
    return;
  }

  // Apply every command that arrived since the last tick. A client running at
  // sixty sends two per server tick; a stuttering one sends more, and the
  // backlog is capped so it cannot bank movement and spend it all at once.
  const commands = player.pending.splice(0, 8);
  if (commands.length === 0) {
    // No input: still advance physics so gravity and momentum apply.
    stepPlayer(
      player.state,
      { ...emptyInput(), yaw: player.state.yaw, pitch: player.state.pitch },
      dt,
      player.body,
    );
    return;
  }

  for (const command of commands) {
    // Each command is simulated for the span it actually covers, already
    // clamped on arrival. Using the server's own tick length here instead
    // would let a client running at sixty simulate two full ticks per tick,
    // and move at double speed for free.
    const { frame, dt: step } = command;
    stepPlayer(player.state, frame, step, player.body);
    player.firing = frame.fire;

    const shot = stepLoadout(
      player.loadout,
      frame,
      {
        speed: lengthXZ(player.state.velocity),
        grounded: player.state.grounded,
        crouchAmount: player.state.crouchAmount,
        sprintOutTimer: player.state.sprintOutTimer,
        yaw: player.state.yaw,
        pitch: player.state.pitch,
      },
      step,
      random,
    );
    if (shot && phase === "active" && !player.health.dead) resolveHumanShot(player, shot);
    player.lastAck = command.seq;
  }
};

const stepBots = (dt: number): void => {
  const list = combatants();
  const botWorld = { grid: nav.grid, hitscan: world, combatants: list, random, isEnemy };
  for (const bot of bots) {
    if (bot.health.dead) {
      bot.respawnTimer = Math.max(0, bot.respawnTimer - dt);
      if (bot.respawnTimer === 0) {
        const point = chooseSpawn(bot.team, bot.id);
        respawnBot(bot, vec3(point.position.x, 0.05, point.position.z), point.yaw);
      }
      continue;
    }
    if (phase !== "active") continue;
    stepBot(bot, botWorld, dt, (shot) => {
      applyResolvedDamage(shot.resolution, shot.botId, shot.origin);
      shotEvents.push({
        shooter: shot.botId,
        weapon: shot.weapon,
        ox: roundPosition(shot.origin.x),
        oy: roundPosition(shot.origin.y),
        oz: roundPosition(shot.origin.z),
        hits: shot.resolution.impacts.map((impact) => ({
          x: roundPosition(impact.point.x),
          y: roundPosition(impact.point.y),
          z: roundPosition(impact.point.z),
          nx: roundAngle(impact.normal.x),
          ny: roundAngle(impact.normal.y),
          nz: roundAngle(impact.normal.z),
        })),
      });
    });
  }
};

const recordHistory = (): void => {
  const time = now();
  for (const player of humans.values()) {
    player.history.record({
      time,
      position: copy(player.state.position),
      yaw: player.state.yaw,
      crouch: player.state.crouchAmount,
      alive: !player.health.dead,
    });
  }
  for (const bot of bots) {
    botHistory.get(bot.id)?.record({
      time,
      position: copy(bot.position),
      yaw: bot.yaw,
      crouch: 0,
      alive: !bot.health.dead,
    });
  }
};

const buildSnapshot = (player: HumanPlayer): SnapshotMessage => {
  const players: PlayerSnapshot[] = [];
  for (const other of humans.values()) {
    players.push({
      id: other.id,
      name: other.name,
      team: other.team,
      x: roundPosition(other.state.position.x),
      y: roundPosition(other.state.position.y),
      z: roundPosition(other.state.position.z),
      vx: roundPosition(other.state.velocity.x),
      vy: roundPosition(other.state.velocity.y),
      vz: roundPosition(other.state.velocity.z),
      yaw: roundAngle(other.state.yaw),
      pitch: roundAngle(other.state.pitch),
      health: Math.round(other.health.current),
      dead: other.health.dead,
      weapon: activeWeapon(other.loadout).definition.id,
      crouch: roundAngle(other.state.crouchAmount),
      firing: other.firing,
    });
  }
  for (const bot of bots) {
    players.push({
      id: bot.id,
      name: bot.name,
      team: bot.team,
      x: roundPosition(bot.position.x),
      y: roundPosition(bot.position.y),
      z: roundPosition(bot.position.z),
      vx: roundPosition(bot.velocity.x),
      vy: roundPosition(bot.velocity.y),
      vz: roundPosition(bot.velocity.z),
      yaw: roundAngle(bot.yaw),
      pitch: roundAngle(bot.pitch),
      health: Math.round(bot.health.current),
      dead: bot.health.dead,
      weapon: activeWeapon(bot.loadout).definition.id,
      crouch: 0,
      firing: bot.firing,
    });
  }

  return {
    type: "snapshot",
    tick,
    serverTime: now(),
    ack: player.lastAck,
    players,
    shots: shotEvents,
    kills: killEvents,
    // Only this player's own damage is worth sending; nobody else's matters.
    damage: damageEvents.filter((event) => event.victim === player.id),
    scores: { ...scores },
    phase,
    timeRemaining: Math.round(timeRemaining),
  };
};

const loop = (): void => {
  const dt = SERVER_TICK_SECONDS;
  tick += 1;

  if (phase === "active") {
    timeRemaining = Math.max(0, timeRemaining - dt);
    if (timeRemaining === 0) endRound();
  }
  if (phase === "warmup" && humans.size > 0) startRound();
  if (phase === "over" && humans.size > 0 && tick % (SERVER_TICK_RATE * 8) === 0) startRound();

  syncHitboxes();
  for (const player of humans.values()) stepHuman(player, dt);
  stepBots(dt);
  syncHitboxes();
  recordHistory();

  for (const player of humans.values()) {
    if (player.socket.readyState !== player.socket.OPEN) continue;
    player.socket.send(encode(buildSnapshot(player)));
  }

  shotEvents = [];
  killEvents = [];
  damageEvents = [];
};

// --- Connections ------------------------------------------------------------

const server = new WebSocketServer({ port: PORT });

server.on("connection", (socket) => {
  let player: HumanPlayer | null = null;

  socket.on("message", (raw) => {
    const message = decode<ClientMessage>(String(raw));
    if (!message) return;

    if (message.type === "join") {
      if (player) return;
      if (message.version !== PROTOCOL_VERSION) {
        socket.send(encode({ type: "error", reason: "protocol version mismatch" }));
        socket.close();
        return;
      }
      const id = `p_${nextId++}`;
      const team = smallerTeam();
      const spawn = chooseSpawn(team, id);
      const body = world.createController(STANCE.radius, STANCE.standHeight / 2);
      body.setPosition(spawn.position);

      player = {
        id,
        name: sanitiseName(message.name),
        team,
        socket,
        state: createPlayer(spawn.position, spawn.yaw),
        body,
        health: createHealth(),
        loadout: createLoadout(DEFAULT_LOADOUT),
        pending: [],
        lastAck: 0,
        rttMs: 60,
        respawnTimer: 0,
        history: new PositionHistory(),
        kills: 0,
        deaths: 0,
        firing: false,
      };
      humans.set(id, player);
      balanceRoster();

      socket.send(
        encode({
          type: "welcome",
          version: PROTOCOL_VERSION,
          id,
          name: player.name,
          team,
          tickRate: SERVER_TICK_RATE,
          mode: MODE,
          mapId: greyboxMap.id,
          serverTime: now(),
        }),
      );
      console.log(`[server] ${player.name} joined as ${id} on team ${team}`);
      return;
    }

    if (!player) return;

    if (message.type === "input") {
      if (!Array.isArray(message.commands)) return;
      for (const command of message.commands.slice(-8)) {
        // Ignore anything already applied, so a resent packet is harmless.
        if (typeof command.seq !== "number" || command.seq <= player.lastAck) continue;
        if (player.pending.some((entry) => entry.seq === command.seq)) continue;
        const step = clampCommandDt(command.dt);
        if (step === 0) continue;
        player.pending.push({
          seq: command.seq,
          dt: step,
          frame: {
            ...emptyInput(),
            moveX: clampAxis(command.moveX),
            moveY: clampAxis(command.moveY),
            yaw: Number(command.yaw) || 0,
            pitch: Number(command.pitch) || 0,
            sprint: Boolean(command.sprint),
            crouch: Boolean(command.crouch),
            fire: Boolean(command.fire),
            aim: Boolean(command.aim),
            reloadPressed: Boolean(command.reload),
            swapPressed: Boolean(command.swap),
          },
        });
      }
      // Cap the backlog: a client cannot bank movement and spend it in a burst.
      if (player.pending.length > 16) {
        player.pending.splice(0, player.pending.length - 16);
      }
      return;
    }

    if (message.type === "ping") {
      socket.send(encode({ type: "pong", time: message.time, serverTime: now() }));
      // The client reports its own measurement back in the next ping, but a
      // server-side estimate keeps lag compensation working either way.
      return;
    }
  });

  socket.on("close", () => {
    if (!player) return;
    console.log(`[server] ${player.name} left`);
    humans.delete(player.id);
    world.setHitboxes(player.id, []);
    balanceRoster();
  });

  socket.on("error", () => socket.close());
});

const clampAxis = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-1, Math.min(1, parsed));
};

balanceRoster();
setInterval(loop, Math.round(1000 / SERVER_TICK_RATE));

console.log(
  `[server] listening on ${PORT} · ${MODE} · ${TEAM_SIZE} per side · ` +
    `${nav.grid.nodes.length} nav nodes · client step ${tickInterval.toFixed(4)}s`,
);
