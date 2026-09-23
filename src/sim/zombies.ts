import type { HitscanWorld } from "./combat";
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
  corpseSeconds: 3.2,
} as const;

/** How many come in a wave. */
export const waveSize = (wave: number): number => 6 + wave * 3;

/** How much a zombie of a given wave can take, before the rounds put it down. */
export const zombieHealth = (wave: number): number => Math.min(260, 80 + (wave - 1) * 14);

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
}

export interface SurvivalTarget {
  position: Vec3;
  alive: boolean;
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
): boolean => {
  if (zombie.dead || amount <= 0 || state.phase === "over") return false;
  zombie.health = Math.max(0, zombie.health - amount);
  if (zombie.health > 0) return false;
  zombie.dead = true;
  zombie.deathTime = 0;
  zombie.swing = 0;
  zombie.velocity = vec3();
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
  if (state.phase === "over") return;

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
        spawnZombie(state, at, world.random);
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

  if (state.phase === "wave" && state.toSpawn === 0 && aliveCount(state) === 0) {
    state.cleared = state.wave;
    events.onWaveCleared?.(state.wave);
    state.wave += 1;
    state.phase = "breather";
    state.timer = SURVIVAL.breather;
  }
};
