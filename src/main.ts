import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { GameAudio } from "./engine/audio";
import { FixedStepLoop, FpsMeter } from "./engine/loop";
import { QualityBenchmark, detectQuality, settingsFor, type QualitySettings } from "./engine/quality";
import { Hud } from "./hud/hud";
import { InputManager } from "./input/inputManager";
import { greyboxMap } from "./maps/greybox";
import { resolveShot, type ShotResolution } from "./sim/combat";
import { CAMERA, STANCE } from "./sim/config";
import { applyDamage, createHealth, stepHealth } from "./sim/health";
import {
  activeWeapon,
  createLoadout,
  stepLoadout,
  type ShotEvent,
} from "./sim/loadout";
import { createPlayer, eyeOffset, stepPlayer } from "./sim/player";
import { createRandom } from "./sim/random";
import { damageTarget, stepTargets } from "./sim/targets";
import type { PlayerState } from "./sim/types";
import { copy, vec3 } from "./sim/vec3";
import { CameraRig } from "./view/cameraRig";
import { BabylonCollisionWorld } from "./view/collisionWorld";
import { ShotEffects } from "./view/effects";
import { BabylonHitscanWorld } from "./view/hitscanWorld";
import { createScene } from "./view/scene";
import { TargetField } from "./view/targetView";
import { ViewmodelRig, WORLD_LAYER } from "./view/viewmodel";

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
  let quality = detectQuality();

  const engine = new Engine(canvas, quality.antialias, {
    preserveDrawingBuffer: false,
    stencil: false,
    powerPreference: "high-performance",
    audioEngine: false,
    doNotHandleContextLost: false,
  });
  applyQuality(engine, quality);

  const { scene } = createScene(engine, greyboxMap, quality);
  const rig = new CameraRig(scene, quality, CAMERA.defaultFovDegrees);
  const viewmodel = new ViewmodelRig(scene);
  // The world camera must not draw the weapon, and the weapon camera must not
  // draw the world. Babylon clears depth between them, so the weapon never
  // intersects a wall it is standing next to.
  rig.camera.layerMask = WORLD_LAYER;
  scene.activeCameras = [rig.camera, viewmodel.camera];

  const spawn = greyboxMap.spawns[0];
  const world = new BabylonCollisionWorld(scene, STANCE.radius, STANCE.standHeight / 2);
  const spawnPosition = vec3(spawn.x, STANCE.standHeight / 2 + 0.05, spawn.z);
  world.setPosition(spawnPosition);

  const player: PlayerState = createPlayer(spawnPosition, spawn.yaw);
  let previousPosition = copy(player.position);

  const loadout = createLoadout();
  const health = createHealth();
  const random = createRandom();
  const hitscan = new BabylonHitscanWorld(scene);
  const targets = new TargetField(scene, greyboxMap.targets);
  const effects = new ShotEffects(scene);
  const audio = new GameAudio();

  const input = new InputManager(canvas);
  input.look.yaw = spawn.yaw;
  input.attachJoystick(byId("joystick-base"), byId("joystick-knob"));
  // Crouch and lean stay in the simulation and on the keyboard, but they are
  // off the touch layout: on a phone, thumb space is the scarcest resource and
  // it belongs to firing and aiming.
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
  });
  byId("btn-debug").addEventListener("click", () => hud.toggleDebug());

  const loop = new FixedStepLoop();
  const fpsMeter = new FpsMeter();
  const benchmark = new QualityBenchmark();

  /**
   * Meshes currently enabled in the scene.
   * getActiveMeshes reports only the camera rendered last, which is the
   * weapon camera, so it would badly under-report the level.
   */
  const sceneMeshCount = () => scene.meshes.reduce((n, mesh) => (mesh.isEnabled() ? n + 1 : n), 0);

  /** Eye position, which is where shots originate. */
  const eyePosition = () =>
    vec3(player.position.x, player.position.y + eyeOffset(player), player.position.z);

  const onShotFired = (shot: ShotEvent): ShotResolution => {
    const origin = eyePosition();
    const resolution = resolveShot(shot, origin, hitscan);

    audio.shot(shot.weapon.id);
    viewmodel.addRecoil(0.55 + shot.weapon.recoil.pattern[0][0] * 0.35, random.next());
    viewmodel.fireFlash(0.7 + random.next() * 0.6);
    const muzzle = viewmodel.muzzleWorldPosition();

    // Tracers start at the muzzle so they read as coming from the weapon,
    // while the rounds themselves are traced from the eye, which is where
    // the crosshair actually points.
    const tracerOrigin = muzzle
      ? vec3(muzzle.x, muzzle.y, muzzle.z)
      : origin;
    for (const impact of resolution.impacts) {
      effects.addPellet(tracerOrigin, impact);
      if (impact.hit && !impact.targetId) audio.impact(impact.distance);
    }

    let bestHeadshot = false;
    for (const entry of resolution.damage) {
      const state = targets.findState(entry.targetId);
      if (!state) continue;
      const dropped = damageTarget(state, entry.damage, entry.headshot);
      bestHeadshot = bestHeadshot || entry.headshot;
      if (dropped) {
        audio.targetDrop();
        hud.pushFeed(
          entry.headshot ? "TARGET DOWN · HEADSHOT" : "TARGET DOWN",
          "down",
        );
      } else {
        hud.pushFeed(`${Math.round(entry.damage)} damage`, "hit");
      }
    }
    if (resolution.hitTarget) {
      hud.showHitMarker(bestHeadshot);
      audio.hitMarker(bestHeadshot);
    }
    return resolution;
  };

  let previousMagazine = activeWeapon(loadout).magazine;
  let wasReloading = false;

  engine.runRenderLoop(() => {
    const delta = engine.getDeltaTime() / 1000;
    if (!Number.isFinite(delta) || delta <= 0) return;

    fpsMeter.update(delta);
    input.updateLook(input.isAiming);

    const timing = loop.advance(delta);
    const frame = input.sample();

    for (let step = 0; step < timing.steps; step += 1) {
      previousPosition = copy(player.position);
      stepPlayer(player, frame, loop.stepSeconds, world);
      stepHealth(health, loop.stepSeconds);
      stepTargets(targets.states, loop.stepSeconds);

      const weapon = activeWeapon(loadout);
      const shot = stepLoadout(
        loadout,
        frame,
        {
          speed: Math.hypot(player.velocity.x, player.velocity.z),
          grounded: player.grounded,
          crouchAmount: player.crouchAmount,
          sprintOutTimer: player.sprintOutTimer,
          yaw: player.yaw,
          pitch: player.pitch,
        },
        loop.stepSeconds,
        random,
      );
      if (shot) onShotFired(shot);

      // A dry trigger and a finished reload both deserve a sound.
      if (frame.fire && weapon.magazine === 0 && !weapon.reloading && weapon.reserve === 0) {
        audio.dryFire();
      }
      const reloadingNow = activeWeapon(loadout).reloading;
      if (reloadingNow && !wasReloading) audio.reloadClick(1);
      if (!reloadingNow && wasReloading) audio.reloadClick(0.8);
      wasReloading = reloadingNow;

      const magazine = activeWeapon(loadout).magazine;
      if (magazine > previousMagazine) audio.reloadClick(1.15);
      previousMagazine = magazine;
    }
    input.endFrame();

    const weapon = activeWeapon(loadout);
    const targetFov =
      CAMERA.defaultFovDegrees +
      (weapon.definition.adsFovDegrees - CAMERA.defaultFovDegrees) * loadout.adsProgress;
    rig.blendFieldOfView(targetFov, delta);

    rig.update(
      previousPosition,
      player,
      timing.alpha,
      delta,
      loadout.recoilPitch,
      loadout.recoilYaw,
    );
    viewmodel.update(player, loadout, rig.camera, delta);
    targets.render();
    effects.update(delta);
    scene.render();

    hud.update({
      player,
      loadout,
      health,
      fps: fpsMeter.value,
      tier: quality.tier,
      activeMeshes: sceneMeshCount(),
      deltaSeconds: delta,
    });

    // The GPU-string guess is unreliable, so measured frame times get the
    // final say and can step the tier down once, shortly after boot.
    const demoted = benchmark.update(delta, quality.tier);
    if (demoted) {
      quality = settingsFor(demoted);
      applyQuality(engine, quality);
      console.info(`[shootout] quality demoted to ${demoted} after benchmark`);
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

  const bootOverlay = byId("boot");
  byId("btn-start").addEventListener("click", () => {
    bootOverlay.classList.add("is-hidden");
    // Audio can only start from a real gesture, so this is the one chance.
    audio.start();
    input.requestPointerLock();
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    void orientation?.lock?.("landscape").catch(() => undefined);
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
        return { x: +direction.x.toFixed(3), y: +direction.y.toFixed(3), z: +direction.z.toFixed(3) };
      },
      get pitch() {
        return +player.pitch.toFixed(3);
      },
      get yaw() {
        return +player.yaw.toFixed(3);
      },
      get weapon() {
        const current = activeWeapon(loadout);
        return {
          id: current.definition.id,
          name: current.definition.name,
          magazine: current.magazine,
          reserve: current.reserve,
          reloading: current.reloading,
          ads: +loadout.adsProgress.toFixed(3),
        };
      },
      get health() {
        return +health.current.toFixed(1);
      },
      get targets() {
        return targets.states.map((state) => ({
          id: state.id,
          health: Math.round(state.health),
          down: state.down,
        }));
      },
      /** Development helper: drop the player at a spot on the map. */
      teleport(x: number, z: number, yaw?: number) {
        world.setPosition(vec3(x, player.halfHeight + 0.05, z));
        player.velocity.x = 0;
        player.velocity.y = 0;
        player.velocity.z = 0;
        // Level the view as well, so a teleport is a complete, repeatable
        // reset rather than carrying the previous aim into the new spot.
        input.look.pitch = 0;
        if (yaw !== undefined) input.look.yaw = yaw;
      },
      /**
       * Development helper: where the weapon sits on screen, as a fraction of
       * the viewport. Values inside 0 to 1 mean it is actually in frame, which
       * is the thing that broke when the weapon sat too close to the camera.
       */
      weaponScreenPosition() {
        const current = activeWeapon(loadout).definition.id;
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
        return { x: +(projected.x / width).toFixed(3), y: +(projected.y / height).toFixed(3) };
      },
      /** Development helper: the live Babylon scene, for console poking. */
      get scene() {
        return scene;
      },
      /** Development helper: what each camera is actually drawing. */
      inspect() {
        return {
          cameras: scene.activeCameras?.map((camera) => ({
            name: camera.name,
            layerMask: camera.layerMask.toString(16),
            fovDegrees: +((camera.fov * 180) / Math.PI).toFixed(1),
          })),
          meshes: scene.meshes
            .filter((mesh) => mesh.isEnabled() && mesh.isVisible)
            .map((mesh) => {
              const position = mesh.getAbsolutePosition();
              const half = mesh.getBoundingInfo().boundingBox.extendSizeWorld;
              return {
                name: mesh.name,
                layer: mesh.layerMask.toString(16),
                pos: [+position.x.toFixed(2), +position.y.toFixed(2), +position.z.toFixed(2)],
                half: [+half.x.toFixed(2), +half.y.toFixed(2), +half.z.toFixed(2)],
              };
            }),
        };
      },
      /** Development helper: exercise the health and damage HUD. */
      hurt(amount: number) {
        applyDamage(health, amount, player.yaw);
      },
    },
  });
};

boot();
