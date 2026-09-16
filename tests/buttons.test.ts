import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ButtonBank, type ButtonAction } from "../src/input/buttons";

/**
 * A button stub that records its listeners so a test can fire real pointer
 * sequences at it, and a matching stub for the window-level release backstop.
 *
 * The bank only ever reads `classList` and `setPointerCapture` off an element,
 * so nothing heavier than this is needed to exercise every path through it.
 */
type Listener = (event: PointerEvent) => void;

interface StubButton {
  element: HTMLElement;
  classes: Set<string>;
  attributes: Map<string, string>;
  fire: (type: string, pointerId: number, at?: { x: number; y: number }) => void;
  /** Make capture throw, the way a browser does for a forgotten pointer. */
  breakCapture: () => void;
}

const windowListeners = new Map<string, Listener[]>();

const stubButton = (): StubButton => {
  const listeners = new Map<string, Listener[]>();
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  let captureThrows = false;

  const element = {
    addEventListener: (type: string, listener: Listener) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    setPointerCapture: () => {
      if (captureThrows) throw new Error("pointer is no longer active");
    },
    setAttribute: (name: string, value: string) => void attributes.set(name, value),
    removeAttribute: (name: string) => void attributes.delete(name),
    classList: {
      toggle: (name: string, on: boolean) => {
        if (on) classes.add(name);
        else classes.delete(name);
      },
    },
  } as unknown as HTMLElement;

  return {
    element,
    classes,
    attributes,
    breakCapture: () => {
      captureThrows = true;
    },
    fire: (type, pointerId, at = { x: 0, y: 0 }) => {
      const event = {
        pointerId,
        clientX: at.x,
        clientY: at.y,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      } as unknown as PointerEvent;
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
};

/** Deliver a release the way the browser does when capture never took hold. */
const fireWindow = (type: string, pointerId: number): void => {
  const event = { pointerId } as unknown as PointerEvent;
  for (const listener of windowListeners.get(type) ?? []) listener(event);
};

beforeEach(() => {
  windowListeners.clear();
  (globalThis as { window?: unknown }).window = {
    addEventListener: (type: string, listener: Listener) => {
      const existing = windowListeners.get(type) ?? [];
      existing.push(listener);
      windowListeners.set(type, existing);
    },
  };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const press = (button: StubButton, pointerId = 1): void => {
  button.fire("pointerdown", pointerId);
};
const release = (button: StubButton, pointerId = 1): void => {
  button.fire("pointerup", pointerId);
};

const bankWith = (action: ButtonAction) => {
  const bank = new ButtonBank();
  const button = stubButton();
  bank.register({ action, element: button.element });
  return { bank, button };
};

describe("ButtonBank in hold mode", () => {
  it("follows the finger down and up", () => {
    const { bank, button } = bankWith("aim");
    expect(bank.isDown("aim")).toBe(false);
    press(button);
    expect(bank.isDown("aim")).toBe(true);
    release(button);
    expect(bank.isDown("aim")).toBe(false);
  });

  it("never reports a hold as latched", () => {
    const { bank, button } = bankWith("aim");
    press(button);
    expect(bank.isLatched("aim")).toBe(false);
  });
});

describe("ButtonBank in toggle mode", () => {
  it("latches on a tap and survives the finger leaving", () => {
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);

    press(button);
    release(button);
    expect(bank.isDown("aim")).toBe(true);
    expect(bank.isLatched("aim")).toBe(true);
  });

  it("un-latches on the next tap", () => {
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);

    press(button);
    release(button);
    press(button);
    release(button);
    expect(bank.isDown("aim")).toBe(false);
  });

  it("latches on the press rather than waiting for the release", () => {
    // A player who taps and holds is asking to aim now, not on lift.
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);
    press(button);
    expect(bank.isDown("aim")).toBe(true);
  });

  it("lets the game drop a latch the player did not end", () => {
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);
    press(button);
    release(button);

    bank.clearLatch("aim");
    expect(bank.isDown("aim")).toBe(false);
    expect(button.classes.has("is-active")).toBe(false);
  });

  it("marks a latch distinctly from a hold, so the player can see it will stay", () => {
    const { bank, button } = bankWith("aim");
    press(button);
    expect(button.classes.has("is-active")).toBe(true);
    expect(button.classes.has("is-latched")).toBe(false);
    release(button);

    bank.setToggle("aim", true);
    press(button);
    release(button);
    expect(button.classes.has("is-active")).toBe(true);
    expect(button.classes.has("is-latched")).toBe(true);
  });

  it("drops the latch when the window loses focus", () => {
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);
    press(button);
    release(button);

    bank.releaseAll();
    expect(bank.isDown("aim")).toBe(false);
    expect(button.classes.has("is-active")).toBe(false);
  });

  it("drops whatever was down when the mode changes mid-match", () => {
    // Flipping the setting while aiming must not leave the sights stuck up.
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);
    press(button);
    release(button);
    expect(bank.isDown("aim")).toBe(true);

    bank.setToggle("aim", false);
    expect(bank.isDown("aim")).toBe(false);
  });

  it("does not disturb a latch when the mode is set to what it already was", () => {
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);
    press(button);
    release(button);

    bank.setToggle("aim", true);
    expect(bank.isDown("aim")).toBe(true);
  });
});

describe("ButtonBank release routing", () => {
  it("releases a press whose capture the browser refused", () => {
    // Without the window-level backstop this press is held forever, which on
    // the fire button is a weapon that never stops shooting.
    const { bank, button } = bankWith("fire");
    button.breakCapture();

    press(button, 7);
    expect(bank.isDown("fire")).toBe(true);

    fireWindow("pointerup", 7);
    expect(bank.isDown("fire")).toBe(false);
  });

  it("ignores a release for a pointer it never saw", () => {
    const { bank, button } = bankWith("fire");
    press(button, 1);
    fireWindow("pointerup", 99);
    expect(bank.isDown("fire")).toBe(true);
  });

  it("lights every element bound to an action, not just the one pressed", () => {
    // Fire sits under both thumbs; lighting one and not the other reads as a
    // button that did not register the press.
    const bank = new ButtonBank();
    const right = stubButton();
    const left = stubButton();
    bank.register({ action: "fire", element: right.element });
    bank.register({ action: "fire", element: left.element });

    press(right, 3);
    expect(right.classes.has("is-active")).toBe(true);
    expect(left.classes.has("is-active")).toBe(true);

    release(right, 3);
    expect(right.classes.has("is-active")).toBe(false);
    expect(left.classes.has("is-active")).toBe(false);
  });
});

describe("ButtonBank press edges", () => {
  it("reports a press once and only once", () => {
    const { bank, button } = bankWith("reload");
    press(button);
    expect(bank.consumePress("reload")).toBe(true);
    expect(bank.consumePress("reload")).toBe(false);
  });

  it("clears un-consumed edges at the end of the frame", () => {
    const { bank, button } = bankWith("reload");
    press(button);
    bank.endFrame();
    expect(bank.consumePress("reload")).toBe(false);
  });
});

describe("ButtonBank accessibility", () => {
  it("announces a latching control's pressed state", () => {
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);
    expect(button.attributes.get("aria-pressed")).toBe("false");

    press(button);
    release(button);
    expect(button.attributes.get("aria-pressed")).toBe("true");

    press(button);
    release(button);
    expect(button.attributes.get("aria-pressed")).toBe("false");
  });

  it("says nothing about a momentary control", () => {
    // A hold-to-use button is never "pressed" in the toggle sense, and a
    // permanently false aria-pressed on it misreports what it does.
    const { bank, button } = bankWith("fire");
    press(button);
    expect(button.attributes.has("aria-pressed")).toBe(false);
    release(button);
    expect(button.attributes.has("aria-pressed")).toBe(false);
    expect(bank.isDown("fire")).toBe(false);
  });

  it("stops announcing a pressed state when the control stops latching", () => {
    const { bank, button } = bankWith("aim");
    bank.setToggle("aim", true);
    press(button);
    release(button);
    expect(button.attributes.get("aria-pressed")).toBe("true");

    bank.setToggle("aim", false);
    expect(button.attributes.has("aria-pressed")).toBe(false);
  });
});

describe("ButtonBank drag", () => {
  /*
   * A thumb already down on fire drags the aim. This is how a burst gets
   * walked onto a target on a phone: the other thumb is on the stick, and
   * lifting the firing thumb to the look surface means not firing.
   */
  it("reports the movement of a finger held on a button", () => {
    const { bank, button } = bankWith("fire");
    const drags: [ButtonAction, number, number][] = [];
    bank.onDrag = (action, dx, dy) => drags.push([action, dx, dy]);

    button.fire("pointerdown", 1, { x: 100, y: 100 });
    button.fire("pointermove", 1, { x: 112, y: 95 });
    button.fire("pointermove", 1, { x: 120, y: 95 });
    expect(drags).toEqual([
      ["fire", 12, -5],
      ["fire", 8, 0],
    ]);
  });

  it("ignores a move from a finger that is not down on the button", () => {
    const { bank, button } = bankWith("fire");
    const drags: unknown[] = [];
    bank.onDrag = (...args) => drags.push(args);
    button.fire("pointermove", 7, { x: 50, y: 50 });
    expect(drags).toEqual([]);
  });

  it("stops reporting once the finger lifts", () => {
    const { bank, button } = bankWith("fire");
    const drags: unknown[] = [];
    bank.onDrag = (...args) => drags.push(args);
    button.fire("pointerdown", 1, { x: 0, y: 0 });
    button.fire("pointerup", 1, { x: 30, y: 0 });
    button.fire("pointermove", 1, { x: 60, y: 0 });
    expect(drags).toEqual([]);
  });
});
