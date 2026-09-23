import { describe, expect, it } from "vitest";
import type { BoxBrush } from "../src/maps/types";
import { BrushWorld } from "../src/sim/brushWorld";
import { bakeNavGrid } from "../src/sim/navBake";
import { createRandom } from "../src/sim/random";
import { vec3 } from "../src/sim/vec3";
import {
  SURVIVAL,
  ZOMBIE,
  aliveCount,
  createSurvival,
  damageZombie,
  pickBreach,
  remaining,
  runnerShare,
  spawnZombie,
  stepSurvival,
  stepZombie,
  waveSize,
  zombieHealth,
  type ZombieWorld,
} from "../src/sim/zombies";

/** A flat yard forty metres across, with a wall across the middle of one half. */
const floor: BoxBrush = { kind: "floor", x: 0, y: -0.5, z: 0, width: 40, height: 1, depth: 40 };
const wall: BoxBrush = { kind: "wall", x: 0, y: 1.5, z: 5, width: 16, height: 3, depth: 0.4 };

const makeWorld = (brushes: BoxBrush[] = [floor]): ZombieWorld => {
  const hitscan = new BrushWorld(brushes);
  const { grid } = bakeNavGrid(hitscan, { halfExtent: 20 });
  return { grid, hitscan, random: createRandom(7) };
};

const DT = 1 / 60;

describe("waves", () => {
  it("grows every wave, and toughens", () => {
    for (let wave = 1; wave < 12; wave += 1) {
      expect(waveSize(wave + 1)).toBeGreaterThan(waveSize(wave));
      expect(zombieHealth(wave + 1)).toBeGreaterThanOrEqual(zombieHealth(wave));
    }
  });

  it("takes three rifle rounds to the body to drop a first-wave zombie", () => {
    // The rifle does thirty-four. Two leaves it standing; three puts it down.
    expect(zombieHealth(1)).toBeGreaterThan(34 * 2);
    expect(zombieHealth(1)).toBeLessThanOrEqual(34 * 3);
  });

  it("brings runners in from the third wave, never all of them", () => {
    expect(runnerShare(1)).toBe(0);
    expect(runnerShare(2)).toBe(0);
    expect(runnerShare(3)).toBeGreaterThan(0);
    expect(runnerShare(40)).toBeLessThan(0.5);
  });

  it("opens on a breather, then feeds the first wave in", () => {
    const world = makeWorld();
    const state = createSurvival();
    const target = { position: vec3(0, 0, 0), alive: true };
    const breaches = [{ x: 18, z: 18 }, { x: -18, z: -18 }];
    let started = 0;
    for (let t = 0; t < SURVIVAL.firstBreather - 0.1; t += DT) {
      stepSurvival(state, target, breaches, world, DT, { onWaveStart: () => (started += 1) });
    }
    expect(state.phase).toBe("breather");
    expect(state.zombies).toHaveLength(0);
    for (let t = 0; t < 0.3; t += DT) {
      stepSurvival(state, target, breaches, world, DT, { onWaveStart: () => (started += 1) });
    }
    expect(started).toBe(1);
    expect(state.phase).toBe("wave");
    expect(remaining(state)).toBe(waveSize(1));
    expect(aliveCount(state)).toBe(1);
  });

  it("never has more than the cap up at once", () => {
    const world = makeWorld();
    const state = createSurvival();
    state.wave = 20;
    state.timer = 0;
    // A survivor who cannot be reached, so nothing dies and the cap is tested.
    const target = { position: vec3(0, 0, 0), alive: false };
    for (let t = 0; t < 60; t += DT) {
      stepSurvival(state, target, [{ x: 18, z: 18 }], world, DT);
      expect(aliveCount(state)).toBeLessThanOrEqual(SURVIVAL.maxAlive);
    }
    expect(aliveCount(state)).toBe(SURVIVAL.maxAlive);
  });

  it("clears the wave when the last one is down, and calls the next", () => {
    const world = makeWorld();
    const state = createSurvival();
    state.timer = 0;
    const target = { position: vec3(0, 0, 0), alive: false };
    let cleared = 0;
    const events = { onWaveCleared: (wave: number) => (cleared = wave) };
    // Kill each one as it comes in.
    for (let t = 0; t < 60 && state.phase === "wave" || t < 0.1; t += DT) {
      stepSurvival(state, target, [{ x: 18, z: 18 }], world, DT, events);
      for (const zombie of state.zombies) damageZombie(state, zombie, 1000, false);
    }
    expect(cleared).toBe(1);
    expect(state.cleared).toBe(1);
    expect(state.wave).toBe(2);
    expect(state.phase).toBe("breather");
    expect(state.kills).toBe(waveSize(1));
  });
});

describe("breaches", () => {
  const random = createRandom(3);

  it("never brings one in next to the survivor", () => {
    const breaches = [
      { x: 3, z: 0 },
      { x: 30, z: 0 },
      { x: 0, z: 40 },
    ];
    for (let i = 0; i < 50; i += 1) {
      const chosen = pickBreach(breaches, vec3(0, 0, 0), random)!;
      expect(Math.hypot(chosen.x, chosen.z)).toBeGreaterThanOrEqual(SURVIVAL.minSpawnDistance);
    }
  });

  it("uses the farthest there is when every breach is close", () => {
    const chosen = pickBreach([{ x: 3, z: 0 }, { x: 9, z: 0 }], vec3(0, 0, 0), random)!;
    expect(chosen.x).toBe(9);
  });

  it("spreads a wave over more than one breach", () => {
    const breaches = Array.from({ length: 8 }, (_, i) => ({ x: 30 + i * 5, z: 0 }));
    const used = new Set<number>();
    for (let i = 0; i < 60; i += 1) used.add(pickBreach(breaches, vec3(0, 0, 0), random)!.x);
    expect(used.size).toBeGreaterThan(1);
  });
});

describe("a zombie", () => {
  it("walks the grid to the survivor, around a wall rather than through it", () => {
    const world = makeWorld([floor, wall]);
    const state = createSurvival();
    const zombie = spawnZombie(state, { x: 0, z: 12 }, world.random);
    const target = { position: vec3(0, 0, -2), alive: true };
    let throughWall = false;
    for (let t = 0; t < 30; t += DT) {
      const before = zombie.position.z;
      stepZombie(zombie, state.zombies, target, world, DT);
      // Crossing z = 5 anywhere the wall stands is walking through it.
      if ((before - 5) * (zombie.position.z - 5) < 0 && Math.abs(zombie.position.x) < 8) {
        throughWall = true;
      }
      if (Math.hypot(zombie.position.x, zombie.position.z + 2) < ZOMBIE.reach) break;
    }
    expect(throughWall).toBe(false);
    expect(Math.hypot(zombie.position.x, zombie.position.z + 2)).toBeLessThan(ZOMBIE.reach + 0.2);
  });

  it("telegraphs a swing, and it lands only on a survivor still in reach", () => {
    const world = makeWorld();
    const state = createSurvival();
    const zombie = spawnZombie(state, { x: 0, z: 1 }, world.random);
    const target = { position: vec3(0, 0, 0), alive: true };
    let hits = 0;
    const events = { onAttack: () => (hits += 1) };

    // First step: it starts the swing, and nothing lands yet.
    stepZombie(zombie, state.zombies, target, world, DT, events);
    expect(zombie.swing).toBeGreaterThan(0);
    expect(hits).toBe(0);
    // Stood still through the windup: it lands, once.
    for (let t = 0; t < ZOMBIE.windup + DT; t += DT) {
      stepZombie(zombie, state.zombies, target, world, DT, events);
    }
    expect(hits).toBe(1);

    // Next swing: step out of reach during the windup, and it misses.
    for (let t = 0; t < ZOMBIE.attackInterval; t += DT) {
      stepZombie(zombie, state.zombies, target, world, DT, events);
      if (zombie.swing > 0) break;
    }
    expect(zombie.swing).toBeGreaterThan(0);
    target.position = vec3(0, 0, -4);
    for (let t = 0; t < ZOMBIE.windup + DT; t += DT) {
      stepZombie(zombie, state.zombies, target, world, DT, events);
    }
    expect(hits).toBe(1);
  });

  it("does not swing at somebody a floor above it", () => {
    const world = makeWorld();
    const state = createSurvival();
    const zombie = spawnZombie(state, { x: 0, z: 0.5 }, world.random);
    const target = { position: vec3(0, 4.3, 0), alive: true };
    for (let t = 0; t < 2; t += DT) stepZombie(zombie, state.zombies, target, world, DT);
    expect(zombie.swing).toBe(0);
  });

  it("stands still for a survivor who is down", () => {
    const world = makeWorld();
    const state = createSurvival();
    const zombie = spawnZombie(state, { x: 0, z: 10 }, world.random);
    const start = { ...zombie.position };
    for (let t = 0; t < 2; t += DT) {
      stepZombie(zombie, state.zombies, { position: vec3(), alive: false }, world, DT);
    }
    expect(Math.hypot(zombie.position.x - start.x, zombie.position.z - start.z)).toBeLessThan(0.01);
  });

  it("keeps apart from the others instead of stacking", () => {
    const world = makeWorld();
    const state = createSurvival();
    const a = spawnZombie(state, { x: 0, z: 10 }, world.random);
    const b = spawnZombie(state, { x: 0.1, z: 10 }, world.random);
    const target = { position: vec3(0, 0, -10), alive: true };
    for (let t = 0; t < 3; t += DT) {
      for (const zombie of state.zombies) stepZombie(zombie, state.zombies, target, world, DT);
    }
    expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(0.4);
  });

  it("scores a kill, and a headshot, once", () => {
    const world = makeWorld();
    const state = createSurvival();
    const zombie = spawnZombie(state, { x: 0, z: 10 }, world.random);
    expect(damageZombie(state, zombie, 40, false)).toBe(false);
    expect(damageZombie(state, zombie, 1000, true)).toBe(true);
    expect(damageZombie(state, zombie, 1000, true)).toBe(false);
    expect(state.kills).toBe(1);
    expect(state.headshots).toBe(1);
  });

  it("clears a body away after it has lain a while", () => {
    const world = makeWorld();
    const state = createSurvival();
    state.phase = "wave";
    state.toSpawn = 0;
    const zombie = spawnZombie(state, { x: 0, z: 10 }, world.random);
    const other = spawnZombie(state, { x: 10, z: 10 }, world.random);
    damageZombie(state, zombie, 1000, false);
    const target = { position: vec3(0, 0, -15), alive: false };
    for (let t = 0; t < SURVIVAL.corpseSeconds + 0.2; t += DT) {
      stepSurvival(state, target, [], world, DT);
    }
    expect(state.zombies).toEqual([other]);
  });
});
