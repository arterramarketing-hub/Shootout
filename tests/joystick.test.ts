import { describe, expect, it } from "vitest";
import { INPUT } from "../src/sim/config";
import { Joystick } from "../src/input/joystick";

/** The joystick only ever writes to `style`, so a bare stub is enough. */
const stubElement = () =>
  ({ style: {} as CSSStyleDeclaration }) as unknown as HTMLElement;

const makeJoystick = () => new Joystick(stubElement(), stubElement(), 64);

describe("Joystick", () => {
  it("reads neutral before any touch", () => {
    const stick = makeJoystick();
    expect(stick.read()).toEqual({ x: 0, y: 0, magnitude: 0, active: false });
    expect(stick.isActive).toBe(false);
  });

  it("reads zero at the point of contact", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    const output = stick.read();
    expect(output.active).toBe(true);
    expect(output.magnitude).toBe(0);
  });

  it("treats an upward drag as forward", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(200, 236); // 64px up the screen
    const output = stick.read();
    expect(output.y).toBeGreaterThan(0.9);
    expect(Math.abs(output.x)).toBeLessThan(1e-6);
  });

  it("treats a rightward drag as strafe right", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(264, 300);
    const output = stick.read();
    expect(output.x).toBeGreaterThan(0.9);
  });

  it("swallows movement inside the deadzone", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(200, 300 - 64 * INPUT.joystickDeadzone * 0.5);
    expect(stick.read().magnitude).toBe(0);
  });

  it("still reaches full deflection despite the deadzone", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(200, 300 - 64);
    expect(stick.read().magnitude).toBeCloseTo(1, 5);
  });

  it("clamps magnitude when dragged far past the ring", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(200, 0);
    expect(stick.read().magnitude).toBeLessThanOrEqual(1);
  });

  it("keeps full deflection while the base follows the thumb", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(200, 100); // 200px up, well past the ring
    const output = stick.read();
    expect(output.magnitude).toBeCloseTo(1, 5);
    expect(output.y).toBeCloseTo(1, 5);
  });

  it("only answers to the pointer that started it", () => {
    const stick = makeJoystick();
    stick.start(7, 200, 300);
    expect(stick.owns(7)).toBe(true);
    expect(stick.owns(8)).toBe(false);
  });

  it("returns to neutral when the touch ends", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(200, 236);
    stick.end();
    expect(stick.read()).toEqual({ x: 0, y: 0, magnitude: 0, active: false });
  });

  it("crosses the sprint threshold only near full deflection", () => {
    const stick = makeJoystick();
    stick.start(1, 200, 300);
    stick.move(200, 300 - 40);
    expect(stick.read().magnitude).toBeLessThan(0.9);
    stick.move(200, 300 - 64);
    expect(stick.read().magnitude).toBeGreaterThan(0.9);
  });
});
