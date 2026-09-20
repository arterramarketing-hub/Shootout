import { describe, expect, it } from "vitest";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { alignToDirection } from "../src/view/orient";

/**
 * Pointing a stretched box down the path a round took.
 *
 * This is here because the obvious Babylon call for it is wrong in a way
 * that only shows up off the horizontal: a tracer fired level looked fine
 * and one fired upward flew off at an angle. The test walks the whole
 * sphere rather than a few directions, because that is the shape of the bug
 * it is guarding against — correct in one place, worse the further you go.
 */

/** Where a rotation actually puts the mesh's length. */
const axisAfter = (rotation: Quaternion): Vector3 => {
  const matrix = new Matrix();
  Matrix.FromQuaternionToRef(rotation, matrix);
  return Vector3.TransformCoordinates(new Vector3(0, 0, 1), matrix).normalize();
};

describe("alignToDirection", () => {
  it("puts the length on the direction, wherever it points", () => {
    const rotation = new Quaternion();
    let worst = 0;
    let worstAt = "";
    for (let yaw = 0; yaw < 360; yaw += 15) {
      for (let pitch = -89; pitch <= 89; pitch += 7) {
        const a = (yaw * Math.PI) / 180;
        const b = (pitch * Math.PI) / 180;
        const direction = new Vector3(
          Math.sin(a) * Math.cos(b),
          Math.sin(b),
          Math.cos(a) * Math.cos(b),
        ).normalize();
        const dot = Vector3.Dot(axisAfter(alignToDirection(direction, rotation)), direction);
        const off = Math.acos(Math.min(1, dot)) * (180 / Math.PI);
        if (off > worst) {
          worst = off;
          worstAt = `yaw ${yaw}, pitch ${pitch}`;
        }
      }
    }
    expect(worst, `worst at ${worstAt}`).toBeLessThan(0.001);
  });

  it("handles the poles and the about-face", () => {
    const rotation = new Quaternion();
    for (const [name, x, y, z] of [
      ["straight up", 0, 1, 0],
      ["straight down", 0, -1, 0],
      ["dead ahead", 0, 0, 1],
      ["dead behind", 0, 0, -1],
      ["hard left", -1, 0, 0],
    ] as const) {
      const direction = new Vector3(x, y, z);
      const axis = axisAfter(alignToDirection(direction, rotation));
      expect(Vector3.Dot(axis, direction), name).toBeCloseTo(1, 6);
    }
  });

  it("writes into the rotation it is given rather than making a new one", () => {
    const rotation = new Quaternion();
    expect(alignToDirection(new Vector3(0, 1, 0), rotation)).toBe(rotation);
  });
});
