import { aimForward } from "./aim";
import { resolveShot, hasLineOfSight, type HitscanWorld, type ShotResolution } from "./combat";
import { applyDamage, createHealth, stepHealth, type HealthState } from "./health";
import {
  activeWeapon,
  createLoadout,
  needsReload,
  stepLoadout,
  type LoadoutInput,
  type LoadoutState,
} from "./loadout";
import { findPathBetween, nearestNode, nodeWorldPosition, type NavGrid } from "./nav";
import type { Random } from "./random";
import { clamp, copy, lengthXZ, sub, vec3, type Vec3 } from "./vec3";
import type { WeaponId } from "./weapons";

export type Team = "a" | "b";

/** The local player's combatant id, shared by client and server. */
export const PLAYER_ID = "player";

/** Anything a bot can shoot at, including the player. */
export interface Combatant {
  id: string;
  team: Team;
  /** Where their eyes are, for line-of-sight tests. */
  eye: Vec3;
  /** Centre of mass, which is what bots aim at. */
  centre: Vec3;
  alive: boolean;
  velocity: Vec3;
}

export type BotBehaviour = "patrol" | "investigate" | "engage" | "reposition" | "dead";

export interface BotDifficulty {
  id: "recruit" | "regular" | "veteran";
  label: string;
  /** Seconds between seeing an enemy and pulling the trigger. */
  reactionTime: number;
  /** Aim error at rest, in degrees. */
  aimError: number;
  /** Extra error per metre per second of target movement, in degrees. */
  leadError: number;
  /** How fast they can swing onto a target, in radians per second. */
  turnRate: number;
  viewDistance: number;
  /** Half-angle of their vision cone, in radians. */
  viewHalfAngle: number;
  /** Seconds they keep firing before pausing, and the pause. */
  burstTime: number;
  burstPause: number;
  /** Seconds they keep hunting after losing sight. */
  memoryTime: number;
}

export const DIFFICULTIES: Record<BotDifficulty["id"], BotDifficulty> = {
  recruit: {
    id: "recruit",
    label: "Recruit",
    reactionTime: 0.8,
    aimError: 6.0,
    leadError: 0.9,
    turnRate: 2.2,
    viewDistance: 32,
    viewHalfAngle: 1.05,
    burstTime: 0.35,
    burstPause: 0.75,
    memoryTime: 2.5,
  },
  regular: {
    id: "regular",
    label: "Regular",
    reactionTime: 0.5,
    aimError: 3.2,
    leadError: 0.55,
    turnRate: 3.6,
    viewDistance: 45,
    viewHalfAngle: 1.25,
    burstTime: 0.5,
    burstPause: 0.45,
    memoryTime: 4.0,
  },
  veteran: {
    id: "veteran",
    label: "Veteran",
    reactionTime: 0.25,
    aimError: 1.5,
    leadError: 0.3,
    turnRate: 5.4,
    viewDistance: 60,
    viewHalfAngle: 1.45,
    burstTime: 0.75,
    burstPause: 0.28,
    memoryTime: 6.0,
  },
};

export const BOT = {
  /** Eye height and centre-of-mass height above the feet. */
  eyeHeight: 1.62,
  centreHeight: 1.05,
  headHeight: 1.66,
  radius: 0.36,
  height: 1.8,
  walkSpeed: 3.6,
  engageSpeed: 3.0,
  /** How close a waypoint must be before moving to the next one. */
  waypointRadius: 0.45,
  /** Seconds between path recalculations. */
  repathInterval: 0.9,
  /** Bots push apart inside this distance so they do not stack up. */
  separationRadius: 1.0,
  separationStrength: 3.5,
  /** Preferred distance from the enemy while engaging. */
  preferredRange: 11,
  /** Seconds before changing strafe direction. */
  strafeInterval: 1.4,
  /** Seconds between resampling aim error. */
  aimErrorInterval: 0.35,
  /** Vertical speed used to settle onto the navigation surface. */
  groundSnapSpeed: 6,
} as const;

export interface BotState {
  id: string;
  team: Team;
  name: string;
  difficulty: BotDifficulty;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  pitch: number;
  health: HealthState;
  loadout: LoadoutState;
  behaviour: BotBehaviour;
  path: Vec3[];
  pathIndex: number;
  repathTimer: number;
  /** Where the bot is currently heading, in world space. */
  destination: Vec3 | null;
  targetId: string | null;
  lastKnownPosition: Vec3 | null;
  reactionTimer: number;
  memoryTimer: number;
  burstTimer: number;
  firing: boolean;
  strafeSign: number;
  strafeTimer: number;
  aimErrorYaw: number;
  aimErrorPitch: number;
  aimErrorTimer: number;
  respawnTimer: number;
  kills: number;
  deaths: number;
}

export const botEye = (bot: BotState): Vec3 =>
  vec3(bot.position.x, bot.position.y + BOT.eyeHeight, bot.position.z);

export const botCentre = (bot: BotState): Vec3 =>
  vec3(bot.position.x, bot.position.y + BOT.centreHeight, bot.position.z);

export const botAsCombatant = (bot: BotState): Combatant => ({
  id: bot.id,
  team: bot.team,
  eye: botEye(bot),
  centre: botCentre(bot),
  alive: !bot.health.dead,
  velocity: bot.velocity,
});

export const createBot = (
  id: string,
  name: string,
  team: Team,
  difficulty: BotDifficulty,
  spawn: Vec3,
  yaw: number,
  weapons: readonly WeaponId[],
): BotState => ({
  id,
  team,
  name,
  difficulty,
  position: copy(spawn),
  velocity: vec3(),
  yaw,
  pitch: 0,
  health: createHealth(),
  loadout: createLoadout(weapons),
  behaviour: "patrol",
  path: [],
  pathIndex: 0,
  repathTimer: 0,
  destination: null,
  targetId: null,
  lastKnownPosition: null,
  reactionTimer: 0,
  memoryTimer: 0,
  burstTimer: 0,
  firing: false,
  strafeSign: 1,
  strafeTimer: 0,
  aimErrorYaw: 0,
  aimErrorPitch: 0,
  aimErrorTimer: 0,
  respawnTimer: 0,
  kills: 0,
  deaths: 0,
});

export interface BotWorld {
  grid: NavGrid;
  hitscan: HitscanWorld;
  /** Every combatant in the match, bots and player alike. */
  combatants: Combatant[];
  random: Random;
  /**
   * Whether one combatant should shoot another. Defaults to opposing teams,
   * which is team deathmatch; free-for-all passes a function that answers yes
   * for everyone but yourself.
   */
  isEnemy?: (self: { id: string; team: Team }, other: Combatant) => boolean;
}

/** Team deathmatch hostility: different team, and not yourself. */
export const defaultHostility = (
  self: { id: string; team: Team },
  other: Combatant,
): boolean => other.id !== self.id && other.team !== self.team;

/** A shot a bot fired, for the view layer to draw and the match to score. */
export interface BotShot {
  botId: string;
  origin: Vec3;
  resolution: ShotResolution;
  weapon: WeaponId;
}

/**
 * Advance one bot by a fixed step.
 *
 * Bots run the same weapon state machine as the player, so they obey the same
 * fire rates, reload times and recoil. Making them cheat by firing outside
 * those rules is the quickest way to make a shooter feel unfair.
 */
export const stepBot = (
  bot: BotState,
  world: BotWorld,
  dt: number,
  onShot: (shot: BotShot) => void,
): void => {
  stepHealth(bot.health, dt);

  if (bot.health.dead) {
    bot.behaviour = "dead";
    bot.firing = false;
    bot.respawnTimer = Math.max(0, bot.respawnTimer - dt);
    return;
  }

  updatePerception(bot, world, dt);
  updateBehaviour(bot, world, dt);
  updateAim(bot, world, dt);
  updateMovement(bot, world, dt);
  updateWeapon(bot, world, dt, onShot);
};

/** Find the best visible enemy, and remember where one was last seen. */
const updatePerception = (bot: BotState, world: BotWorld, dt: number): void => {
  const eye = botEye(bot);
  const forward = aimForward(bot.yaw, bot.pitch);
  const difficulty = bot.difficulty;

  let best: Combatant | null = null;
  let bestDistance = Infinity;

  const hostile = world.isEnemy ?? defaultHostility;
  for (const candidate of world.combatants) {
    if (!candidate.alive || !hostile(bot, candidate)) continue;
    const toTarget = sub(candidate.centre, eye);
    const distance = Math.hypot(toTarget.x, toTarget.y, toTarget.z);
    if (distance > difficulty.viewDistance || distance < 1e-3) continue;

    // Inside the vision cone, and not behind cover.
    const dot =
      (toTarget.x * forward.x + toTarget.y * forward.y + toTarget.z * forward.z) / distance;
    if (Math.acos(clamp(dot, -1, 1)) > difficulty.viewHalfAngle) continue;
    if (!hasLineOfSight(world.hitscan, eye, candidate.centre, candidate.id, bot.id)) continue;

    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (best) {
    if (bot.targetId !== best.id) {
      // A new target restarts the reaction delay, so bots cannot snap
      // instantly from one enemy to the next.
      bot.reactionTimer = difficulty.reactionTime;
    }
    bot.targetId = best.id;
    bot.lastKnownPosition = copy(best.centre);
    bot.memoryTimer = difficulty.memoryTime;
    bot.reactionTimer = Math.max(0, bot.reactionTimer - dt);
    return;
  }

  bot.memoryTimer = Math.max(0, bot.memoryTimer - dt);
  if (bot.memoryTimer <= 0) {
    bot.targetId = null;
    bot.lastKnownPosition = null;
  }
};

const visibleTarget = (bot: BotState, world: BotWorld): Combatant | null => {
  if (!bot.targetId) return null;
  const target = world.combatants.find((entry) => entry.id === bot.targetId);
  return target && target.alive ? target : null;
};

const updateBehaviour = (bot: BotState, world: BotWorld, dt: number): void => {
  const weapon = activeWeapon(bot.loadout);
  const target = visibleTarget(bot, world);
  const hurt = bot.health.current < 35;

  if (target && bot.memoryTimer > 0) {
    // Break contact to reload or when badly hurt, rather than standing in
    // the open losing a fight already lost.
    bot.behaviour = weapon.reloading || hurt ? "reposition" : "engage";
  } else if (bot.lastKnownPosition) {
    bot.behaviour = "investigate";
  } else {
    bot.behaviour = "patrol";
  }

  bot.repathTimer -= dt;
  if (bot.repathTimer > 0 && bot.path.length > 0) return;
  bot.repathTimer = BOT.repathInterval;
  chooseDestination(bot, world, target);
};

const chooseDestination = (
  bot: BotState,
  world: BotWorld,
  target: Combatant | null,
): void => {
  let destination: Vec3 | null = null;

  switch (bot.behaviour) {
    case "engage": {
      if (!target) break;
      // Close to a comfortable range, then hold there.
      const away = sub(bot.position, target.centre);
      const distance = lengthXZ(away);
      if (distance > BOT.preferredRange * 1.4) {
        destination = vec3(target.centre.x, target.centre.y, target.centre.z);
      } else if (distance < BOT.preferredRange * 0.5) {
        const scale = BOT.preferredRange / Math.max(0.1, distance);
        destination = vec3(
          target.centre.x + away.x * scale,
          bot.position.y,
          target.centre.z + away.z * scale,
        );
      }
      break;
    }
    case "reposition": {
      // Move away from where the enemy was last seen, which is the cheapest
      // approximation of cover that still reads as taking cover.
      const from = bot.lastKnownPosition ?? target?.centre;
      if (!from) break;
      const away = sub(bot.position, from);
      const distance = Math.max(0.5, lengthXZ(away));
      destination = vec3(
        bot.position.x + (away.x / distance) * 9,
        bot.position.y,
        bot.position.z + (away.z / distance) * 9,
      );
      break;
    }
    case "investigate":
      destination = bot.lastKnownPosition ? copy(bot.lastKnownPosition) : null;
      break;
    default: {
      const node = randomWalkableNode(world, bot);
      destination = node;
      break;
    }
  }

  if (!destination) {
    if (bot.behaviour === "engage") bot.path = [];
    return;
  }
  const path = findPathBetween(world.grid, bot.position, destination);
  bot.destination = destination;
  bot.path = path ?? [];
  bot.pathIndex = 0;
};

const randomWalkableNode = (world: BotWorld, bot: BotState): Vec3 | null => {
  const { grid, random } = world;
  if (grid.nodes.length === 0) return null;
  // Try a few times for somewhere worth walking to, rather than a step away.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const node = grid.nodes[Math.floor(random.next() * grid.nodes.length)];
    const position = nodeWorldPosition(grid, node);
    if (lengthXZ(sub(position, bot.position)) > 8) return position;
  }
  return null;
};

const updateAim = (bot: BotState, world: BotWorld, dt: number): void => {
  const target = visibleTarget(bot, world);
  const difficulty = bot.difficulty;

  bot.aimErrorTimer -= dt;
  if (bot.aimErrorTimer <= 0) {
    bot.aimErrorTimer = BOT.aimErrorInterval;
    const speed = target ? lengthXZ(target.velocity) : 0;
    // Error grows with how fast the target is moving: a sprinting player is
    // genuinely harder to track, and bots should feel that too.
    const spread = (difficulty.aimError + speed * difficulty.leadError) * (Math.PI / 180);
    bot.aimErrorYaw = (world.random.next() * 2 - 1) * spread;
    bot.aimErrorPitch = (world.random.next() * 2 - 1) * spread * 0.6;
  }

  const lookAt = target ? target.centre : bot.lastKnownPosition ?? nextWaypoint(bot);
  if (!lookAt) return;

  const eye = botEye(bot);
  const delta = sub(lookAt, eye);
  const horizontal = Math.hypot(delta.x, delta.z);
  const desiredYaw = Math.atan2(delta.x, delta.z) + bot.aimErrorYaw;
  const desiredPitch = Math.atan2(delta.y, Math.max(1e-4, horizontal)) + bot.aimErrorPitch;

  // Turning is rate limited, which is most of what separates a recruit from
  // a veteran: both know where you are, only one can get on target quickly.
  const rate = difficulty.turnRate * dt;
  bot.yaw = turnToward(bot.yaw, desiredYaw, rate);
  bot.pitch = clamp(turnToward(bot.pitch, desiredPitch, rate), -1.2, 1.2);
};

const nextWaypoint = (bot: BotState): Vec3 | null =>
  bot.pathIndex < bot.path.length ? bot.path[bot.pathIndex] : null;

/** Rotate toward an angle by at most `maxDelta`, the short way round. */
export const turnToward = (current: number, target: number, maxDelta: number): number => {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
};

const updateMovement = (bot: BotState, world: BotWorld, dt: number): void => {
  let moveX = 0;
  let moveZ = 0;

  const waypoint = nextWaypoint(bot);
  if (waypoint) {
    const delta = sub(waypoint, bot.position);
    const distance = lengthXZ(delta);
    if (distance <= BOT.waypointRadius) {
      bot.pathIndex += 1;
    } else {
      moveX += delta.x / distance;
      moveZ += delta.z / distance;
    }
  }

  // While fighting, slide sideways rather than walking straight at the enemy.
  if (bot.behaviour === "engage") {
    bot.strafeTimer -= dt;
    if (bot.strafeTimer <= 0) {
      bot.strafeTimer = BOT.strafeInterval;
      bot.strafeSign = world.random.next() < 0.5 ? -1 : 1;
    }
    const target = visibleTarget(bot, world);
    if (target) {
      const toTarget = sub(target.centre, bot.position);
      const distance = Math.max(0.1, lengthXZ(toTarget));
      moveX += (-toTarget.z / distance) * bot.strafeSign;
      moveZ += (toTarget.x / distance) * bot.strafeSign;
    }
  }

  // Push apart so a squad does not collapse into one body.
  for (const other of world.combatants) {
    if (other.id === bot.id || !other.alive) continue;
    const delta = sub(bot.position, other.centre);
    const distance = lengthXZ(delta);
    if (distance > BOT.separationRadius || distance < 1e-3) continue;
    const push = (BOT.separationRadius - distance) / BOT.separationRadius;
    moveX += (delta.x / distance) * push * BOT.separationStrength;
    moveZ += (delta.z / distance) * push * BOT.separationStrength;
  }

  const magnitude = Math.hypot(moveX, moveZ);
  const speed = bot.behaviour === "engage" ? BOT.engageSpeed : BOT.walkSpeed;
  if (magnitude > 1e-4) {
    bot.velocity.x = (moveX / magnitude) * speed;
    bot.velocity.z = (moveZ / magnitude) * speed;
    bot.position.x += bot.velocity.x * dt;
    bot.position.z += bot.velocity.z * dt;
  } else {
    bot.velocity.x = 0;
    bot.velocity.z = 0;
  }

  // Settle onto the navigation surface. Bots move kinematically across a grid
  // that is walkable by construction, so they need no collision pass of their
  // own; the grid is the collision.
  const node = nearestNode(world.grid, bot.position, 3);
  if (node) {
    const surfaceY = nodeWorldPosition(world.grid, node).y;
    const gap = surfaceY - bot.position.y;
    const step = BOT.groundSnapSpeed * dt;
    bot.position.y += clamp(gap, -step, step);
  }
};

const updateWeapon = (
  bot: BotState,
  world: BotWorld,
  dt: number,
  onShot: (shot: BotShot) => void,
): void => {
  const weapon = activeWeapon(bot.loadout);
  const target = visibleTarget(bot, world);

  // Fire only once the reaction delay has elapsed and the muzzle is roughly
  // on target, so a bot cannot shoot you while still turning around.
  let wantsFire = false;
  if (target && bot.reactionTimer <= 0 && bot.behaviour === "engage") {
    const eye = botEye(bot);
    const delta = sub(target.centre, eye);
    const distance = Math.hypot(delta.x, delta.y, delta.z);
    const forward = aimForward(bot.yaw, bot.pitch);
    const dot =
      (delta.x * forward.x + delta.y * forward.y + delta.z * forward.z) /
      Math.max(1e-4, distance);
    wantsFire = dot > 0.985;
  }

  // Break sustained fire into bursts.
  bot.burstTimer -= dt;
  if (bot.burstTimer <= 0) {
    bot.firing = wantsFire ? !bot.firing : false;
    bot.burstTimer = bot.firing ? bot.difficulty.burstTime : bot.difficulty.burstPause;
  }
  if (!wantsFire) bot.firing = false;

  const input: LoadoutInput = {
    fire: bot.firing && wantsFire,
    aim: bot.behaviour === "engage",
    reloadPressed: weapon.magazine === 0 && needsReload(weapon),
    swapPressed: false,
  };

  const shot = stepLoadout(
    bot.loadout,
    input,
    {
      speed: lengthXZ(bot.velocity),
      grounded: true,
      crouchAmount: 0,
      sprintOutTimer: 0,
      yaw: bot.yaw,
      pitch: bot.pitch,
    },
    dt,
    world.random,
  );

  if (!shot) return;
  const origin = botEye(bot);
  const resolution = resolveShot(shot, origin, world.hitscan, bot.id);
  onShot({ botId: bot.id, origin, resolution, weapon: shot.weapon.id });
};

/** Apply damage to a bot. Returns true when this killed it. */
export const damageBot = (
  bot: BotState,
  amount: number,
  fromYaw: number | null = null,
): boolean => applyDamage(bot.health, amount, fromYaw);

export const respawnBot = (bot: BotState, spawn: Vec3, yaw: number): void => {
  bot.position = copy(spawn);
  bot.velocity = vec3();
  bot.yaw = yaw;
  bot.pitch = 0;
  bot.health.current = 100;
  bot.health.dead = false;
  bot.health.regenTimer = 0;
  bot.health.sinceDamage = Infinity;
  bot.loadout = createLoadout(bot.loadout.weapons.map((entry) => entry.definition.id));
  bot.behaviour = "patrol";
  bot.path = [];
  bot.pathIndex = 0;
  bot.repathTimer = 0;
  bot.targetId = null;
  bot.lastKnownPosition = null;
  bot.memoryTimer = 0;
  bot.firing = false;
};
