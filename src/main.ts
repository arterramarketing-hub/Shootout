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
import { loadProfile, saveProfile } from "./engine/profile";
import { loadSettings, saveSettings, type GameSettings } from "./engine/settings";
import { Hud } from "./hud/hud";
import { Screens } from "./hud/screens";
import { InputManager } from "./input/inputManager";
import { mapById } from "./maps";
import type { MapDefinition } from "./maps/types";
import {
  DIFFICULTIES,
  PLAYER_ID,
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
import { BrushWorld } from "./sim/brushWorld";
import { resolveShot, type ShotResolution } from "./sim/combat";
import { bakeNavGrid } from "./sim/navBake";
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
import { finishById } from "./sim/cosmetics";
import {
  applyMatchResult,
  unlockedWeapons,
  type MatchReward,
} from "./sim/progression";
import { createRandom } from "./sim/random";
import { damageTarget, stepTargets } from "./sim/targets";
import type { PlayerState } from "./sim/types";
import { copy, lengthXZ, sub, vec3, type Vec3 } from "./sim/vec3";
import { DEFAULT_LOADOUT } from "./sim/weapons";
import { NetClient } from "./net/client";
import { INTERPOLATION_DELAY_MS, type SnapshotMessage } from "./net/protocol";
import { BotField } from "./view/botView";
import { CameraRig } from "./view/cameraRig";
import { ShotEffects } from "./view/effects";
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

  // Everything below is rebuilt when the map changes, so the bindings are
  // mutable and the closures that capture them keep working across a swap.
  let activeMap: MapDefinition = mapById(settings.mapId);
  let scene!: ReturnType<typeof createScene>["scene"];
  let rig!: CameraRig;
  let viewmodel!: ViewmodelRig;
  let world!: BrushWorld;
  let body!: ReturnType<BrushWorld["createController"]>;
  let targets!: TargetField;
  let effects!: ShotEffects;
  let botField!: BotField;
  let nav!: ReturnType<typeof bakeNavGrid>;

  const buildWorld = (map: MapDefinition): void => {
    activeMap = map;
    scene?.dispose();

    scene = createScene(engine, map, quality).scene;
    rig = new CameraRig(scene, quality, settings.fovDegrees);
    viewmodel = new ViewmodelRig(scene);
    // The world camera must not draw the weapon, and the weapon camera must
    // not draw the world. Babylon clears depth between them, so the weapon
    // never intersects a wall it is standing next to.
    rig.camera.layerMask = WORLD_LAYER;
    scene.activeCameras = [rig.camera, viewmodel.camera];

    // One world serves collision, hitscan and navigation, in plain TypeScript.
    // The authoritative server runs this same class, which is what lets client
    // prediction land on the server's answer instead of near it.
    world = new BrushWorld(map.brushes);
    body = world.createController(STANCE.radius, STANCE.standHeight / 2);
    targets = new TargetField(scene, map.targets);
    effects = new ShotEffects(scene);
    botField = new BotField(scene);

    // The navigation grid is baked once per map, from the level itself.
    nav = bakeNavGrid(world);
    console.info(
      `[shootout] ${map.name}: ${nav.grid.nodes.length} nav nodes, ` +
        `${nav.raycasts} rays, ${nav.pruned} pruned, ${nav.millis} ms`,
    );
  };

  buildWorld(activeMap);

  const audio = new GameAudio();

  const spawn = activeMap.spawns[0];
  const spawnPosition = vec3(spawn.x, STANCE.standHeight / 2 + 0.05, spawn.z);
  body.setPosition(spawnPosition);

  const player: PlayerState = createPlayer(spawnPosition, spawn.yaw);
  const playerHealth = createHealth();
  const profile = loadProfile();
  // Levelling hands out weapons one at a time early on, so a new player has
  // two to learn rather than four.
  const carried = () => unlockedWeapons(profile, DEFAULT_LOADOUT);
  const playerLoadout = createLoadout(carried());
  const random = createRandom(0x51f2a3);
  let previousPosition = copy(player.position);
  let playerRespawnTimer = 0;

  const match: MatchState = createMatch({ ...DEFAULT_MATCH, teamSize: settings.teamSize });
  let bots: BotState[] = [];
  let combatants: Combatant[] = [];

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
    const options = activeMap.spawns.filter((point) => point.team === team);
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
    botField.clear();
    bots = [];

    const difficulty = DIFFICULTIES[settings.difficulty];
    const perTeam = settings.teamSize;
    let index = 0;
    // The player takes one slot on blue, so blue fields one fewer bot.
    for (const team of ["a", "b"] as const) {
      const count = team === "a" ? Math.max(0, perTeam - 1) : perTeam;
      for (let i = 0; i < count; i += 1) {
        const teamSpawns = activeMap.spawns.filter((entry) => entry.team === team);
        const point = teamSpawns[i % teamSpawns.length];
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
        index += 1;
      }
    }
  };

  /**
   * Publish everyone's hitboxes into the shared world.
   * Shooting resolves against these rather than against meshes, so the same
   * code decides a hit whether it runs here or on the server.
   */
  const syncHitboxes = (): void => {
    world.setHitboxes(
      PLAYER_ID,
      playerHealth.dead
        ? []
        : playerHitboxes(player.position.y + eyeOffset(player), player.position),
    );
    for (const bot of bots) {
      world.setHitboxes(bot.id, bot.health.dead ? [] : botHitboxes(bot.position));
    }
    for (const binding of targets.bindings) {
      // A folded plate is no longer a target, so it stops soaking rounds.
      world.setHitboxes(
        binding.state.id,
        binding.state.down
          ? []
          : [
              {
                center: vec3(binding.origin.x, binding.origin.y + 1.02, binding.origin.z),
                halfExtents: vec3(0.26, 0.48, 0.26),
                isHead: false,
              },
              {
                center: vec3(binding.origin.x, binding.origin.y + 1.63, binding.origin.z),
                halfExtents: vec3(0.12, 0.13, 0.12),
                isHead: true,
              },
            ],
      );
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

  /** Body and head boxes for a standing combatant, from their feet. */
  const botHitboxes = (position: Vec3) => [
    { center: vec3(position.x, position.y + 1.0, position.z), halfExtents: vec3(0.24, 0.52, 0.2), isHead: false },
    { center: vec3(position.x, position.y + 1.62, position.z), halfExtents: vec3(0.13, 0.14, 0.13), isHead: true },
  ];

  /** The player's boxes hang off the eye, which is where their stance is known. */
  const playerHitboxes = (eyeY: number, position: Vec3) => [
    { center: vec3(position.x, eyeY - 0.72, position.z), halfExtents: vec3(STANCE.radius, 0.65, STANCE.radius), isHead: false },
    { center: vec3(position.x, eyeY + 0.02, position.z), halfExtents: vec3(0.13, 0.13, 0.13), isHead: true },
  ];

  /** Eye position, which is where the player's shots originate. */
  const eyePosition = () =>
    vec3(player.position.x, player.position.y + eyeOffset(player), player.position.z);

  const onPlayerShot = (shot: ShotEvent): void => {
    const origin = eyePosition();
    const resolution = resolveShot(shot, origin, world, PLAYER_ID);

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
    body.setPosition(vec3(point.position.x, player.halfHeight + 0.05, point.position.z));
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    input.look.yaw = point.yaw;
    input.look.pitch = 0;
    revive(playerHealth);
    // A fresh loadout, so dying is not also punished with an empty magazine.
    Object.assign(playerLoadout, createLoadout(carried()));
  };

  /** Fold one authoritative snapshot into the local view of the world. */
  const applySnapshot = (snapshot: SnapshotMessage): void => {
    net.reconcile(player, body);

    const self = snapshot.players.find((entry) => entry.id === net.selfId);
    if (self) {
      // The server owns health, so the local value follows rather than leads.
      playerHealth.current = self.health;
      playerHealth.dead = self.dead;
      playerRespawnTimer = self.dead ? Math.max(playerRespawnTimer, 0.1) : 0;
    }

    for (const event of snapshot.damage) {
      playerHealth.sinceDamage = 0;
      playerHealth.lastDamageYaw = event.fromYaw;
    }

    for (const event of snapshot.kills) {
      const byMe = event.killer === net.selfId;
      const againstMe = event.victim === net.selfId;
      hud.pushFeed(
        `${event.killerName} ${event.headshot ? "headshot" : "killed"} ${event.victimName}`,
        byMe ? "down" : againstMe ? "hit" : "info",
      );
      match.feed.unshift({
        killerName: event.killerName,
        killerTeam: event.killerTeam,
        victimName: event.victimName,
        victimTeam: event.victimTeam,
        headshot: event.headshot,
        byPlayer: byMe,
        againstPlayer: againstMe,
      });
      if (match.feed.length > 6) match.feed.length = 6;
      if (byMe) {
        hud.showHitMarker(event.headshot);
        audio.hitMarker(event.headshot);
      }
    }

    // Everyone else's gunfire, drawn and heard from where it happened.
    const eye = eyePosition();
    for (const shot of snapshot.shots) {
      if (shot.shooter === net.selfId) continue;
      const origin = vec3(shot.ox, shot.oy, shot.oz);
      audio.remoteShot(shot.weapon, lengthXZ(sub(origin, eye)));
      for (const impact of shot.hits) {
        effects.addPellet(origin, {
          point: vec3(impact.x, impact.y, impact.z),
          normal: vec3(impact.nx, impact.ny, impact.nz),
          distance: 0,
          targetId: null,
          headshot: false,
          damage: 0,
          hit: true,
        });
      }
    }

    match.scores.a = snapshot.scores.a;
    match.scores.b = snapshot.scores.b;
    match.timeRemaining = snapshot.timeRemaining;
    match.phase = snapshot.phase === "over" ? "over" : "active";
  };

  const beginMatch = (): void => {
    applySettings(settings);

    if (settings.online) {
      if (settings.serverUrl === "") {
        screens.setNetStatus("enter a server address first", "error");
        return;
      }
      screens.setNetStatus(`connecting to ${settings.serverUrl}...`);
      // Online the server owns the loadout and hands everyone the full rack,
      // so levelling gates nothing there. Progression stays a solo concern
      // rather than turning into an advantage over other players.
      Object.assign(playerLoadout, createLoadout(DEFAULT_LOADOUT));
      net.connect(settings.serverUrl, settings.playerName);
      return;
    }

    online = false;
    net.disconnect();

    // Swapping the level rebuilds the scene, the collision world and the
    // navigation grid. Cheap enough to do between rounds, and it keeps one
    // set of per-map objects alive rather than several.
    const wanted = mapById(settings.mapId);
    if (wanted.id !== activeMap.id) buildWorld(wanted);
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

  const screens = new Screens(settings, profile, {
    onStart: beginMatch,
    onPlayAgain: beginMatch,
    onReturnToLobby: () => screens.show("lobby"),
    onSettingsChanged: applySettings,
    onFinishChanged: (finishId) => {
      // One finish covers the whole rack, which is the only thing a player
      // has asked for so far and keeps the lobby to a single row.
      for (const id of DEFAULT_LOADOUT) profile.equipped[id] = finishId;
      saveProfile(profile);
      viewmodel.setFinish(finishById(finishId));
    },
  });
  viewmodel.setFinish(finishById(profile.equipped.ar));
  applySettings(settings);

  const netStatusBar = byId("netbar");
  let online = false;

  const net = new NetClient({
    onWelcome: (message) => {
      online = true;
      screens.setNetStatus(`connected as ${message.name} on ${message.team === "a" ? "blue" : "rust"}`, "live");
      screens.show("game");
      audio.start();
      input.requestPointerLock();
    },
    onSnapshot: (snapshot) => applySnapshot(snapshot),
    onClose: () => {
      if (!online) return;
      online = false;
      screens.setNetStatus("disconnected from the server", "error");
      screens.show("lobby");
    },
    onError: (reason) => {
      online = false;
      screens.setNetStatus(reason, "error");
      screens.show("lobby");
    },
  });

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

  /**
   * One predicted step of the local player while connected.
   *
   * Movement and the weapon run locally so that the controls answer at once,
   * and the server's reply corrects whatever this got wrong. Damage is never
   * decided here; the server owns that, and the client only draws it.
   */
  const stepOnline = (dt: number, frame: ReturnType<typeof input.sample>): void => {
    previousPosition = copy(player.position);
    stepPlayer(player, frame, dt, body);
    net.recordInput(frame, dt);

    const shot = stepLoadout(
      playerLoadout,
      playerHealth.dead
        ? { fire: false, aim: false, reloadPressed: false, swapPressed: false }
        : frame,
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
    if (!shot) return;

    // Local feedback only: the muzzle flash, the kick, the sound and a tracer.
    audio.shot(shot.weapon.id);
    viewmodel.addRecoil(0.55 + shot.weapon.recoil.pattern[0][0] * 0.35, random.next());
    viewmodel.fireFlash(0.7 + random.next() * 0.6);
    const muzzle = viewmodel.muzzleWorldPosition();
    const origin = muzzle ? vec3(muzzle.x, muzzle.y, muzzle.z) : eyePosition();
    const local = resolveShot(shot, eyePosition(), world, PLAYER_ID);
    for (const impact of local.impacts) {
      effects.addPellet(origin, impact);
      if (impact.hit && !impact.targetId) audio.impact(impact.distance);
    }
  };

  /** Bank the round's experience, then show the scoreboard. */
  const finishRound = (): void => {
    const ownTeam: Team = "a";
    const reward: MatchReward = {
      kills: match.playerKills,
      headshots: match.playerHeadshots,
      deaths: match.playerDeaths,
      won: match.winner === ownTeam,
      ownScore: match.scores[ownTeam],
      otherScore: match.scores.b,
      completed: true,
    };
    const result = applyMatchResult(profile, reward);
    saveProfile(profile);
    screens.renderCareer(profile);
    viewmodel.setFinish(finishById(profile.equipped.ar));
    screens.showResults(match, reward, result.levels);
    if (document.pointerLockElement) document.exitPointerLock();
  };

  const stepSimulation = (dt: number, frame: ReturnType<typeof input.sample>): void => {
    const live = match.phase === "active";

    previousPosition = copy(player.position);
    stepPlayer(player, frame, dt, body);
    stepHealth(playerHealth, dt);
    stepTargets(targets.states, dt);
    stepMatch(match, dt);
    rebuildCombatants();

    if (playerRespawnTimer > 0) {
      playerRespawnTimer = Math.max(0, playerRespawnTimer - dt);
      if (playerRespawnTimer === 0) respawnPlayer();
    }

    syncHitboxes();
    const botWorld = { grid: nav.grid, hitscan: world, combatants, random };
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
      finishRound();
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
        if (online) stepOnline(loop.stepSeconds, frame);
        else stepSimulation(loop.stepSeconds, frame);
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

    if (online) {
      // Everyone else is drawn a little in the past, between the snapshots
      // that have actually arrived, rather than guessed forward.
      const views = net.remoteViews();
      for (const view of views) {
        botField.place(view.id, view.team, view.position, view.yaw, view.dead, delta);
      }
      botField.retain(new Set(views.map((view) => view.id)));
      net.updateErrorOffset(delta);
      netStatusBar.textContent =
        `${Math.round(net.rttMs)} ms · ${INTERPOLATION_DELAY_MS} ms interp · ${views.length + 1} players`;
      netStatusBar.classList.toggle("is-poor", net.rttMs > 150);
    } else {
      botField.renderBots(bots, delta);
      netStatusBar.textContent = "";
    }
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
      /** Horizontal speed, so a test can check pace without walking into a wall. */
      get speed() {
        return +lengthXZ(player.velocity).toFixed(3);
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
          pruned: nav.pruned,
        };
      },
      get screen() {
        return screens.activeScreen;
      },
      get map() {
        return { id: activeMap.id, name: activeMap.name };
      },
      get profile() {
        return {
          level: profile.level,
          xp: profile.xp,
          kills: profile.kills,
          carried: carried(),
        };
      },
      get settings() {
        return { ...settings };
      },
      startMatch: beginMatch,
      get net() {
        return {
          state: net.state,
          online,
          id: net.selfId,
          rtt: Math.round(net.rttMs),
          remotes: net.remoteViews().length,
          tick: net.latest?.tick ?? 0,
          phase: net.latest?.phase ?? null,
        };
      },
      /** Development helper: drop the player at a spot on the map. */
      teleport(x: number, z: number, yaw?: number) {
        body.setPosition(vec3(x, player.halfHeight + 0.05, z));
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
