import "./styles.css";
import { Engine } from "@babylonjs/core/Engines/engine";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { FixedStepLoop, FpsMeter } from "./engine/loop";
import { QualityBenchmark, detectQuality, settingsFor, type QualitySettings } from "./engine/quality";
import { Hud } from "./hud/hud";
import { InputManager } from "./input/inputManager";
import { greyboxMap } from "./maps/greybox";
import { CAMERA, STANCE } from "./sim/config";
import { createPlayer, stepPlayer } from "./sim/player";
import type { PlayerState } from "./sim/types";
import { copy, vec3 } from "./sim/vec3";
import { BabylonCollisionWorld } from "./view/collisionWorld";
import { CameraRig } from "./view/cameraRig";
import { createScene } from "./view/scene";

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

  const spawn = greyboxMap.spawns[0];
  const world = new BabylonCollisionWorld(scene, STANCE.radius, STANCE.standHeight / 2);
  const spawnPosition = vec3(spawn.x, STANCE.standHeight / 2 + 0.05, spawn.z);
  world.setPosition(spawnPosition);

  const player: PlayerState = createPlayer(spawnPosition, spawn.yaw);
  let previousPosition = copy(player.position);

  const input = new InputManager(canvas);
  input.look.yaw = spawn.yaw;
  input.attachJoystick(byId("joystick-base"), byId("joystick-knob"));
  input.registerButton("crouch", byId("btn-crouch"), true);
  input.registerButton("leanLeft", byId("btn-lean-left"));
  input.registerButton("leanRight", byId("btn-lean-right"));
  input.start();

  const hud = new Hud({
    crosshair: byId("crosshair"),
    debug: byId("debug"),
    stance: byId("stance"),
  });
  byId("btn-debug").addEventListener("click", () => hud.toggleDebug());

  const loop = new FixedStepLoop();
  const fpsMeter = new FpsMeter();
  const benchmark = new QualityBenchmark();

  engine.runRenderLoop(() => {
    const delta = engine.getDeltaTime() / 1000;
    if (!Number.isFinite(delta) || delta <= 0) return;

    fpsMeter.update(delta);
    input.updateLook(false);

    const timing = loop.advance(delta);
    const frame = input.sample();
    for (let step = 0; step < timing.steps; step += 1) {
      previousPosition = copy(player.position);
      stepPlayer(player, frame, loop.stepSeconds, world);
    }
    input.endFrame();

    rig.update(previousPosition, player, timing.alpha, delta);
    scene.render();

    hud.update(player, fpsMeter.value, quality.tier, scene.getActiveMeshes().length, delta);

    // The GPU-string guess is unreliable, so measured frame times get the
    // final say and can step the tier down once, shortly after boot.
    const demoted = benchmark.update(delta, quality.tier);
    if (demoted) {
      quality = settingsFor(demoted);
      applyQuality(engine, quality);
      console.info(`[shootout] quality demoted to ${demoted} after benchmark`);
    }
  });

  window.addEventListener("resize", () => {
    engine.resize();
    rig.setFieldOfView(CAMERA.defaultFovDegrees);
  });
  window.addEventListener("orientationchange", () => {
    // Safari reports stale dimensions if resized on the same tick.
    window.setTimeout(() => engine.resize(), 120);
  });

  const bootOverlay = byId("boot");
  byId("btn-start").addEventListener("click", () => {
    bootOverlay.classList.add("is-hidden");
    input.requestPointerLock();
    // Fullscreen needs a user gesture, and is best-effort: some browsers and
    // iOS refuse it outright, which must not break the game.
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    void orientation?.lock?.("landscape").catch(() => undefined);
  });

  // Handle exposed for the end-to-end smoke test and for tuning from the console.
  Object.assign(window, {
    __shootout: {
      get fps() {
        return fpsMeter.value;
      },
      get position() {
        return player.position;
      },
      get quality() {
        return quality.tier;
      },
      /** Where the camera is actually pointing. Used to verify look signs. */
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
      get activeMeshes() {
        return scene.getActiveMeshes().length;
      },
      ready: true,
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
    },
  });
};

boot();
