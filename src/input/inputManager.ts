import { applyLookDelta, createLook, defaultLookSettings, type LookSettings, type LookState } from "../sim/look";
import { emptyInput, type InputFrame } from "../sim/types";
import { ButtonBank, type ButtonAction } from "./buttons";
import { Joystick } from "./joystick";

/**
 * Pointer capture keeps a drag tracking after it slides off the canvas, but it
 * throws whenever the browser no longer considers the pointer active. That is
 * not a reason to drop the input: capture is an enhancement, so a failure here
 * must never abort the handler that reads the touch.
 */
const capturePointer = (element: HTMLElement, pointerId: number): void => {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer already released, or synthetic. Routing by id still works.
  }
};

interface LookPointer {
  id: number;
  lastX: number;
  lastY: number;
}

/**
 * Owns every input device and produces one `InputFrame` per simulation step.
 *
 * Pointer Events are used rather than Touch Events: they unify mouse, pen and
 * touch, and they give per-pointer capture, which is what makes three
 * simultaneous contacts (move, look, fire) track correctly.
 */
export class InputManager {
  readonly look: LookState = createLook();
  settings: LookSettings = defaultLookSettings();

  private readonly frame: InputFrame = emptyInput();
  private readonly keys = new Set<string>();
  /** Keys pressed this frame, for actions that must not repeat while held. */
  private readonly keyEdges = new Set<string>();
  /** Mouse buttons currently down, for desktop fire and aim. */
  private readonly mouseButtons = new Set<number>();
  private readonly buttons = new ButtonBank();
  private joystick: Joystick | null = null;
  private lookPointer: LookPointer | null = null;
  private pendingYaw = 0;
  private pendingPitch = 0;
  private gyroBaseYaw: number | null = null;
  private gyroDeltaYaw = 0;
  private gyroDeltaPitch = 0;
  private pointerLocked = false;

  constructor(private readonly surface: HTMLElement) {}

  attachJoystick(base: HTMLElement, knob: HTMLElement): void {
    this.joystick = new Joystick(base, knob);
  }

  registerButton(action: ButtonAction, element: HTMLElement): void {
    this.buttons.register({ action, element });
  }

  /** Aim down sights on a tap that latches, rather than for as long as held. */
  setAimToggle(enabled: boolean): void {
    this.buttons.setToggle("aim", enabled);
  }

  /**
   * End a latched ADS the player did not end themselves.
   *
   * Dying, swapping weapon and breaking into a sprint all take the sights away
   * in the simulation. Leaving the latch set behind them would drop the player
   * back into ADS the moment the block lifted, which reads as the game aiming
   * on its own.
   */
  clearAimLatch(): void {
    this.buttons.clearLatch("aim");
  }

  get isAimLatched(): boolean {
    return this.buttons.isLatched("aim");
  }

  start(): void {
    const surface = this.surface;
    surface.style.touchAction = "none";

    surface.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    surface.addEventListener("pointermove", this.onPointerMove, { passive: false });
    surface.addEventListener("pointerup", this.onPointerUp);
    surface.addEventListener("pointercancel", this.onPointerUp);
    surface.addEventListener("contextmenu", (event) => event.preventDefault());

    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  stop(): void {
    const surface = this.surface;
    surface.removeEventListener("pointerdown", this.onPointerDown);
    surface.removeEventListener("pointermove", this.onPointerMove);
    surface.removeEventListener("pointerup", this.onPointerUp);
    surface.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.buttons.dispose();
  }

  /** Desktop convenience: click the canvas to capture the mouse. */
  requestPointerLock(): void {
    if (!this.isTouchPrimary()) void this.surface.requestPointerLock?.();
  }

  isTouchPrimary(): boolean {
    return window.matchMedia("(pointer: coarse)").matches;
  }

  enableGyro(): void {
    window.addEventListener("deviceorientation", this.onDeviceOrientation);
  }

  disableGyro(): void {
    window.removeEventListener("deviceorientation", this.onDeviceOrientation);
    this.gyroBaseYaw = null;
  }

  /** Fold accumulated look deltas into the angles. Call once per rendered frame. */
  updateLook(aiming: boolean): void {
    const deltaX = this.pendingYaw + this.gyroDeltaYaw;
    const deltaY = this.pendingPitch + this.gyroDeltaPitch;
    this.pendingYaw = 0;
    this.pendingPitch = 0;
    this.gyroDeltaYaw = 0;
    this.gyroDeltaPitch = 0;
    if (deltaX === 0 && deltaY === 0) return;
    applyLookDelta(
      this.look,
      deltaX,
      deltaY,
      this.settings,
      this.pointerLocked ? "mouse" : "touch",
      aiming,
    );
  }

  /** Build the frame handed to the simulation. */
  sample(): InputFrame {
    const frame = this.frame;
    const stick = this.joystick?.read() ?? { x: 0, y: 0, magnitude: 0, active: false };

    let moveX = stick.x;
    let moveY = stick.y;
    if (!stick.active) {
      const keyX = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
      const keyY = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
      const magnitude = Math.hypot(keyX, keyY);
      if (magnitude > 0) {
        moveX = keyX / magnitude;
        moveY = keyY / magnitude;
      }
    }

    frame.moveX = moveX;
    frame.moveY = moveY;
    frame.yaw = this.look.yaw;
    frame.pitch = this.look.pitch;
    // Touch sprints by pushing the stick out; keyboard uses shift.
    frame.sprint = stick.magnitude > 0.9 || this.keys.has("ShiftLeft");
    frame.crouch = this.buttons.isDown("crouch") || this.keys.has("ControlLeft") || this.keys.has("KeyC");
    frame.leanLeft = this.buttons.isDown("leanLeft") || this.keys.has("KeyQ");
    frame.leanRight = this.buttons.isDown("leanRight") || this.keys.has("KeyE");
    frame.fire = this.buttons.isDown("fire") || this.mouseButtons.has(0);
    frame.aim = this.buttons.isDown("aim") || this.mouseButtons.has(2);
    frame.reloadPressed = this.buttons.consumePress("reload") || this.consumeKey("KeyR");
    frame.swapPressed =
      this.buttons.consumePress("swap") ||
      this.consumeKey("Tab") ||
      this.consumeKey("KeyF");
    return frame;
  }

  /** True while the player is asking to aim, for the look sensitivity scale. */
  get isAiming(): boolean {
    return this.buttons.isDown("aim") || this.mouseButtons.has(2);
  }

  endFrame(): void {
    this.buttons.endFrame();
    this.keyEdges.clear();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    capturePointer(this.surface, event.pointerId);

    if (this.pointerLocked || !this.isTouchPrimary()) {
      // On desktop the mouse both aims and shoots.
      if (event.pointerType === "mouse") this.mouseButtons.add(event.button);
      this.lookPointer = { id: event.pointerId, lastX: event.clientX, lastY: event.clientY };
      return;
    }

    // Left half of the screen drives movement, right half drives aim.
    const isLeftHalf = event.clientX < window.innerWidth * 0.5;
    if (isLeftHalf && this.joystick && !this.joystick.isActive) {
      this.joystick.start(event.pointerId, event.clientX, event.clientY);
    } else if (!this.lookPointer) {
      this.lookPointer = { id: event.pointerId, lastX: event.clientX, lastY: event.clientY };
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.joystick?.owns(event.pointerId)) {
      event.preventDefault();
      this.joystick.move(event.clientX, event.clientY);
      return;
    }
    if (this.lookPointer?.id !== event.pointerId) return;
    event.preventDefault();

    if (this.pointerLocked) {
      this.pendingYaw += event.movementX;
      this.pendingPitch += event.movementY;
      return;
    }
    this.pendingYaw += event.clientX - this.lookPointer.lastX;
    this.pendingPitch += event.clientY - this.lookPointer.lastY;
    this.lookPointer.lastX = event.clientX;
    this.lookPointer.lastY = event.clientY;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (event.pointerType === "mouse") this.mouseButtons.delete(event.button);
    if (this.joystick?.owns(event.pointerId)) this.joystick.end();
    if (this.lookPointer?.id === event.pointerId) this.lookPointer = null;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Browsers repeat a held key; only the first press is an edge.
    if (!this.keys.has(event.code)) this.keyEdges.add(event.code);
    this.keys.add(event.code);
    // Tab would otherwise move focus out of the canvas mid-fight.
    if (event.code === "Tab") event.preventDefault();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  /** True once per physical press of a key. */
  private consumeKey(code: string): boolean {
    if (!this.keyEdges.has(code)) return false;
    this.keyEdges.delete(code);
    return true;
  }

  private readonly onBlur = (): void => {
    // Without this, a key or button held during an alt-tab stays stuck down.
    this.keys.clear();
    this.keyEdges.clear();
    this.mouseButtons.clear();
    this.buttons.releaseAll();
    this.joystick?.end();
    this.lookPointer = null;
  };

  private readonly onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.surface;
  };

  private readonly onDeviceOrientation = (event: DeviceOrientationEvent): void => {
    if (this.settings.gyroScale <= 0) return;
    const yaw = event.alpha ?? 0;
    const pitch = event.beta ?? 0;
    if (this.gyroBaseYaw === null) {
      this.gyroBaseYaw = yaw;
      this.lastGyroPitch = pitch;
      return;
    }
    let deltaYaw = yaw - this.gyroBaseYaw;
    if (deltaYaw > 180) deltaYaw -= 360;
    if (deltaYaw < -180) deltaYaw += 360;
    this.gyroBaseYaw = yaw;
    const deltaPitch = pitch - this.lastGyroPitch;
    this.lastGyroPitch = pitch;
    // Convert degrees of device rotation into the pixel-equivalent the look
    // pipeline expects, so one sensitivity model covers both inputs.
    const pixelsPerDegree = 6 * this.settings.gyroScale;
    this.gyroDeltaYaw += -deltaYaw * pixelsPerDegree;
    this.gyroDeltaPitch += -deltaPitch * pixelsPerDegree;
  };

  private lastGyroPitch = 0;
}
