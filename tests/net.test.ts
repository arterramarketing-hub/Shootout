import { describe, expect, it } from "vitest";
import { PositionHistory, lerpAngle, rewindMillis } from "../src/net/history";
import {
  MAX_REWIND_MS,
  clampCommandDt,
  decode,
  encode,
  roundAngle,
  roundPosition,
  sanitiseName,
} from "../src/net/protocol";
import { bracket, interpolateSnapshot, reconcilePlayer } from "../src/net/reconcile";
import type { PlayerSnapshot } from "../src/net/protocol";
import { BrushWorld } from "../src/sim/brushWorld";
import type { BoxBrush } from "../src/maps/types";
import { createPlayer } from "../src/sim/player";
import { emptyInput } from "../src/sim/types";
import { vec3 } from "../src/sim/vec3";

const floor: BoxBrush[] = [
  { kind: "floor", x: 0, y: -0.5, z: 0, width: 60, height: 1, depth: 60 },
];

const snapshotOf = (overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  id: "p_1",
  name: "Alpha",
  team: "a",
  x: 0, y: 0.9, z: 0,
  vx: 0, vy: 0, vz: 0,
  yaw: 0, pitch: 0,
  health: 100,
  dead: false,
  weapon: "ar",
  crouch: 0,
  firing: false,
  ...overrides,
});

describe("protocol", () => {
  it("round-trips a message", () => {
    const message = { type: "ping", time: 1234 } as const;
    expect(decode(encode(message))).toEqual(message);
  });

  it("rejects rubbish rather than throwing", () => {
    expect(decode("not json")).toBeNull();
    expect(decode("[]")).toBeNull();
    expect(decode('{"no":"type"}')).toBeNull();
    expect(decode("null")).toBeNull();
  });

  it("rounds positions to the centimetre and angles finer", () => {
    expect(roundPosition(1.23456)).toBe(1.23);
    expect(roundAngle(1.23456)).toBe(1.235);
  });

  it("caps the step a client may claim for one command", () => {
    expect(clampCommandDt(1 / 60)).toBeCloseTo(1 / 60, 6);
    // A client claiming a huge step would otherwise move further per tick.
    expect(clampCommandDt(5)).toBeCloseTo(1 / 20, 6);
    expect(clampCommandDt(-1)).toBe(0);
    expect(clampCommandDt(Number.NaN)).toBe(0);
  });

  it("strips names down to something printable", () => {
    expect(sanitiseName("  Alpha  ")).toBe("Alpha");
    expect(sanitiseName("<script>bad</script>")).toBe("scriptbadscript");
    expect(sanitiseName("")).toBe("Player");
    expect(sanitiseName(42)).toBe("Player");
    expect(sanitiseName("x".repeat(80))).toHaveLength(16);
  });
});

describe("lerpAngle", () => {
  it("interpolates the short way across the wrap", () => {
    const result = lerpAngle(3.0, -3.0, 0.5);
    // Going forward past pi is shorter than sweeping back through zero.
    expect(Math.abs(result)).toBeGreaterThan(3.0);
  });

  it("is the identity at the ends", () => {
    expect(lerpAngle(1, 2, 0)).toBeCloseTo(1, 9);
    expect(lerpAngle(1, 2, 1)).toBeCloseTo(2, 9);
  });
});

describe("rewindMillis", () => {
  it("is half the round trip plus the interpolation delay", () => {
    expect(rewindMillis(80, 100)).toBeCloseTo(140, 6);
  });

  it("never exceeds the cap", () => {
    expect(rewindMillis(5000, 100)).toBe(MAX_REWIND_MS);
  });

  it("falls back to the interpolation delay on a bad measurement", () => {
    expect(rewindMillis(Number.NaN, 100)).toBe(100);
    expect(rewindMillis(-50, 100)).toBe(100);
  });
});

describe("PositionHistory", () => {
  const sample = (time: number, x: number, alive = true) => ({
    time,
    position: vec3(x, 0.9, 0),
    yaw: 0,
    crouch: 0,
    alive,
  });

  it("returns nothing when empty", () => {
    expect(new PositionHistory().sampleAt(0)).toBeNull();
  });

  it("interpolates between two recorded moments", () => {
    const history = new PositionHistory();
    history.record(sample(1000, 0));
    history.record(sample(1100, 10));
    expect(history.sampleAt(1050)!.position.x).toBeCloseTo(5, 5);
  });

  it("clamps to the ends rather than extrapolating", () => {
    const history = new PositionHistory();
    history.record(sample(1000, 0));
    history.record(sample(1100, 10));
    expect(history.sampleAt(500)!.position.x).toBe(0);
    expect(history.sampleAt(9000)!.position.x).toBe(10);
  });

  it("never resurrects someone who was dead at either end", () => {
    const history = new PositionHistory();
    history.record(sample(1000, 0, true));
    history.record(sample(1100, 10, false));
    expect(history.sampleAt(1050)!.alive).toBe(false);
  });

  it("forgets samples older than its window", () => {
    const history = new PositionHistory(200);
    for (let time = 0; time <= 2000; time += 50) history.record(sample(time, time / 100));
    expect(history.length).toBeLessThan(12);
    expect(history.latest()!.time).toBe(2000);
  });

  it("clears on demand", () => {
    const history = new PositionHistory();
    history.record(sample(1000, 0));
    history.clear();
    expect(history.latest()).toBeNull();
  });
});

describe("bracket", () => {
  const snaps = [
    { serverTime: 1000 },
    { serverTime: 1033 },
    { serverTime: 1066 },
    { serverTime: 1100 },
  ];

  it("finds the pair a moment falls between", () => {
    const pair = bracket(snaps, 1050);
    expect(pair!.from.serverTime).toBe(1033);
    expect(pair!.to.serverTime).toBe(1066);
    expect(pair!.t).toBeCloseTo((1050 - 1033) / 33, 3);
  });

  it("holds at the newest rather than extrapolating past it", () => {
    const pair = bracket(snaps, 5000);
    expect(pair!.from.serverTime).toBe(1100);
    expect(pair!.to.serverTime).toBe(1100);
  });

  it("holds at the oldest when the target predates the buffer", () => {
    const pair = bracket(snaps, 0);
    expect(pair!.from.serverTime).toBe(1000);
  });

  it("copes with a single snapshot and with none", () => {
    expect(bracket([{ serverTime: 10 }], 50)!.t).toBe(0);
    expect(bracket([], 50)).toBeNull();
  });
});

describe("interpolateSnapshot", () => {
  it("blends position between two snapshots", () => {
    const blended = interpolateSnapshot(
      snapshotOf({ x: 0, z: 0 }),
      snapshotOf({ x: 10, z: 4 }),
      0.25,
    );
    expect(blended.position.x).toBeCloseTo(2.5, 6);
    expect(blended.position.z).toBeCloseTo(1, 6);
  });

  it("takes state flags from the newer snapshot rather than blending them", () => {
    const blended = interpolateSnapshot(
      snapshotOf({ dead: false, health: 100 }),
      snapshotOf({ dead: true, health: 0 }),
      0.1,
    );
    expect(blended.dead).toBe(true);
    expect(blended.health).toBe(0);
  });
});

describe("reconcilePlayer", () => {
  const setup = () => {
    const body = new BrushWorld(floor).createController(0.38, 0.9);
    body.setPosition(vec3(0, 0.9, 0));
    const state = createPlayer(vec3(0, 0.9, 0));
    return { body, state };
  };

  it("accepts the server's position when there is nothing to replay", () => {
    const { body, state } = setup();
    reconcilePlayer(state, body, snapshotOf({ x: 5, y: 0.9, z: 3 }), []);
    expect(state.position.x).toBeCloseTo(5, 5);
    expect(state.position.z).toBeCloseTo(3, 5);
  });

  it("replays unacknowledged input forward from the server's answer", () => {
    const { body, state } = setup();
    const forward = { ...emptyInput(), moveY: 1 };
    const pending = Array.from({ length: 30 }, (_, i) => ({
      seq: i + 1,
      frame: forward,
      dt: 1 / 60,
    }));
    reconcilePlayer(state, body, snapshotOf({ x: 0, y: 0.9, z: 0 }), pending);
    // Half a second of walking, so the replay must have carried it forward.
    expect(state.position.z).toBeGreaterThan(0.5);
  });

  it("reports no error when the prediction already matched", () => {
    const { body, state } = setup();
    const forward = { ...emptyInput(), moveY: 1 };
    const pending = [{ seq: 1, frame: forward, dt: 1 / 60 }];

    // Predict one step locally, then reconcile from the state before it.
    reconcilePlayer(state, body, snapshotOf(), pending);
    const predicted = { ...state.position };
    const result = reconcilePlayer(
      state,
      body,
      snapshotOf({ vz: state.velocity.z }),
      pending,
    );
    expect(result.distance).toBeLessThan(0.05);
    expect(predicted.z).toBeGreaterThan(0);
  });

  it("snaps instead of easing when the drift is large", () => {
    const { body, state } = setup();
    state.position = vec3(0, 0.9, 0);
    const result = reconcilePlayer(state, body, snapshotOf({ x: 20, z: 20 }), []);
    expect(result.snapped).toBe(true);
    expect(result.error).toEqual({ x: 0, y: 0, z: 0 });
    expect(result.distance).toBeGreaterThan(2.5);
  });

  it("takes the server's velocity rather than keeping its own", () => {
    const { body, state } = setup();
    state.velocity = vec3(9, 0, 9);
    reconcilePlayer(state, body, snapshotOf({ vx: 1, vy: 0, vz: 2 }), []);
    expect(state.velocity.x).toBeCloseTo(1, 6);
    expect(state.velocity.z).toBeCloseTo(2, 6);
  });
});
