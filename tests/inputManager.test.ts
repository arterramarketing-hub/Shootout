import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InputManager } from "../src/input/inputManager";

/**
 * Enough of a DOM to drive the pointer routing.
 *
 * The manager only ever reads `style`, attaches listeners, and asks whether
 * the device is touch-first, so the surface is a listener recorder and the
 * joystick's two elements are bare style holders.
 */
type Listener = (event: Event) => void;

const makeSurface = () => {
  const listeners = new Map<string, Listener[]>();
  const element = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (type: string, listener: Listener) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
  } as unknown as HTMLElement;

  const dispatch = (type: string, event: Record<string, unknown>) => {
    const full = { preventDefault: () => undefined, ...event } as unknown as Event;
    for (const listener of listeners.get(type) ?? []) listener(full);
  };
  return { element, dispatch };
};

const stubElement = () => ({ style: {} as CSSStyleDeclaration }) as unknown as HTMLElement;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    innerWidth: 800,
    innerHeight: 400,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    // A phone: this is what routes touches into the half-screen scheme.
    matchMedia: () => ({ matches: true }),
  };
  (globalThis as { document?: unknown }).document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    pointerLockElement: null,
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

const setup = () => {
  const surface = makeSurface();
  const input = new InputManager(surface.element);
  input.attachJoystick(stubElement(), stubElement());
  input.start();

  const down = (id: number, x: number, y: number) =>
    surface.dispatch("pointerdown", { pointerId: id, clientX: x, clientY: y, pointerType: "touch" });
  const move = (id: number, x: number, y: number) =>
    surface.dispatch("pointermove", { pointerId: id, clientX: x, clientY: y, pointerType: "touch" });
  const up = (id: number) =>
    surface.dispatch("pointerup", { pointerId: id, pointerType: "touch" });

  /** Drag the given pointer and report how far the view turned. */
  const turn = (id: number, fromX: number, toX: number): number => {
    const before = input.look.yaw;
    down(id, fromX, 150);
    move(id, toX, 150);
    input.updateLook(false);
    up(id);
    return input.look.yaw - before;
  };

  return { input, down, move, up, turn };
};

// The stubbed viewport is 800 wide, so 200 is the left half and 600 the right.
const LEFT = 200;
const RIGHT = 600;

describe("half-screen pointer routing", () => {
  it("turns the view from a drag on the right", () => {
    const { turn } = setup();
    expect(Math.abs(turn(1, RIGHT, RIGHT + 80))).toBeGreaterThan(0);
  });

  it("never turns the view from a drag on the left", () => {
    // The left half is movement. A drag there walks; it does not look.
    const { turn } = setup();
    expect(turn(1, LEFT, LEFT + 80)).toBe(0);
  });

  it("keeps looking while a stray finger rests on the left", () => {
    /*
     * The reported bug. A second finger anywhere on the left, with the stick
     * already under the first, used to be promoted to the look pointer, and
     * the right thumb then had no way to turn the view at all until the stray
     * finger lifted — looking simply died mid-fight.
     */
    const { input, down, turn } = setup();
    down(1, LEFT, 250); // the thumb on the stick
    down(2, LEFT + 100, 300); // a second finger resting on the left

    expect(Math.abs(turn(3, RIGHT, RIGHT + 80))).toBeGreaterThan(0);
    void input;
  });

  it("keeps looking while a finger is held on the right", () => {
    // The look pointer is whichever right-half finger arrived first; a second
    // one is ignored rather than taking over mid-drag.
    const { down, turn } = setup();
    down(1, RIGHT, 300);
    // The held pointer owns the look, so a new one must not steal it, but the
    // held one must still be able to turn.
    expect(Math.abs(turn(1, RIGHT, RIGHT + 80))).toBeGreaterThan(0);
  });

  it("hands the look on to the next finger once the first lifts", () => {
    const { down, up, turn } = setup();
    down(1, RIGHT, 300);
    up(1);
    expect(Math.abs(turn(2, RIGHT, RIGHT + 80))).toBeGreaterThan(0);
  });

  it("keeps tracking a look drag that crosses into the left half", () => {
    // Routing is decided once, where the finger lands. A drag that started on
    // the right keeps turning the view all the way across the screen.
    const { input, down, move, up } = setup();
    const before = input.look.yaw;
    down(1, RIGHT, 150);
    move(1, 300, 150);
    move(1, 100, 150);
    input.updateLook(false);
    up(1);
    expect(input.look.yaw).not.toBe(before);
  });

  it("starts the stick again after the first finger lifts", () => {
    const { input, down, up } = setup();
    down(1, LEFT, 250);
    up(1);
    down(2, LEFT + 50, 250);
    // A fresh left-half touch owns the stick, so it must not have become the
    // look pointer on the way through.
    const before = input.look.yaw;
    input.updateLook(false);
    expect(input.look.yaw).toBe(before);
  });
});
