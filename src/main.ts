import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameAudio } from "./engine/audio";
import { ZombieVoices } from "./engine/zombieAudio";
import { FixedStepLoop, FpsMeter } from "./engine/loop";
import {
  QualityBenchmark,
  detectQuality,
  settingsFor,
  type QualitySettings,
} from "./engine/quality";
import { loadProfile, saveProfile } from "./engine/profile";
import {
  defaultServerUrl,
  loadSettings,
  saveSettings,
  type GameSettings,
} from "./engine/settings";
import { Hud } from "./hud/hud";
import { LiveBoard, type BoardRow } from "./hud/liveBoard";
import { Screens } from "./hud/screens";
import { InputManager } from "./input/inputManager";
import { mapById } from "./maps";
import { boulevardSurvivalMap } from "./maps/boulevard";
import { mistDistance, type MapDefinition } from "./maps/types";
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
import { nearestNode } from "./sim/nav";
import { pickSpawn } from "./sim/spawn";
import { CAMERA, STANCE } from "./sim/config";
import {
  applyDamage,
  createHealth,
  endSpawnProtection,
  revive,
  stepHealth,
} from "./sim/health";
import {
  activeWeapon,
  createLoadout,
  isSwapping,
  stepLoadout,
  type ShotEvent,
} from "./sim/loadout";
import {
  DEFAULT_MATCH,
  createMatch,
  recordKill,
  startMatch,
  stepMatch,
  type MatchState, damageAllowed } from "./sim/match";
import { addLookOffset } from "./sim/look";
import { createPlayer, eyeOffset, stanceHalfHeight, stepPlayer } from "./sim/player";
import { finishById } from "./sim/cosmetics";
import {
  applyMatchResult,
  unlockedWeapons,
  type MatchReward,
} from "./sim/progression";
import { bearingTo } from "./sim/aim";
import { createRandom } from "./sim/random";
import type { PlayerState } from "./sim/types";
import { copy, lengthXZ, sub, vec3, type Vec3 } from "./sim/vec3";
import { DEFAULT_LOADOUT } from "./sim/weapons";
import {
  createSurvival,
  damageZombie,
  endSurvival,
  remaining,
  spawnZombie,
  stepSurvival,
  type Breach,
  type SurvivalState,
} from "./sim/zombies";
import type { SurvivalReadout } from "./hud/hud";
import { NetClient } from "./net/client";
import { INTERPOLATION_DELAY_MS, type SnapshotMessage } from "./net/protocol";
import { BotField } from "./view/botView";
import { CameraRig } from "./view/cameraRig";
import { ShotEffects } from "./view/effects";
import { addGlow, addSunShadows, createScene } from "./view/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ContactShadows } from "./view/contactShadow";
import type { CascadedShadowGenerator } from "@babylonjs/core/Lights/Shadows/cascadedShadowGenerator";
import { ViewmodelRig, WORLD_LAYER } from "./view/viewmodel";
import { PickupField } from "./view/pickups";

/** Callsigns for the bots. Original, and short enough for a kill feed. */
/**
 * How far out along the muzzle's screen ray a tracer starts, in metres.
 *
 * Far enough that the tracer clears the drawn barrel; close enough that it
 * still comes from the gun rather than from a point in front of it.
 */
const TRACER_START = 0.9;

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
  let effects!: ShotEffects;
  let botField!: BotField;
  let pickupField!: PickupField;
  let sun: CascadedShadowGenerator | null = null;
  let shadowPatches!: ContactShadows;
  let selfShadow!: Mesh;
  let nav!: ReturnType<typeof bakeNavGrid>;

  const buildWorld = (map: MapDefinition): void => {
    activeMap = map;
    scene?.dispose();

    const built = createScene(engine, map, quality);
    scene = built.scene;
    rig = new CameraRig(scene, quality, settings.fovDegrees);
    // Mist closes the far plane in to where it has gone opaque: nothing past
    // that could be seen, so nothing past it is drawn.
    if (map.style.mist) {
      rig.camera.maxZ = Math.min(rig.camera.maxZ, mistDistance(map.style.mist));
    }
    // A night has no sun to cast shadows, and no shadow maps to pay for.
    sun = quality.shadows && !map.style.night ? addSunShadows(built, rig.camera, quality) : null;
    if (built.torch) {
      // Held at the right shoulder and pointed where the player looks.
      built.torch.parent = rig.camera;
      built.torch.position.set(0.22, -0.12, 0.1);
      built.torch.direction.set(-0.02, 0.01, 1);
    }
    // Tracers, impacts and strip lights bloom on anything but the weakest
    // tier: it is one small blurred buffer, and it is what makes a round
    // going past read as hot rather than as a yellow stick.
    if (quality.tier !== "low") addGlow(built, rig.camera);
    viewmodel = new ViewmodelRig(scene);
    viewmodel.setLightLevel(map.style.night ? 0.45 : 1);
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
    effects = new ShotEffects(scene);
    shadowPatches = new ContactShadows(scene, map.style.keyDirection);
    // Figures either cast the sun's shadow or have one laid along the sun
    // for them. One of the two, never neither: a figure with nothing under
    // it floats over the ground it is standing on, and at range that is the
    // difference between a shot and a guess.
    botField = new BotField(scene, sun ? null : shadowPatches);
    pickupField = new PickupField(scene);
    botField.onFigure = (mesh) => sun?.addShadowCaster(mesh, false);

    // The player's own, on every tier. Nobody is standing there to cast one:
    // in first person the camera is the whole character.
    selfShadow = shadowPatches.create();

    // The navigation grid is baked once per map, from the level itself.
    nav = bakeNavGrid(world, activeMap.nav);
    console.info(
      `[shootout] ${map.name}: ${nav.grid.nodes.length} nav nodes, ` +
        `${nav.raycasts} rays, ${nav.pruned} pruned, ${nav.millis} ms`,
    );
  };

  buildWorld(activeMap);

  const audio = new GameAudio();
  const zombieVoices = new ZombieVoices(() => audio.bus());

  const spawn = activeMap.spawns[0];
  const spawnPosition = vec3(spawn.x, (spawn.y ?? 0) + STANCE.standHeight / 2 + 0.05, spawn.z);
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
  /*
   * Footsteps are paced by ground covered rather than by a timer, so they
   * keep step with the camera's own bob however fast the player is moving.
   * The camera dips once per footfall and sways once per stride, which puts
   * a step every half cycle of the bob.
   */
  const STEP_DISTANCE = 1 / (2 * CAMERA.bobFrequency);
  let walkedSinceStep = 0;
  let lastBobDistance = player.bobDistance;
  let lastLandingOffset = player.landingOffset;
  let debugInvulnerable = false;
  let playerRespawnTimer = 0;

  const match: MatchState = createMatch({ ...DEFAULT_MATCH, teamSize: settings.teamSize });
  let bots: BotState[] = [];
  let combatants: Combatant[] = [];
  /** The newest roster the server sent, empty while playing offline. */
  let netRoster: BoardRow[] = [];

  /** The run in progress while playing survival; null in team deathmatch. */
  let survival: SurvivalState | null = null;
  /** Where the dead come in from: the survival map's far spawns. */
  let breaches: Breach[] = [];
  /** Seconds the player lies downed before the run's results come up. */
  let survivalEndTimer = 0;
  /** A line called across the screen, and how long it has left. */
  let announcement: { text: string; life: number } | null = null;
  const announce = (text: string, life = 2.4): void => {
    announcement = { text, life };
  };

  const input = new InputManager(canvas);
  input.look.yaw = spawn.yaw;
  input.attachJoystick(byId("joystick-base"), byId("joystick-knob"));
  input.registerButton("fire", byId("btn-fire"));
  input.registerButton("fire", byId("btn-fire-left"));
  input.registerButton("aim", byId("btn-aim"));
  input.registerButton("reload", byId("btn-reload"));
  input.registerButton("dodge", byId("btn-dodge"));
  // Swapping is a tap on the banner for now, while the loadout is being
  // tested; it will not stay a thing a fight is fought with.
  input.registerButton("swap", byId("weapon-banner"));
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
    tagA: byId("tag-a"),
    tagB: byId("tag-b"),
    scoreB: byId("score-b"),
    clock: byId("clock"),
    killFeed: byId("killfeed"),
    countdown: byId("countdown"),
    respawn: byId("respawn"),
    respawnTimer: byId("respawn-timer"),
    damageArcs: byId("damage-arcs"),
    damageNumbers: byId("damage-numbers"),
    spawnShield: byId("spawn-shield"),
    spawnShieldTime: byId("spawn-shield-time"),
    root: byId("hud"),
  });
  byId("btn-debug").addEventListener("click", () => hud.toggleDebug());

  const liveBoard = new LiveBoard({
    root: byId("live-board"),
    title: byId("live-board-title"),
    clock: byId("live-board-clock"),
    rows: byId("live-board-rows"),
  });

  const setBoardOpen = (open: boolean): void => {
    liveBoard.setOpen(open);
    // The board is a pause screen in every way that matters on a desktop:
    // releasing the mouse is what lets someone actually click the buttons on
    // it, and re-capturing on close puts them straight back into the fight.
    if (open && document.pointerLockElement) document.exitPointerLock();
    else if (!open && screens.activeScreen === "game") input.requestPointerLock();
  };

  byId("btn-board").addEventListener("click", () => setBoardOpen(!liveBoard.isOpen));
  byId("btn-board-close").addEventListener("click", () => setBoardOpen(false));
  byId("btn-board-quit").addEventListener("click", () => {
    setBoardOpen(false);
    if (survival) finishSurvival();
    else finishRound();
  });
  window.addEventListener("keydown", (event) => {
    if (screens.activeScreen !== "game") return;
    // Escape is what a desktop player reaches for, and the browser takes it
    // away from the pointer lock first, so the board opens on the second press
    // rather than fighting for the first.
    if (event.code === "Escape" || event.code === "KeyB") {
      event.preventDefault();
      setBoardOpen(!liveBoard.isOpen);
    }
  });

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
    input.setAimToggle(next.adsToggle);
    // Only the player's half of the control scale. The stylesheet multiplies
    // it by what the screen can carry, so a short screen still pulls the arc in.
    document.documentElement.style.setProperty("--ctl-user", String(next.controlScale));
    const tier = next.quality === "auto" ? detectQuality() : settingsFor(next.quality);
    if (tier.tier !== quality.tier) {
      quality = tier;
      applyQuality(engine, quality);
    }
    saveSettings(next);
  };

  /**
   * Is there walkable ground here? Used to keep a sidestep out of a wall.
   *
   * The navigation grid already knows every surface a body can stand on, so
   * it answers this without a second set of rules to keep in step.
   */
  const isOpenGround = (x: number, z: number, y = 0): boolean =>
    nearestNode(nav.grid, vec3(x, y + 0.05, z), 1) !== null;

  /**
   * Spawn for a team: never on top of anybody, then as far from living
   * enemies as the map allows.
   */
  const chooseSpawn = (team: Team, selfId: string): { position: Vec3; yaw: number } => {
    const options = activeMap.spawns.filter((point) => point.team === team);
    const others = combatants.filter((entry) => entry.alive && entry.id !== selfId);
    const choice = pickSpawn(
      options,
      others.map((entry) => ({ x: entry.centre.x, z: entry.centre.z })),
      others
        .filter((entry) => entry.team !== team)
        .map((entry) => ({ x: entry.centre.x, z: entry.centre.z })),
      isOpenGround,
    );
    return { position: vec3(choice.x, choice.y + 0.05, choice.z), yaw: choice.yaw };
  };

  const nameFor = (index: number): string =>
    CALLSIGNS[index % CALLSIGNS.length] ?? `Bot ${index + 1}`;

  const createRoster = (): void => {
    botField.clear();
    bots = [];

    const difficulty = DIFFICULTIES[settings.difficulty];
    const perTeam = settings.teamSize;
    let index = 0;
    // Where everyone already stands, so the next one along does not arrive
    // inside them. The player is not on the field yet and takes their own
    // spawn from the same rule once the roster is built.
    const placed: { team: Team; x: number; z: number }[] = [];
    // The player takes one slot on blue, so blue fields one fewer bot.
    for (const team of ["a", "b"] as const) {
      const count = team === "a" ? Math.max(0, perTeam - 1) : perTeam;
      for (let i = 0; i < count; i += 1) {
        const teamSpawns = activeMap.spawns.filter((entry) => entry.team === team);
        const point = pickSpawn(
          teamSpawns,
          placed,
          placed.filter((entry) => entry.team !== team),
          isOpenGround,
        );
        placed.push({ team, x: point.x, z: point.z });
        // Bots carry a rifle and a sidearm; the player gets the full rack.
        const bot = createBot(
          `bot_${index}`,
          nameFor(index),
          team,
          difficulty,
          vec3(point.x, point.y + 0.05, point.z),
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
    if (survival) {
      for (const zombie of survival.zombies) {
        world.setHitboxes(
          zombie.id,
          zombie.dead ? [] : zombieHitboxes(zombie.position, zombie.yaw),
        );
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
    attackerOrigin: Vec3,
  ): boolean => {
    let hitSomething = false;
    let headshot = false;
    let killedSomeone = false;
    let dealt = 0;

    for (const entry of resolution.damage) {
      if (survival) {
        // Nobody else is on the field in survival: everything the player
        // hits is one of the dead.
        const zombie = survival.zombies.find((candidate) => candidate.id === entry.targetId);
        if (!zombie || zombie.dead) continue;
        hitSomething = true;
        headshot = headshot || entry.headshot;
        dealt += entry.damage;
        // Where the round went in, which decides which way the body goes.
        const impact =
          resolution.impacts.find(
            (candidate) => candidate.targetId === entry.targetId && candidate.headshot === entry.headshot,
          ) ?? resolution.impacts.find((candidate) => candidate.targetId === entry.targetId);
        const point = impact ? impact.point : vec3(zombie.position.x, zombie.position.y + 1.2, zombie.position.z);
        zombieVoices.flesh(point, entry.headshot);
        if (
          damageZombie(survival, zombie, entry.damage, entry.headshot, {
            from: attackerOrigin,
            point,
          })
        ) {
          killedSomeone = true;
          world.setHitboxes(zombie.id, []);
          zombieVoices.death(zombie, entry.headshot);
        }
        continue;
      }
      const attacker = findCombatantName(attackerId);
      const victim = findCombatantName(entry.targetId);
      if (!attacker || !victim) continue;
      if (!damageAllowed(match.config.friendlyFire, attacker.team, victim.team)) continue;
      hitSomething = true;
      headshot = headshot || entry.headshot;
      // A shotgun lands eight pellets at once; they are one shot to the
      // player, so they read as one number rather than eight.
      dealt += entry.damage;

      let killed: boolean;
      if (entry.targetId === PLAYER_ID) {
        // The bearing is measured from the victim to the shooter, which is
        // where the player has to look to find them.
        const bearing = bearingTo(player.position, attackerOrigin);
        killed = debugInvulnerable ? false : applyDamage(playerHealth, entry.damage, bearing);
        hud.showDamageFrom(bearing);
        if (killed) playerRespawnTimer = match.config.respawnSeconds;
      } else {
        const bot = bots.find((candidate) => candidate.id === entry.targetId);
        if (!bot) continue;
        killed = damageBot(bot, entry.damage, bearingTo(bot.position, attackerOrigin));
        if (killed) {
          bot.respawnTimer = match.config.respawnSeconds;
          bot.deaths += 1;
        }
      }

      if (killed) killedSomeone = true;
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
      hud.showHitMarker(headshot, killedSomeone);
      audio.hitMarker(headshot, killedSomeone);
      if (dealt > 0) hud.showDamageNumber(dealt, headshot, killedSomeone);
    }
    return hitSomething;
  };

  /** Body and head boxes for a standing combatant, from their feet. */
  const botHitboxes = (position: Vec3) => [
    { center: vec3(position.x, position.y + 1.0, position.z), halfExtents: vec3(0.24, 0.52, 0.2), isHead: false },
    { center: vec3(position.x, position.y + 1.62, position.z), halfExtents: vec3(0.13, 0.14, 0.13), isHead: true },
  ];

  /**
   * A zombie's boxes: a soldier's, with the head carried a hand's width
   * forward and a little lower, where the hunch in its walk puts it.
   */
  const zombieHitboxes = (position: Vec3, yaw: number) => {
    const forward = 0.07;
    return [
      { center: vec3(position.x, position.y + 1.0, position.z), halfExtents: vec3(0.24, 0.52, 0.2), isHead: false },
      {
        center: vec3(
          position.x + Math.sin(yaw) * forward,
          position.y + 1.59,
          position.z + Math.cos(yaw) * forward,
        ),
        halfExtents: vec3(0.13, 0.14, 0.13),
        isHead: true,
      },
    ];
  };

  /** The player's boxes hang off the eye, which is where their stance is known. */
  const playerHitboxes = (eyeY: number, position: Vec3) => [
    { center: vec3(position.x, eyeY - 0.72, position.z), halfExtents: vec3(STANCE.radius, 0.65, STANCE.radius), isHead: false },
    { center: vec3(position.x, eyeY + 0.02, position.z), halfExtents: vec3(0.13, 0.13, 0.13), isHead: true },
  ];

  /** Eye position, which is where the player's shots originate. */
  const eyePosition = () =>
    vec3(player.position.x, player.position.y + eyeOffset(player), player.position.z);

  /**
   * Fold the climb share of a shot into the aim.
   *
   * This belongs in the look angles, the same place the player's thumb writes
   * to, so pulling back down is ordinary aiming rather than a fight with a
   * spring. Online needs it as much as offline: the angles the client records
   * and sends already carry it, so the server judges the shot from the same
   * aim the player is looking down.
   */
  /**
   * The roster the board draws, from whichever source is running the match.
   *
   * Offline it is assembled from the local bots and the match's own counters;
   * online it is whatever the server last sent. Same shape either way, so the
   * board itself never learns which mode it is in.
   */
  const boardRows = (): BoardRow[] => {
    if (online) return netRoster;
    const rows: BoardRow[] = bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      team: bot.team,
      kills: bot.kills,
      deaths: bot.deaths,
      pingMs: 0,
      human: false,
      alive: !bot.health.dead,
    }));
    rows.push({
      id: PLAYER_ID,
      name: settings.playerName,
      team: "a",
      kills: match.playerKills,
      deaths: match.playerDeaths,
      pingMs: 0,
      human: true,
      alive: !playerHealth.dead,
    });
    return rows;
  };

  const applyShotClimb = (shot: ShotEvent): void => {
    addLookOffset(input.look, shot.climbYaw, shot.climbPitch);
    // Taking a shot is giving up the spawn's protection, which is what stops
    // the safest moment in the round from also being the best time to attack.
    endSpawnProtection(playerHealth);
  };

  const onPlayerShot = (shot: ShotEvent): void => {
    applyShotClimb(shot);

    const origin = eyePosition();
    const resolution = resolveShot(shot, origin, world, PLAYER_ID);

    audio.shot(shot.weapon.id);
    viewmodel.addRecoil(0.55 + shot.weapon.recoil.pattern[0][0] * 0.35, random.next());
    rig.addShake(0.45 + shot.weapon.recoil.pattern[0][0] * 0.3);
    viewmodel.fireFlash(0.7 + random.next() * 0.6);
    const muzzle = viewmodel.muzzleOnScreen(rig.camera, TRACER_START);
    const tracerOrigin = muzzle ? vec3(muzzle.x, muzzle.y, muzzle.z) : origin;

    for (const impact of resolution.impacts) {
      effects.addPellet(tracerOrigin, impact);
      if (impact.hit && !impact.targetId) audio.impact(impact.distance);
    }
    applyShotDamage(resolution, PLAYER_ID, eyePosition());
  };

  const onBotShot = (shot: BotShot): void => {
    const distance = lengthXZ(sub(shot.origin, eyePosition()));
    audio.remoteShot(shot.weapon, distance);
    for (const impact of shot.resolution.impacts) {
      effects.addPellet(shot.origin, impact);
    }
    applyShotDamage(shot.resolution, shot.botId, shot.origin);
  };

  /**
   * Footsteps and landings, from what the player's own body just did.
   *
   * `bobDistance` only advances while the player is on the ground, so a jump
   * makes no sound until the boots are back on it. The landing dip is set by
   * the controller at the moment of impact and scaled by how hard it was, so
   * it is also the right loudness for the thump.
   */
  const updateFootsteps = (): void => {
    const walked = Math.max(0, player.bobDistance - lastBobDistance);
    lastBobDistance = player.bobDistance;

    if (player.landingOffset > lastLandingOffset + 0.004) {
      audio.land(player.landingOffset / CAMERA.landingDip);
      // A landing is its own sound; do not also put a step under it.
      walkedSinceStep = 0;
    }
    lastLandingOffset = player.landingOffset;

    if (playerHealth.dead || !player.grounded) {
      walkedSinceStep = 0;
      return;
    }
    walkedSinceStep += walked;
    if (walkedSinceStep < STEP_DISTANCE) return;
    walkedSinceStep %= STEP_DISTANCE;
    // A crouched player is placing their feet; a sprinting one is not.
    const weight = player.sprinting ? 1.35 : 1 - player.crouchAmount * 0.6;
    audio.footstep(weight);
  };

  const respawnPlayer = (): void => {
    const point = chooseSpawn("a", PLAYER_ID);
    body.setPosition(vec3(point.position.x, point.position.y + player.halfHeight, point.position.z));
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
    netRoster = snapshot.roster ?? [];
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
      playerHealth.lastDamageBearing = event.fromBearing;
      hud.showDamageFrom(event.fromBearing);
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
        // A kill event is by definition a kill, so the marker says so.
        hud.showHitMarker(event.headshot, true);
        audio.hitMarker(event.headshot, true);
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
      /*
       * Three sources, most specific first: what the player typed, the server
       * this build was published against, and failing both, a server on the
       * machine serving the page.
       *
       * The middle one is what lets a published build be playable by someone
       * who has never opened the settings screen, which is the only version of
       * "send your friends a link" that actually works.
       */
      const address =
        settings.serverUrl ||
        (import.meta.env.VITE_SERVER_URL as string | undefined) ||
        defaultServerUrl(window.location);
      screens.setNetStatus(`connecting to ${address}...`);
      // Online the server owns the loadout and hands everyone the full rack,
      // so levelling gates nothing there. Progression stays a solo concern
      // rather than turning into an advantage over other players.
      Object.assign(playerLoadout, createLoadout(DEFAULT_LOADOUT));
      net.connect(address, settings.playerName);
      return;
    }

    online = false;
    net.disconnect();

    // Swapping the level rebuilds the scene, the collision world and the
    // navigation grid. Cheap enough to do between rounds, and it keeps one
    // set of per-map objects alive rather than several.
    const surviving = settings.mode === "survival";
    const wanted = surviving ? boulevardSurvivalMap : mapById(settings.mapId);
    if (wanted.id !== activeMap.id) buildWorld(wanted);
    world.clearHitboxes();
    match.config.teamSize = settings.teamSize;
    startMatch(match);
    announcement = null;
    if (surviving) {
      // No bots and no teams: the player, the city and whatever comes out
      // of it. The match is only kept running for the HUD's sake.
      botField.clear();
      bots = [];
      survival = createSurvival();
      zombieVoices.reset();
      pickupField.clear();
      breaches = activeMap.spawns.filter((point) => point.team === "b");
      survivalEndTimer = 0;
      match.phase = "active";
      announce("SURVIVE");
    } else {
      survival = null;
      createRoster();
    }
    rebuildCombatants();
    respawnPlayer();
    playerRespawnTimer = 0;
    screens.show("game");
    audio.setAmbience(activeMap.ambience);
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
    onReturnToLobby: () => {
      // The level's weather belongs to the level, not to the menu over it.
      audio.stopAmbience();
      screens.show("lobby");
    },
    onSettingsChanged: applySettings,
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
      audio.setAmbience(activeMap.ambience);
      audio.start();
      input.requestPointerLock();
    },
    onSnapshot: (snapshot) => applySnapshot(snapshot),
    onClose: () => {
      if (!online) return;
      online = false;
      screens.setNetStatus("disconnected from the server", "error");
      audio.stopAmbience();
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
    applyShotClimb(shot);

    // Local feedback only: the muzzle flash, the kick, the sound and a tracer.
    audio.shot(shot.weapon.id);
    viewmodel.addRecoil(0.55 + shot.weapon.recoil.pattern[0][0] * 0.35, random.next());
    rig.addShake(0.45 + shot.weapon.recoil.pattern[0][0] * 0.3);
    viewmodel.fireFlash(0.7 + random.next() * 0.6);
    const muzzle = viewmodel.muzzleOnScreen(rig.camera, TRACER_START);
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

  /** Bank a survival run's experience, then show how far it got. */
  const finishSurvival = (): void => {
    const run = survival;
    if (!run) return;
    endSurvival(run);
    const reward: MatchReward = {
      kills: 0,
      headshots: 0,
      deaths: playerHealth.dead ? 1 : 0,
      won: false,
      ownScore: 0,
      otherScore: 0,
      completed: true,
      zombieKills: run.kills,
      wavesCleared: run.cleared,
    };
    const result = applyMatchResult(profile, reward);
    saveProfile(profile);
    screens.renderCareer(profile);
    screens.showSurvivalResults(
      {
        wave: run.wave,
        cleared: run.cleared,
        kills: run.kills,
        headshots: run.headshots,
        fell: playerHealth.dead,
      },
      reward,
      result.levels,
    );
    announcement = null;
    if (document.pointerLockElement) document.exitPointerLock();
  };

  /** The dead get a turn, and the player's run ends if they have landed. */
  const stepSurvivalRun = (run: SurvivalState, dt: number): void => {
    const feet = vec3(
      player.position.x,
      player.position.y - player.halfHeight,
      player.position.z,
    );
    stepSurvival(
      run,
      { position: feet, alive: !playerHealth.dead, ammoNeed: ammoNeed() },
      breaches,
      { grid: nav.grid, hitscan: world, random },
      dt,
      {
        onAttack: (damage, from) => {
          if (playerHealth.dead) return;
          const bearing = bearingTo(player.position, from);
          hud.showDamageFrom(bearing);
          rig.addShake(0.9);
          zombieVoices.strike(from);
          if (!debugInvulnerable && applyDamage(playerHealth, damage, bearing)) {
            match.playerDeaths += 1;
          }
        },
        onSwing: (zombie) => zombieVoices.swing(zombie),
        onSpawn: (zombie) => zombieVoices.spawn(zombie),
        onLand: (zombie, impact) => zombieVoices.land(zombie, impact),
        onDrop: (pickup) => zombieVoices.drop(pickup.position),
        onPickup: () => {
          const taken = takeAmmo();
          zombieVoices.pickup();
          hud.pushFeed(taken > 0 ? `+${taken} ROUNDS` : "RACK FULL", "info");
        },
        onWaveStart: (wave) => {
          announce(`WAVE ${wave}`);
          zombieVoices.waveStart(wave);
          // Ammunition comes from the dead now. The one thing a wave still
          // hands over is a floor under the sidearm, so a run can never be
          // lost to having nothing at all to shoot with.
          const sidearm =
            playerLoadout.weapons.find((weapon) => weapon.definition.id === "pistol") ??
            playerLoadout.weapons[playerLoadout.weapons.length - 1];
          const floor = sidearm.definition.magazineSize * 2;
          sidearm.reserve = Math.max(sidearm.reserve, floor);
        },
        onWaveCleared: (wave) => {
          announce(`WAVE ${wave} CLEARED`);
          zombieVoices.waveCleared();
        },
      },
    );
    if (playerHealth.dead && run.phase !== "over") {
      endSurvival(run);
      survivalEndTimer = 2.2;
    }
    if (run.phase === "over" && survivalEndTimer > 0) {
      survivalEndTimer = Math.max(0, survivalEndTimer - dt);
      if (survivalEndTimer === 0 && screens.activeScreen === "game") {
        input.clearAimLatch();
        finishSurvival();
      }
    }
  };

  /**
   * How short of ammunition the player is, nought to one: the share of the
   * rack's full capacity that is missing.
   */
  const ammoNeed = (): number => {
    let have = 0;
    let most = 0;
    for (const weapon of playerLoadout.weapons) {
      have += weapon.magazine + weapon.reserve;
      most += weapon.definition.magazineSize + weapon.definition.reserveAmmo;
    }
    return most > 0 ? Math.max(0, Math.min(1, 1 - have / most)) : 0;
  };

  /**
   * A crate's worth: a magazine for every weapon carried, up to what each
   * can hold in reserve. Returns the rounds actually taken.
   */
  const takeAmmo = (): number => {
    let taken = 0;
    for (const weapon of playerLoadout.weapons) {
      const room = weapon.definition.reserveAmmo - weapon.reserve;
      const add = Math.max(0, Math.min(weapon.definition.magazineSize, room));
      weapon.reserve += add;
      taken += add;
    }
    return taken;
  };

  /** What the HUD shows in place of scores while surviving. */
  const survivalReadout = (): SurvivalReadout | null => {
    if (!survival) return null;
    return {
      wave: survival.wave,
      left: remaining(survival),
      kills: survival.kills,
      nextWaveIn: survival.phase === "breather" ? survival.timer : null,
      announce: announcement ? announcement.text : playerHealth.dead ? "OVERRUN" : null,
    };
  };

  const stepSimulation = (dt: number, frame: ReturnType<typeof input.sample>): void => {
    const live = match.phase === "active";

    previousPosition = copy(player.position);
    stepPlayer(player, frame, dt, body);
    stepHealth(playerHealth, dt);
    // Survival has no clock to run down; the match is only there for the HUD.
    if (!survival) stepMatch(match, dt);
    rebuildCombatants();
    if (announcement) {
      announcement.life -= dt;
      if (announcement.life <= 0) announcement = null;
    }

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
          const point = chooseSpawn(bot.team, bot.id);
          respawnBot(bot, point.position, point.yaw);
        }
        continue;
      }
      // Bots hold still until the round actually starts.
      if (!live) continue;
      stepBot(bot, botWorld, dt, onBotShot);
    }
    if (survival) stepSurvivalRun(survival, dt);

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
      // The next round starts from the lobby, so anything the thumb latched
      // during this one ends with it.
      input.clearAimLatch();
      finishRound();
    }
  };

  /**
   * End a latched ADS whenever the game itself takes the sights away.
   *
   * Dying, sprinting and swapping weapon all block aiming in the simulation,
   * which drives the sights back down on their own. A latch left set behind
   * that block would raise them again the instant it lifted — the player taps
   * once to aim, sprints to cover, and arrives already scoped without asking.
   * Holding ADS has no equivalent problem because the thumb is the state.
   *
   * The conditions read simulation state rather than the input edge that
   * caused it, and deliberately mirror the ones `advanceAds` blocks on. A
   * swap press is dropped entirely on a frame that advances no simulation
   * step, and clearing the latch on the press would take the sights away for
   * a weapon swap that never happened.
   */
  const dropAimLatchIfTaken = (): void => {
    if (!input.isAimLatched) return;
    if (playerHealth.dead || player.sprinting || isSwapping(playerLoadout)) {
      input.clearAimLatch();
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
    if (inGame) {
      dropAimLatchIfTaken();
      updateFootsteps();
    }
    input.endFrame();

    const weapon = activeWeapon(playerLoadout);
    const targetFov =
      settings.fovDegrees +
      (weapon.definition.adsFovDegrees - settings.fovDegrees) * playerLoadout.adsProgress;
    rig.blendFieldOfView(targetFov, delta);
    // Going down, or getting back up. The camera plays it and the weapon
    // follows the camera, so it has to be set before either is placed.
    rig.setDown(playerHealth.dead, delta);
    rig.update(
      previousPosition,
      player,
      timing.alpha,
      delta,
      playerLoadout.recoilPitch,
      playerLoadout.recoilYaw,
    );
    viewmodel.update(
      player,
      playerLoadout,
      rig.camera,
      delta,
      rig.magnification(settings.fovDegrees),
      rig.downAmount,
    );
    const stanceHeight = stanceHalfHeight(player.crouchAmount) * 2;
    shadowPatches.place(
      selfShadow,
      player.position.x,
      player.position.y - stanceHeight / 2,
      player.position.z,
      stanceHeight * 0.95,
    );

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
    } else if (survival) {
      botField.renderZombies(survival.zombies, delta);
      botField.retain(new Set(survival.zombies.map((zombie) => zombie.id)));
      pickupField.render(survival.pickups, delta);
      if (inGame) {
        zombieVoices.update(
          { x: player.position.x, y: player.position.y, z: player.position.z, yaw: player.yaw },
          survival.zombies,
          delta,
        );
      }
      netStatusBar.textContent = "";
    } else {
      botField.renderBots(bots, delta);
      netStatusBar.textContent = "";
    }
    effects.update(delta);
    scene.render();

    if (liveBoard.isOpen) {
      liveBoard.render(
        boardRows(),
        online ? (net.selfId ?? PLAYER_ID) : PLAYER_ID,
        match.timeRemaining,
        online ? "IN THIS MATCH" : "SCOREBOARD",
      );
    }

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
      survival: online ? null : survivalReadout(),
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
      get survival() {
        if (!survival) return null;
        return {
          phase: survival.phase,
          wave: survival.wave,
          timer: +survival.timer.toFixed(2),
          left: remaining(survival),
          kills: survival.kills,
          cleared: survival.cleared,
          pickups: survival.pickups.map((pickup) => ({
            id: pickup.id,
            position: { ...pickup.position },
            life: +pickup.life.toFixed(1),
          })),
          zombies: survival.zombies.map((zombie) => ({
            id: zombie.id,
            dead: zombie.dead,
            runner: zombie.runner,
            health: Math.round(zombie.health),
            fall: zombie.fall
              ? {
                  angle: +zombie.fall.angle.toFixed(3),
                  dirX: +zombie.fall.dirX.toFixed(3),
                  dirZ: +zombie.fall.dirZ.toFixed(3),
                  slide: +zombie.fall.slide.toFixed(3),
                  landed: zombie.fall.landed,
                }
              : null,
            position: {
              x: +zombie.position.x.toFixed(2),
              y: +zombie.position.y.toFixed(2),
              z: +zombie.position.z.toFixed(2),
            },
          })),
        };
      },
      /** Development helper: bring one zombie in at a spot, outside any wave. */
      spawnZombieAt(x: number, z: number, y = 0) {
        if (!survival) return null;
        return spawnZombie(survival, { x, z, y }, random).id;
      },
      /**
       * Development helper: finish a zombie with one round of `damage`,
       * fired from `from` into it at `height` metres above its feet.
       */
      shootZombie(id: string, from: { x: number; y: number; z: number }, height: number, damage = 34) {
        const zombie = survival?.zombies.find((candidate) => candidate.id === id);
        if (!survival || !zombie) return false;
        // Worn down to this one round, so the round decides the fall.
        zombie.health = Math.min(zombie.health, damage);
        const point = vec3(zombie.position.x, zombie.position.y + height, zombie.position.z);
        const killed = damageZombie(survival, zombie, damage, height > 1.45, {
          from: vec3(from.x, from.y, from.z),
          point,
        });
        if (killed) {
          world.setHitboxes(zombie.id, []);
          zombieVoices.death(zombie, height > 1.45);
        }
        return killed;
      },
      /** Development helper: skip the breather and bring the next wave in now. */
      callWave() {
        if (survival && survival.phase === "breather") survival.timer = 0.01;
      },
      /** How the level is being drawn: the far plane, the fog, and the lights. */
      get view() {
        return {
          farClip: +rig.camera.maxZ.toFixed(2),
          fogMode: scene.fogMode,
          fogDensity: scene.fogDensity,
          shadows: sun !== null,
          torch: scene.getLightByName("torch") !== null,
          night: activeMap.style.night === true,
        };
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
      teleport(x: number, z: number, yaw?: number, y = 0, pitch = 0) {
        // `y` is the floor height to land on, for maps with floors stacked.
        body.setPosition(vec3(x, y + player.halfHeight + 0.05, z));
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        input.look.pitch = pitch;
        if (yaw !== undefined) input.look.yaw = yaw;
      },
      /**
       * Development helper: where the muzzle is drawn on screen, and where a
       * tracer starting from `muzzleOnScreen` lands on screen. The two should
       * agree to a pixel; if they do not, tracers leave from beside the gun.
       */
      muzzleScreenCheck() {
        const width = engine.getRenderWidth();
        const height = engine.getRenderHeight();
        const drawn = viewmodel.muzzleWorldPosition();
        const start = viewmodel.muzzleOnScreen(rig.camera, TRACER_START);
        if (!drawn || !start) return null;
        const weaponView = viewmodel.camera.getViewMatrix().multiply(viewmodel.camera.getProjectionMatrix());
        const worldView = rig.camera.getViewMatrix().multiply(rig.camera.getProjectionMatrix());
        const viewport = rig.camera.viewport.toGlobal(width, height);
        const a = Vector3.Project(drawn, Matrix.Identity(), weaponView, viewport);
        const b = Vector3.Project(start, Matrix.Identity(), worldView, viewport);
        const naive = Vector3.Project(drawn, Matrix.Identity(), worldView, viewport);
        return {
          drawn: { x: +a.x.toFixed(1), y: +a.y.toFixed(1) },
          tracer: { x: +b.x.toFixed(1), y: +b.y.toFixed(1) },
          naive: { x: +naive.x.toFixed(1), y: +naive.y.toFixed(1) },
        };
      },
      /** Development helper: exercise the health and damage HUD. */
      hurt(amount: number) {
        applyDamage(playerHealth, amount, player.yaw);
      },
      /**
       * Development helper: stop the bots from ending a screenshot session.
       * Nothing in the game reads this; it is set from the console only.
       */
      set invulnerable(value: boolean) {
        debugInvulnerable = value;
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
        // The middle of the weapon's body, not the node it hangs off: the
        // parts are baked into one mesh, so the node sits at the grip.
        const projected = Vector3.Project(
          mesh.getBoundingInfo().boundingBox.centerWorld,
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
