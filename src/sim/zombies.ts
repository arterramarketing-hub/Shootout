import type { HitscanWorld } from "./combat";
import { createFall, stepFall, type FallState } from "./fall";
import { HEALTH } from "./health";
import { findPathBetween, nearestNode, nodeWorldPosition, type NavGrid } from "./nav";
import type { Random } from "./random";
import { clamp, copy, lengthXZ, sub, vec3, type Vec3 } from "./vec3";

/**
 * Survival: waves of the dead, coming from every edge of the city.
 *
 * Engine-free, like the rest of the simulation. A run is a sequence of
 * waves; each wave is a number of zombies fed in through breaches around
 * the map a few at a time, and it is over when the last of them is down.
 * Between waves there is a breather — a few seconds to reload, heal and
 * pick a place to stand — and then the next one, bigger, tougher, and from
 * the third wave on, with runners in it.
 *
 * A zombie is simple on purpose. It knows where the survivor is, always;
 * it walks the navigation grid towards them, and when it is close enough
 * and nothing is in the way it stops following the grid and comes straight
 * at them. At arm's length it winds up a swing — telegraphed, so a survivor
 * who is paying attention can step out of it — and the swing lands only if
 * they are still there when it comes down.
 *
 * Nothing here draws anything and nothing here knows about the player's
 * weapons. Damage comes in through `damageZombie`, hits go out through the
 * `onAttack` callback, and the caller decides what either means.
 */

export const ZOMBIE = {
  /** Metres a second for a walker on the first wave. */
  walkSpeed: 1.7,
  /** Walkers get this much quicker every wave, up to the cap. */
  speedPerWave: 0.08,
  maxWalkSpeed: 2.6,
  /**
   * Runners: slower than a sprinting survivor and faster than a walking one,
   * which is what makes them the thing to deal with first.
   */
  runnerSpeed: 4.3,
  runnerFromWave: 3,
  /** Horizontal reach of a swing, from centre to centre, in metres. */
  reach: 1.35,
  /** How far apart in height a zombie and its target can be and still hit. */
  verticalReach: 1.3,
  damage: 20,
  /** Seconds between the start of one swing and the next. */
  attackInterval: 1.1,
  /**
   * Seconds from the start of a swing to the moment it lands.
   *
   * Long enough to see and short enough to punish standing still. A zombie
   * stops walking while it swings, so stepping back out of reach during it
   * is the counter.
   */
  windup: 0.45,
  /** Seconds between asking the grid for a new route. */
  repathInterval: 0.9,
  /** Inside this, with a clear line, a zombie stops pathing and comes straight on. */
  directRange: 5,
  separationRadius: 0.8,
  separationStrength: 3,
  groundSnapSpeed: 6,
  /** Radians a second a zombie turns to face where it is going. */
  turnRate: 6,
} as const;

export const SURVIVAL = {
  /** Seconds before the first wave, from the start of the run. */
  firstBreather: 5,
  /** Seconds between one wave being cleared and the next arriving. */
  breather: 10,
  /** Seconds between zombies coming in through the breaches. */
  spawnInterval: 1.1,
  /**
   * The most that are ever up at once, whatever the wave.
   *
   * A wave of forty is forty over time, not forty on screen: that keeps a
   * phone's frame rate where it was, and it keeps a late wave a siege rather
   * than a wall.
   */
  maxAlive: 14,
  /** Nothing comes in through a breach nearer the survivor than this. */
  minSpawnDistance: 22,
  /** Seconds a body stays down before it is cleared away. */
  /** Long enough to watch a body land and settle, and not much longer. */
  corpseSeconds: 5,
  /** The chance a zombie leaves ammunition where it fell. */
  dropChance: 0.35,
  /** How much of the rest of that chance an empty rack adds. */
  dropChanceWhenShort: 0.55,
  /** Runners carry more, for being harder to put down. */
  runnerDropBonus: 0.25,
  /** How close the survivor has to come to take a drop, in metres. */
  pickupRadius: 1.4,
  /** Seconds a drop lies there before it is gone. */
  pickupSeconds: 30,
  /** No more than this many drops on the ground at once; the oldest go first. */
  maxPickups: 12,
} as const;

/** How many come in a wave. */
export const waveSize = (wave: number): number => 6 + wave * 3;

/**
 * How much a zombie can take: three times what the survivor can.
 *
 * The same on every wave. Later waves are harder for being bigger, faster
 * and full of runners, not for being spongier, so what a rifle does to one
 * is something a player learns once.
 */
export const ZOMBIE_HEALTH = HEALTH.max * 3;
export const zombieHealth = (_wave: number): number => ZOMBIE_HEALTH;

/** The share of a wave that runs rather than walks. */
export const runnerShare = (wave: number): number =>
  wave < ZOMBIE.runnerFromWave ? 0 : Math.min(0.45, 0.12 * (wave - ZOMBIE.runnerFromWave + 1));

export interface ZombieState {
  id: string;
  position: Vec3;
  velocity: Vec3;
  yaw: number;
  health: number;
  maxHealth: number;
  dead: boolean;
  /** Seconds since it went down. */
  deathTime: number;
  runner: boolean;
  speed: number;
  path: Vec3[];
  pathIndex: number;
  repathTimer: number;
  /** Counts down to the next swing being allowed. */
  attackTimer: number;
  /** Counts down through a swing in progress; zero when not swinging. */
  swing: number;
  /** How the body is going down, once it is dead. */
  fall: FallState | null;
  /** Whether its drop has been decided. */
  dropRolled: boolean;
}

/** Ammunition left on the ground by a zombie. */
export interface AmmoPickup {
  id: string;
  position: Vec3;
  /** Seconds it has left before it is gone. */
  life: number;
}

/** Where the round that killed a zombie came from, and where it went in. */
export interface ZombieHit {
  from: Vec3;
  point: Vec3;
}

export type SurvivalPhase = "breather" | "wave" | "over";

export interface SurvivalState {
  phase: SurvivalPhase;
  /** The wave under way, or the one about to start during a breather. */
  wave: number;
  /** Seconds left in the breather. */
  timer: number;
  /** Zombies of this wave still to come in. */
  toSpawn: number;
  spawnTimer: number;
  zombies: ZombieState[];
  kills: number;
  headshots: number;
  /** The last wave cleared. */
  cleared: number;
  nextId: number;
  pickups: AmmoPickup[];
  nextPickupId: number;
}

export interface SurvivalTarget {
  position: Vec3;
  alive: boolean;
  /**
   * Nought to one: how short of ammunition the survivor is. Drops come more
   * often the emptier the rack, so a run is not lost to an empty magazine.
   */
  ammoNeed?: number;
}

/** What a zombie needs from the world: the grid to walk, and a way to see. */
export interface ZombieWorld {
  grid: NavGrid;
  hitscan: HitscanWorld;
  random: Random;
}

export interface SurvivalEvents {
  /** A swing landed on the survivor, from a zombie standing at `from`. */
  onAttack?: (damage: number, from: Vec3) => void;
  onWaveStart?: (wave: number) => void;
  onWaveCleared?: (wave: number) => void;
  /** A zombie has started a swing. */
  onSwing?: (zombie: ZombieState) => void;
  /** A zombie has come in through a breach. */
  onSpawn?: (zombie: ZombieState) => void;
  /** A body hit the ground, or a wall, this hard (metres a second). */
  onLand?: (zombie: ZombieState, impact: number) => void;
  /** A zombie left ammunition behind. */
  onDrop?: (pickup: AmmoPickup) => void;
  /** The survivor took a drop. */
  onPickup?: (pickup: AmmoPickup) => void;
}

export interface Breach {
  x: number;
  z: number;
  y?: number;
}

export const createSurvival = (): SurvivalState => ({
  phase: "breather",
  wave: 1,
  timer: SURVIVAL.firstBreather,
  toSpawn: 0,
  spawnTimer: 0,
  zombies: [],
  kills: 0,
  headshots: 0,
  cleared: 0,
  nextId: 0,
  pickups: [],
  nextPickupId: 0,
});

/** How many are up and fighting. */
export const aliveCount = (state: SurvivalState): number =>
  state.zombies.reduce((n, zombie) => (zombie.dead ? n : n + 1), 0);

/** How many of this wave are still to be put down, counting those not yet in. */
export const remaining = (state: SurvivalState): number =>
  state.phase === "wave" ? state.toSpawn + aliveCount(state) : 0;

/**
 * Choose where the next one comes in.
 *
 * Never within sight-and-sound of the survivor — nothing appears in front
 * of anybody — and otherwise one of the nearest few breaches that qualify,
 * so a wave arrives in a reasonable time and not always down the same
 * street.
 */
export const pickBreach = (
  breaches: readonly Breach[],
  from: Vec3,
  random: Random,
): Breach | null => {
  if (breaches.length === 0) return null;
  const ranked = breaches
    .map((breach) => ({ breach, distance: Math.hypot(breach.x - from.x, breach.z - from.z) }))
    .sort((a, b) => a.distance - b.distance);
  const far = ranked.filter((entry) => entry.distance >= SURVIVAL.minSpawnDistance);
  if (far.length === 0) return ranked[ranked.length - 1].breach;
  const choices = far.slice(0, 4);
  return choices[Math.floor(random.next() * choices.length)].breach;
};

export const spawnZombie = (
  state: SurvivalState,
  at: Breach,
  random: Random,
): ZombieState => {
  const wave = state.wave;
  const runner = random.next() < runnerShare(wave);
  const health = zombieHealth(wave);
  const zombie: ZombieState = {
    id: `zed_${state.nextId}`,
    position: vec3(at.x, at.y ?? 0, at.z),
    velocity: vec3(),
    yaw: Math.atan2(-at.x, -at.z),
    health,
    maxHealth: health,
    dead: false,
    deathTime: 0,
    runner,
    speed: runner
      ? ZOMBIE.runnerSpeed
      : Math.min(ZOMBIE.maxWalkSpeed, ZOMBIE.walkSpeed + (wave - 1) * ZOMBIE.speedPerWave),
    path: [],
    pathIndex: 0,
    // Staggered, so a group that came in together does not all ask the grid
    // for a route on the same tick.
    repathTimer: random.next() * ZOMBIE.repathInterval,
    attackTimer: 0,
    swing: 0,
    fall: null,
    dropRolled: false,
  };
  state.nextId += 1;
  state.zombies.push(zombie);
  return zombie;
};

/**
 * Put a round into a zombie. Returns true if that one put it down.
 *
 * Kills are scored here rather than by the caller, so the count the results
 * screen reads is the count the simulation kept.
 */
export const damageZombie = (
  state: SurvivalState,
  zombie: ZombieState,
  amount: number,
  headshot: boolean,
  hit?: ZombieHit,
): boolean => {
  if (zombie.dead || amount <= 0 || state.phase === "over") return false;
  zombie.health = Math.max(0, zombie.health - amount);
  if (zombie.health > 0) return false;
  zombie.dead = true;
  zombie.deathTime = 0;
  zombie.swing = 0;
  zombie.velocity = vec3();
  // The round that killed it decides how it goes down. Without one, it
  // falls back the way it was facing, as if shot from in front.
  const from = hit ? hit.from : vec3(
    zombie.position.x + Math.sin(zombie.yaw),
    zombie.position.y + 1.2,
    zombie.position.z + Math.cos(zombie.yaw),
  );
  const point = hit ? hit.point : vec3(zombie.position.x, zombie.position.y + 1.2, zombie.position.z);
  zombie.fall = createFall({
    dirX: point.x - from.x,
    dirZ: point.z - from.z,
    height: point.y - zombie.position.y,
    headshot,
    damage: amount,
  });
  state.kills += 1;
  if (headshot) state.headshots += 1;
  return true;
};

/** End the run: the survivor is down. */
export const endSurvival = (state: SurvivalState): void => {
  state.phase = "over";
};

const turnToward = (current: number, target: number, maxDelta: number): number => {
  let delta = target - current;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
};

/** Whether nothing solid stands between a zombie and its target. */
const clearLine = (world: ZombieWorld, zombie: ZombieState, target: Vec3): boolean => {
  const eye = vec3(zombie.position.x, zombie.position.y + 1.3, zombie.position.z);
  const aim = vec3(target.x, target.y + 1.0, target.z);
  const delta = sub(aim, eye);
  const distance = Math.hypot(delta.x, delta.y, delta.z);
  if (distance < 1e-3) return true;
  const direction = vec3(delta.x / distance, delta.y / distance, delta.z / distance);
  const hit = world.hitscan.raycast(eye, direction, distance, zombie.id);
  // Bodies are not walls: another zombie or the survivor in the way still
  // means the way is open.
  return !hit || hit.targetId !== null || hit.distance >= distance - 0.05;
};

/** How far a falling body can go along a direction before a wall. */
const roomAlong = (world: ZombieWorld, zombie: ZombieState, x: number, z: number): number => {
  const reach = 2.4;
  // Nothing within reach means nothing to stop it: a large finite number, so
  // it reads as measured and is not measured again.
  let room = 1e6;
  for (const height of [0.4, 1.1]) {
    const eye = vec3(zombie.position.x, zombie.position.y + height, zombie.position.z);
    const hit = world.hitscan.raycast(eye, vec3(x, 0, z), reach, zombie.id);
    // Other bodies are not walls; only the level stops a fall.
    if (hit && hit.targetId === null) room = Math.min(room, hit.distance);
  }
  return room;
};

/** One zombie, one step. */
export const stepZombie = (
  zombie: ZombieState,
  others: readonly ZombieState[],
  target: SurvivalTarget,
  world: ZombieWorld,
  dt: number,
  events: SurvivalEvents = {},
): void => {
  if (zombie.dead) {
    zombie.deathTime += dt;
    const fall = zombie.fall;
    if (fall) {
      if (!Number.isFinite(fall.roomAhead)) {
        fall.roomAhead = roomAlong(world, zombie, fall.dirX, fall.dirZ);
        fall.roomBehind = roomAlong(world, zombie, -fall.dirX, -fall.dirZ);
      }
      const step = stepFall(fall, dt);
      if (step.landed) events.onLand?.(zombie, step.impact);
    }
    return;
  }
  zombie.attackTimer = Math.max(0, zombie.attackTimer - dt);

  const toTarget = sub(target.position, zombie.position);
  const distance = lengthXZ(toTarget);
  const inReach =
    target.alive && distance <= ZOMBIE.reach && Math.abs(toTarget.y) <= ZOMBIE.verticalReach;

  // A swing in progress: stand, face them, and land it if they are still here.
  if (zombie.swing > 0) {
    zombie.velocity = vec3();
    if (distance > 1e-3) {
      zombie.yaw = turnToward(zombie.yaw, Math.atan2(toTarget.x, toTarget.z), ZOMBIE.turnRate * dt);
    }
    zombie.swing = Math.max(0, zombie.swing - dt);
    if (zombie.swing === 0 && inReach) events.onAttack?.(ZOMBIE.damage, copy(zombie.position));
    return;
  }

  if (inReach && zombie.attackTimer === 0) {
    zombie.swing = ZOMBIE.windup;
    zombie.attackTimer = ZOMBIE.attackInterval;
    zombie.velocity = vec3();
    events.onSwing?.(zombie);
    return;
  }

  let moveX = 0;
  let moveZ = 0;
  if (target.alive) {
    const close = distance < ZOMBIE.directRange && Math.abs(toTarget.y) < 1;
    if (close && clearLine(world, zombie, target.position)) {
      // Straight at them, stopping just inside reach rather than on top of them.
      if (distance > ZOMBIE.reach * 0.75) {
        moveX += toTarget.x / distance;
        moveZ += toTarget.z / distance;
      }
      zombie.path = [];
    } else {
      zombie.repathTimer -= dt;
      if (zombie.repathTimer <= 0 || zombie.pathIndex >= zombie.path.length) {
        zombie.repathTimer = ZOMBIE.repathInterval + world.random.next() * 0.3;
        zombie.path = findPathBetween(world.grid, zombie.position, target.position) ?? [];
        zombie.pathIndex = 0;
      }
      const waypoint = zombie.path[zombie.pathIndex];
      if (waypoint) {
        const delta = sub(waypoint, zombie.position);
        const gap = lengthXZ(delta);
        if (gap < 0.45) {
          zombie.pathIndex += 1;
        } else {
          moveX += delta.x / gap;
          moveZ += delta.z / gap;
        }
      }
    }
  }

  // Push apart, so a crowd is a crowd and not one body drawn fourteen times.
  for (const other of others) {
    if (other === zombie || other.dead) continue;
    const dx = zombie.position.x - other.position.x;
    const dz = zombie.position.z - other.position.z;
    const gap = Math.hypot(dx, dz);
    if (gap > ZOMBIE.separationRadius || gap < 1e-3) continue;
    const push = (ZOMBIE.separationRadius - gap) / ZOMBIE.separationRadius;
    moveX += (dx / gap) * push * ZOMBIE.separationStrength;
    moveZ += (dz / gap) * push * ZOMBIE.separationStrength;
  }

  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1e-4) {
    // Separation can add to the walk but never speed it past its own pace.
    const scale = Math.min(1, magnitude) / magnitude;
    zombie.velocity = vec3(moveX * scale * zombie.speed, 0, moveZ * scale * zombie.speed);
    zombie.position.x += zombie.velocity.x * dt;
    zombie.position.z += zombie.velocity.z * dt;
    zombie.yaw = turnToward(zombie.yaw, Math.atan2(moveX, moveZ), ZOMBIE.turnRate * dt);
  } else {
    zombie.velocity = vec3();
  }

  // Onto the grid's surface, the way bots settle: the grid is walkable by
  // construction, so it is all the collision a zombie needs.
  const node = nearestNode(world.grid, zombie.position, 3);
  if (node) {
    const surface = nodeWorldPosition(world.grid, node).y;
    const step = ZOMBIE.groundSnapSpeed * dt;
    zombie.position.y += clamp(surface - zombie.position.y, -step, step);
  }
};

/**
 * The run, one step: the breather counting down, a wave feeding in, every
 * zombie moving, the bodies cleared, the next wave called.
 */
export const stepSurvival = (
  state: SurvivalState,
  target: SurvivalTarget,
  breaches: readonly Breach[],
  world: ZombieWorld,
  dt: number,
  events: SurvivalEvents = {},
): void => {
  if (state.phase === "over") {
    // The run is over, but bodies already going down still finish falling.
    for (const zombie of state.zombies) {
      if (zombie.dead) stepZombie(zombie, state.zombies, target, world, dt, events);
    }
    return;
  }

  if (state.phase === "breather") {
    state.timer = Math.max(0, state.timer - dt);
    if (state.timer === 0) {
      state.phase = "wave";
      state.toSpawn = waveSize(state.wave);
      state.spawnTimer = 0;
      events.onWaveStart?.(state.wave);
    }
  }

  if (state.phase === "wave") {
    state.spawnTimer = Math.max(0, state.spawnTimer - dt);
    if (state.toSpawn > 0 && state.spawnTimer === 0 && aliveCount(state) < SURVIVAL.maxAlive) {
      const at = pickBreach(breaches, target.position, world.random);
      if (at) {
        const zombie = spawnZombie(state, at, world.random);
        events.onSpawn?.(zombie);
        state.toSpawn -= 1;
      }
      state.spawnTimer = SURVIVAL.spawnInterval;
    }
  }

  for (const zombie of state.zombies) {
    stepZombie(zombie, state.zombies, target, world, dt, events);
  }
  state.zombies = state.zombies.filter(
    (zombie) => !zombie.dead || zombie.deathTime < SURVIVAL.corpseSeconds,
  );
  stepPickups(state, target, world, dt, events);

  if (state.phase === "wave" && state.toSpawn === 0 && aliveCount(state) === 0) {
    state.cleared = state.wave;
    events.onWaveCleared?.(state.wave);
    state.wave += 1;
    state.phase = "breather";
    state.timer = SURVIVAL.breather;
  }
};

/** The chance a zombie leaves a drop, given how short the survivor is. */
export const dropChance = (zombie: ZombieState, ammoNeed: number): number => {
  const need = clamp(ammoNeed, 0, 1);
  const base = SURVIVAL.dropChance + (zombie.runner ? SURVIVAL.runnerDropBonus : 0);
  return Math.min(1, base + (1 - base) * SURVIVAL.dropChanceWhenShort * need);
};

/**
 * Drops: rolled for each body once, where it came to rest; taken by walking
 * over them; gone after a while.
 */
const stepPickups = (
  state: SurvivalState,
  target: SurvivalTarget,
  world: ZombieWorld,
  dt: number,
  events: SurvivalEvents,
): void => {
  for (const zombie of state.zombies) {
    if (!zombie.dead || zombie.dropRolled) continue;
    // Rolled once the body has come down, and left where it lies.
    if (zombie.fall && !zombie.fall.landed && zombie.deathTime < 1.5) continue;
    zombie.dropRolled = true;
    if (world.random.next() >= dropChance(zombie, target.ammoNeed ?? 0)) continue;
    const fall = zombie.fall;
    // Beside the body, on the side it did not fall towards.
    const along = fall ? fall.slide : 0;
    const pickup: AmmoPickup = {
      id: `ammo_${state.nextPickupId}`,
      position: vec3(
        zombie.position.x + (fall ? fall.dirX * along : 0),
        zombie.position.y,
        zombie.position.z + (fall ? fall.dirZ * along : 0),
      ),
      life: SURVIVAL.pickupSeconds,
    };
    state.nextPickupId += 1;
    state.pickups.push(pickup);
    if (state.pickups.length > SURVIVAL.maxPickups) state.pickups.shift();
    events.onDrop?.(pickup);
  }

  const kept: AmmoPickup[] = [];
  for (const pickup of state.pickups) {
    pickup.life -= dt;
    if (pickup.life <= 0) continue;
    const dx = pickup.position.x - target.position.x;
    const dz = pickup.position.z - target.position.z;
    const dy = pickup.position.y - target.position.y;
    if (target.alive && Math.hypot(dx, dz) <= SURVIVAL.pickupRadius && Math.abs(dy) < 1.5) {
      events.onPickup?.(pickup);
      continue;
    }
    kept.push(pickup);
  }
  state.pickups = kept;
};
