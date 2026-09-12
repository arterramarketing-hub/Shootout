import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameAudio } from "./engine/audio";
import { FixedStepLoop, FpsMeter } from "./engine/loop";
import {
  QualityBenchmark,
  detectQuality,
  settingsFor,
  type QualitySettings,
} from "./engine/quality";
import { loadSettings, saveSettings, type GameSettings } from "./engine/settings";
import { Hud } from "./hud/hud";
import { Screens } from "./hud/screens";
import { InputManager } from "./input/inputManager";
import { greyboxMap } from "./maps/greybox";
import {
  DIFFICULTIES,
  botAsCombatant,
  createBot,
  damageBot,
  respawnBot,
  stepBot,
  type BotShot,
  type BotState,
  type Combatant,
  type Team,
} from "./sim/bots";
import { resolveShot, type ShotResolution } from "./sim/combat";
import { STANCE } from "./sim/config";
import { applyDamage, createHealth, revive, stepHealth } from "./sim/health";
import { activeWeapon, createLoadout, stepLoadout, type ShotEvent } from "./sim/loadout";
import {
  DEFAULT_MATCH,
  createMatch,
  recordKill,
  startMatch,
  stepMatch,
  type MatchState,
} from "./sim/match";
import { createPlayer, eyeOffset, stepPlayer } from "./sim/player";
import { createRandom } from "./sim/random";
import { damageTarget, stepTargets } from "./sim/targets";
import type { PlayerState } from "./sim/types";
import { copy, lengthXZ, sub, vec3, type Vec3 } from "./sim/vec3";
import { DEFAULT_LOADOUT } from "./sim/weapons";
import { BotField } from "./view/botView";
import { CameraRig } from "./view/cameraRig";
import { BabylonCollisionWorld } from "./view/collisionWorld";
import { ShotEffects } from "./view/effects";
import { BabylonHitscanWorld } from "./view/hitscanWorld";
import { buildNavGrid } from "./view/navBuilder";
import { PLAYER_ID, PlayerHitbox } from "./view/playerHitbox";
import { createScene } from "./view/scene";
import { TargetField } from "./view/targetView";
import { ViewmodelRig, WORLD_LAYER } from "./view/viewmodel";

/** Callsigns for the bots. Original, and short enough for a kill feed. */
const CALLSIGNS = [
  "Mercer", "Vale", "Kestrel", "Odom", "Brant", "Wilder",
  "Nyx", "Corbin", "Ash", "Rell", "Sable", "Tavish",
];

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element: ${id}`);
  return element as T;
};

const applyQuality = (engine: Engine, quality: QualitySettings): void => {
  // Rendering below the device's native pixel ratio is the single cheapest
  // way to hold a frame rate on a phone, and at arm's length it is invisible.
  const ratio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio);
  engine.setHardwareScalingLevel(1 / ratio);
};

const boot = (): void => {
  const canvas = byId<HTMLCanvasElement>("view");
  let settings: GameSettings = loadSettings();
  let quality =
    settings.quality === "auto" ? detectQuality() : settingsFor(settings.quality);

  const engine = new Engine(canvas, quality.antialias, {
    preserveDrawingBuffer: false,
    stencil: false,
    powerPreference: "high-performance",
    audioEngine: false,
    doNotHandleContextLost: false,
  });
  applyQuality(engine, quality);

  const { scene } = createScene(engine, greyboxMap, quality);
  const rig = new CameraRig(scene, quality, settings.fovDegrees);
  const viewmodel = new ViewmodelRig(scene);
  // The world camera must not draw the weapon, and the weapon camera must not
  // draw the world. Babylon clears depth between them, so the weapon never
  // intersects a wall it is standing next to.
  rig.camera.layerMask = WORLD_LAYER;
  scene.activeCameras = [rig.camera, viewmodel.camera];

  const world = new BabylonCollisionWorld(scene, STANCE.radius, STANCE.standHeight / 2);
  const hitscan = new BabylonHitscanWorld(scene);
  const targets = new TargetField(scene, greyboxMap.targets);
  const effects = new ShotEffects(scene);
  const audio = new GameAudio();
  const playerHitbox = new PlayerHitbox(scene);
  const botField = new BotField(scene);

  const spawn = greyboxMap.spawns[0];
  const spawnPosition = vec3(spawn.x, STANCE.standHeight / 2 + 0.05, spawn.z);
  world.setPosition(spawnPosition);

  const player: PlayerState = createPlayer(spawnPosition, spawn.yaw);
  const playerHealth = createHealth();
  const playerLoadout = createLoadout(DEFAULT_LOADOUT);
  const random = createRandom(0x51f2a3);
  let previousPosition = copy(player.position);
  let playerRespawnTimer = 0;

  const match: MatchState = createMatch({ ...DEFAULT_MATCH, teamSize: settings.teamSize });
  let bots: BotState[] = [];
  let combatants: Combatant[] = [];

  // The navigation grid is baked once, from the level itself. It is plain data
  // afterwards, which is what lets bot movement live in the engine-free
  // simulation alongside everything else.
  const nav = buildNavGrid(scene);
  console.info(
    `[shootout] navigation: ${nav.grid.nodes.length} nodes, ` +
      `${nav.raycasts} rays, ${nav.millis} ms`,
  );

  const input = new InputManager(canvas);
  input.look.yaw = spawn.yaw;
  input.attachJoystick(byId("joystick-base"), byId("joystick-knob"));
  input.registerButton("fire", byId("btn-fire"));
  input.registerButton("fire", byId("btn-fire-left"));
  input.registerButton("aim", byId("btn-aim"));
  input.registerButton("reload", byId("btn-reload"));
  input.registerButton("swap", byId("btn-swap"));
  input.start();

  const hud = new Hud({
    crosshair: byId("crosshair"),
    hitMarker: byId("hit-marker"),
    debug: byId("debug"),
    stance: byId("stance"),
    ammoCurrent: byId("ammo-current"),
    ammoReserve: byId("ammo-reserve"),
    weaponName: byId("weapon-name"),
    weaponClass: byId("weapon-class"),
    reloadHint: byId("reload-hint"),
    healthFill: byId("health-fill"),
    healthValue: byId("health-value"),
    damageVignette: byId("damage-vignette"),
    feed: byId("feed"),
    scoreA: byId("score-a"),
    scoreB: byId("score-b"),
    clock: byId("clock"),
    killFeed: byId("killfeed"),
    countdown: byId("countdown"),
    respawn: byId("respawn"),
    respawnTimer: byId("respawn-timer"),
    root: byId("hud"),
  });
  byId("btn-debug").addEventListener("click", () => hud.toggleDebug());

  const applySettings = (next: GameSettings): void => {
    settings = next;
    input.settings = {
      touchSensitivity: next.touchSensitivity,
      mouseSensitivity: next.mouseSensitivity,
      gyroScale: next.gyroScale,
      invertY: next.invertY,
    };
    if (next.gyroScale > 0) input.enableGyro();
    else input.disableGyro();
    audio.setEnabled(next.audioEnabled);
    hud.setScale(next.hudScale);
    const tier = next.quality === "auto" ? detectQuality() : settingsFor(next.quality);
    if (tier.tier !== quality.tier) {
      quality = tier;
      applyQuality(engine, quality);
    }
    saveSettings(next);
  };

  /** Spawn for a team, chosen to be as far as possible from living enemies. */
  const chooseSpawn = (team: Team): { position: Vec3; yaw: number } => {
    const options = greyboxMap.spawns.filter((point) => point.team === team);
    const enemies = combatants.filter((entry) => entry.alive && entry.team !== team);
    let best = options[0];
    let bestScore = -Infinity;
    for (const option of options) {
      let nearest = Infinity;
      for (const enemy of enemies) {
        nearest = Math.min(
          nearest,
          Math.hypot(enemy.centre.x - option.x, enemy.centre.z - option.z),
        );
      }
      if (nearest > bestScore) {
        bestScore = nearest;
        best = option;
      }
    }
    return { position: vec3(best.x, 0.05, best.z), yaw: best.yaw };
  };

  const nameFor = (index: number): string =>
    CALLSIGNS[index % CALLSIGNS.length] ?? `Bot ${index + 1}`;

  const createRoster = (): void => {
    for (const binding of botField.bindings) binding.root.dispose(false, true);
    botField.bindings.length = 0;
    bots = [];

    const difficulty = DIFFICULTIES[settings.difficulty];
    const perTeam = settings.teamSize;
    let index = 0;
    // The player takes one slot on blue, so blue fields one fewer bot.
    for (const team of ["a", "b"] as const) {
      const count = team === "a" ? Math.max(0, perTeam - 1) : perTeam;
      for (let i = 0; i < count; i += 1) {
        const point = greyboxMap.spawns.filter((entry) => entry.team === team)[
          i % greyboxMap.spawns.filter((entry) => entry.team === team).length
        ];
        // Bots carry a rifle and a sidearm; the player gets the full rack.
        const bot = createBot(
          `bot_${index}`,
          nameFor(index),
          team,
          difficulty,
          vec3(point.x, 0.05, point.z),
          point.yaw,
          i % 3 === 0 ? ["smg", "pistol"] : ["ar", "pistol"],
        );
        bots.push(bot);
        botField.add(bot);
        index += 1;
      }
    }
  };

  const rebuildCombatants = (): void => {
    combatants = [
      {
        id: PLAYER_ID,
        team: "a",
        eye: vec3(
          player.position.x,
          player.position.y + eyeOffset(player),
          player.position.z,
        ),
        centre: vec3(
          player.position.x,
          player.position.y + eyeOffset(player) - 0.5,
          player.position.z,
        ),
        alive: !playerHealth.dead,
        velocity: player.velocity,
      },
      ...bots.map(botAsCombatant),
    ];
  };

  const findCombatantName = (id: string): { name: string; team: Team } | null => {
    if (id === PLAYER_ID) return { name: "You", team: "a" };
    const bot = bots.find((entry) => entry.id === id);
    return bot ? { name: bot.name, team: bot.team } : null;
  };

  /** Apply one resolved shot's damage, and score any kills it caused. */
  const applyShotDamage = (
    resolution: ShotResolution,
    attackerId: string,
    attackerYaw: number,
  ): boolean => {
    let hitSomething = false;
    let headshot = false;

    for (const entry of resolution.damage) {
      const plate = targets.findState(entry.targetId);
      if (plate) {
        const dropped = damageTarget(plate, entry.damage, entry.headshot);
        if (dropped && attackerId === PLAYER_ID) audio.targetDrop();
        hitSomething = true;
        headshot = headshot || entry.headshot;
        continue;
      }

      const attacker = findCombatantName(attackerId);
      const victim = findCombatantName(entry.targetId);
      if (!attacker || !victim) continue;
      hitSomething = true;
      headshot = headshot || entry.headshot;

      let killed: boolean;
      if (entry.targetId === PLAYER_ID) {
        killed = applyDamage(playerHealth, entry.damage, attackerYaw);
        if (killed) playerRespawnTimer = match.config.respawnSeconds;
      } else {
        const bot = bots.find((candidate) => candidate.id === entry.targetId);
        if (!bot) continue;
        killed = damageBot(bot, entry.damage, attackerYaw);
        if (killed) {
          bot.respawnTimer = match.config.respawnSeconds;
          bot.deaths += 1;
        }
      }

      if (!killed) continue;
      const killerBot = bots.find((candidate) => candidate.id === attackerId);
      if (killerBot) killerBot.kills += 1;
      recordKill(match, {
        killerName: attacker.name,
        killerTeam: attacker.team,
        victimName: victim.name,
        victimTeam: victim.team,
        headshot: entry.headshot,
        byPlayer: attackerId === PLAYER_ID,
        againstPlayer: entry.targetId === PLAYER_ID,
      });
    }

    if (hitSomething && attackerId === PLAYER_ID) {
      hud.showHitMarker(headshot);
      audio.hitMarker(headshot);
    }
    return hitSomething;
  };

  /** Eye position, which is where the player's shots originate. */
  const eyePosition = () =>
    vec3(player.position.x, player.position.y + eyeOffset(player), player.position.z);

  const onPlayerShot = (shot: ShotEvent): void => {
    const origin = eyePosition();
    const resolution = resolveShot(shot, origin, hitscan, PLAYER_ID);

    audio.shot(shot.weapon.id);
    viewmodel.addRecoil(0.55 + shot.weapon.recoil.pattern[0][0] * 0.35, random.next());
    viewmodel.fireFlash(0.7 + random.next() * 0.6);
    const muzzle = viewmodel.muzzleWorldPosition();
    const tracerOrigin = muzzle ? vec3(muzzle.x, muzzle.y, muzzle.z) : origin;

    for (const impact of resolution.impacts) {
      effects.addPellet(tracerOrigin, impact);
      if (impact.hit && !impact.targetId) audio.impact(impact.distance);
    }
    applyShotDamage(resolution, PLAYER_ID, player.yaw);
  };

  const onBotShot = (shot: BotShot): void => {
    const bot = bots.find((entry) => entry.id === shot.botId);
    const distance = lengthXZ(sub(shot.origin, eyePosition()));
    audio.remoteShot(shot.weapon, distance);
    for (const impact of shot.resolution.impacts) {
      effects.addPellet(shot.origin, impact);
    }
    applyShotDamage(shot.resolution, shot.botId, bot?.yaw ?? 0);
  };

  const respawnPlayer = (): void => {
    const point = chooseSpawn("a");
    world.setPosition(vec3(point.position.x, player.halfHeight + 0.05, point.position.z));
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    input.look.yaw = point.yaw;
    input.look.pitch = 0;
    revive(playerHealth);
    // A fresh loadout, so dying is not also punished with an empty magazine.
    const fresh = createLoadout(DEFAULT_LOADOUT);
    Object.assign(playerLoadout, fresh);
  };

  const beginMatch = (): void => {
    applySettings(settings);
    match.config.teamSize = settings.teamSize;
    createRoster();
    rebuildCombatants();
    startMatch(match);
    respawnPlayer();
    playerRespawnTimer = 0;
    screens.show("game");
    audio.start();
    input.requestPointerLock();
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    void orientation?.lock?.("landscape").catch(() => undefined);
  };

  const screens = new Screens(settings, {
    onStart: beginMatch,
    onPlayAgain: beginMatch,
    onReturnToLobby: () => screens.show("lobby"),
    onSettingsChanged: applySettings,
  });
  applySettings(settings);

  const loop = new FixedStepLoop();
  const fpsMeter = new FpsMeter();
  const benchmark = new QualityBenchmark();
  let wasReloading = false;
  let previousMagazine = activeWeapon(playerLoadout).magazine;

  /**
   * Meshes currently enabled in the scene.
   * getActiveMeshes reports only the camera rendered last, which is the
   * weapon camera, so it would badly under-report the level.
   */
  const sceneMeshCount = () =>
    scene.meshes.reduce((n, mesh) => (mesh.isEnabled() ? n + 1 : n), 0);

  const stepSimulation = (dt: number, frame: ReturnType<typeof input.sample>): void => {
    const live = match.phase === "active";

    previousPosition = copy(player.position);
    stepPlayer(player, frame, dt, world);
    stepHealth(playerHealth, dt);
    stepTargets(targets.states, dt);
    stepMatch(match, dt);
    rebuildCombatants();

    if (playerRespawnTimer > 0) {
      playerRespawnTimer = Math.max(0, playerRespawnTimer - dt);
      if (playerRespawnTimer === 0) respawnPlayer();
    }

    const botWorld = { grid: nav.grid, hitscan, combatants, random };
    for (const bot of bots) {
      if (bot.health.dead) {
        bot.respawnTimer = Math.max(0, bot.respawnTimer - dt);
        if (bot.respawnTimer === 0) {
          const point = chooseSpawn(bot.team);
          respawnBot(bot, point.position, point.yaw);
        }
        continue;
      }
      // Bots hold still until the round actually starts.
      if (!live) continue;
      stepBot(bot, botWorld, dt, onBotShot);
    }

    // The player can always shoot the practice plates, but only scores during
    // a live round.
    const weapon = activeWeapon(playerLoadout);
    const canAct = !playerHealth.dead && (live || match.phase === "countdown");
    const shot = stepLoadout(
      playerLoadout,
      canAct ? frame : { fire: false, aim: false, reloadPressed: false, swapPressed: false },
      {
        speed: lengthXZ(player.velocity),
        grounded: player.grounded,
        crouchAmount: player.crouchAmount,
        sprintOutTimer: player.sprintOutTimer,
        yaw: player.yaw,
        pitch: player.pitch,
      },
      dt,
      random,
    );
    if (shot) onPlayerShot(shot);

    if (frame.fire && weapon.magazine === 0 && !weapon.reloading && weapon.reserve === 0) {
      audio.dryFire();
    }
    const reloadingNow = activeWeapon(playerLoadout).reloading;
    if (reloadingNow && !wasReloading) audio.reloadClick(1);
    if (!reloadingNow && wasReloading) audio.reloadClick(0.8);
    wasReloading = reloadingNow;
    const magazine = activeWeapon(playerLoadout).magazine;
    if (magazine > previousMagazine) audio.reloadClick(1.15);
    previousMagazine = magazine;

    if (match.phase === "over" && screens.activeScreen === "game") {
      screens.showResults(match);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  };

  engine.runRenderLoop(() => {
    const delta = engine.getDeltaTime() / 1000;
    if (!Number.isFinite(delta) || delta <= 0) return;

    fpsMeter.update(delta);
    const inGame = screens.activeScreen === "game";
    if (inGame) input.updateLook(input.isAiming);

    const timing = loop.advance(delta);
    const frame = input.sample();
    if (inGame) {
      for (let step = 0; step < timing.steps; step += 1) {
        stepSimulation(loop.stepSeconds, frame);
      }
    }
    input.endFrame();

    const weapon = activeWeapon(playerLoadout);
    const targetFov =
      settings.fovDegrees +
      (weapon.definition.adsFovDegrees - settings.fovDegrees) * playerLoadout.adsProgress;
    rig.blendFieldOfView(targetFov, delta);
    rig.update(
      previousPosition,
      player,
      timing.alpha,
      delta,
      playerLoadout.recoilPitch,
      playerLoadout.recoilYaw,
    );
    viewmodel.update(player, playerLoadout, rig.camera, delta);
    playerHitbox.update(player, !playerHealth.dead);
    botField.render(delta);
    targets.render();
    effects.update(delta);
    scene.render();

    hud.update({
      player,
      loadout: playerLoadout,
      health: playerHealth,
      match,
      respawnIn: playerRespawnTimer,
      fps: fpsMeter.value,
      tier: quality.tier,
      activeMeshes: sceneMeshCount(),
      deltaSeconds: delta,
    });

    // The GPU-string guess is unreliable, so measured frame times get the
    // final say and can step the tier down once, shortly after boot.
    if (settings.quality === "auto") {
      const demoted = benchmark.update(delta, quality.tier);
      if (demoted) {
        quality = settingsFor(demoted);
        applyQuality(engine, quality);
        console.info(`[shootout] quality demoted to ${demoted} after benchmark`);
      }
    }
  });

  const resize = () => {
    engine.resize();
    viewmodel.setFieldOfView();
  };
  window.addEventListener("resize", resize);
  window.addEventListener("orientationchange", () => {
    // Safari reports stale dimensions if resized on the same tick.
    window.setTimeout(resize, 120);
  });

  // Handle exposed for the end-to-end smoke test and for tuning from the console.
  Object.assign(window, {
    __shootout: {
      ready: true,
      get fps() {
        return fpsMeter.value;
      },
      get position() {
        return player.position;
      },
      get quality() {
        return quality.tier;
      },
      get activeMeshes() {
        return sceneMeshCount();
      },
      get forward() {
        const direction = rig.camera.getDirection(Vector3.Forward());
        return {
          x: +direction.x.toFixed(3),
          y: +direction.y.toFixed(3),
          z: +direction.z.toFixed(3),
        };
      },
      get pitch() {
        return +player.pitch.toFixed(3);
      },
      get yaw() {
        return +player.yaw.toFixed(3);
      },
      get weapon() {
        const current = activeWeapon(playerLoadout);
        return {
          id: current.definition.id,
          name: current.definition.name,
          magazine: current.magazine,
          reserve: current.reserve,
          reloading: current.reloading,
          ads: +playerLoadout.adsProgress.toFixed(3),
        };
      },
      get health() {
        return +playerHealth.current.toFixed(1);
      },
      get targets() {
        return targets.states.map((state) => ({
          id: state.id,
          health: Math.round(state.health),
          down: state.down,
        }));
      },
      get match() {
        return {
          phase: match.phase,
          scores: { ...match.scores },
          timeRemaining: Math.round(match.timeRemaining),
          kills: match.playerKills,
          deaths: match.playerDeaths,
          feed: match.feed.length,
        };
      },
      get bots() {
        return bots.map((bot) => ({
          id: bot.id,
          name: bot.name,
          team: bot.team,
          behaviour: bot.behaviour,
          health: Math.round(bot.health.current),
          dead: bot.health.dead,
          pathLength: bot.path.length,
          position: {
            x: +bot.position.x.toFixed(2),
            y: +bot.position.y.toFixed(2),
            z: +bot.position.z.toFixed(2),
          },
        }));
      },
      get nav() {
        return {
          nodes: nav.grid.nodes.length,
          cells: nav.grid.cols * nav.grid.rows,
          millis: nav.millis,
          raycasts: nav.raycasts,
        };
      },
      get screen() {
        return screens.activeScreen;
      },
      get settings() {
        return { ...settings };
      },
      startMatch: beginMatch,
      /** Development helper: drop the player at a spot on the map. */
      teleport(x: number, z: number, yaw?: number) {
        world.setPosition(vec3(x, player.halfHeight + 0.05, z));
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        input.look.pitch = 0;
        if (yaw !== undefined) input.look.yaw = yaw;
      },
      /** Development helper: exercise the health and damage HUD. */
      hurt(amount: number) {
        applyDamage(playerHealth, amount, player.yaw);
      },
      /**
       * Development helper: where the weapon sits on screen, as a fraction of
       * the viewport. Values inside 0 to 1 mean it is actually in frame.
       */
      weaponScreenPosition() {
        const current = activeWeapon(playerLoadout).definition.id;
        const mesh = scene.meshes.find((entry) => entry.name === `vm_${current}_0`);
        if (!mesh) return null;
        const width = engine.getRenderWidth();
        const height = engine.getRenderHeight();
        const projected = Vector3.Project(
          mesh.getAbsolutePosition(),
          Matrix.Identity(),
          scene.getTransformMatrix(),
          viewmodel.camera.viewport.toGlobal(width, height),
        );
        return {
          x: +(projected.x / width).toFixed(3),
          y: +(projected.y / height).toFixed(3),
        };
      },
      get scene() {
        return scene;
      },
    },
  });
};

boot();

// Offline support. Registration failures are never fatal: the game runs the
// same without a service worker, it just will not open without a network.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
  });
}
