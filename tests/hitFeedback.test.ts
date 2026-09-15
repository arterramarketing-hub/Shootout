import { describe, expect, it } from "vitest";
import { Hud, type HudElements, type HudFrame } from "../src/hud/hud";
import { createHealth } from "../src/sim/health";
import { createLoadout } from "../src/sim/loadout";
import { DEFAULT_MATCH, createMatch } from "../src/sim/match";
import { createPlayer } from "../src/sim/player";
import { vec3 } from "../src/sim/vec3";

/**
 * A stub element that records the handful of things the HUD writes to it.
 *
 * The feedback the player reads off the screen is all class names, inline
 * styles and text, so a recorder for those three exercises every path without
 * a DOM. The arcs and numbers additionally need children, because the HUD
 * pools them rather than creating one per hit.
 */
interface Stub {
  classes: Set<string>;
  style: Record<string, string>;
  text: string;
  children: Stub[];
  el: HTMLElement;
}

const stub = (childCount = 0): Stub => {
  const classes = new Set<string>();
  const style: Record<string, string> = {};
  const children: Stub[] = [];
  const self = { classes, style, text: "", children } as Stub;

  self.el = {
    get children() {
      return children.map((child) => child.el);
    },
    classList: {
      toggle: (name: string, on?: boolean) => {
        const next = on ?? !classes.has(name);
        if (next) classes.add(name);
        else classes.delete(name);
      },
      add: (...names: string[]) => names.forEach((n) => classes.add(n)),
      remove: (...names: string[]) => names.forEach((n) => classes.delete(n)),
      contains: (name: string) => classes.has(name),
    },
    style: {
      ...style,
      setProperty: (key: string, value: string) => {
        style[key] = value;
      },
      get transform() {
        return style.transform ?? "";
      },
      set transform(value: string) {
        style.transform = value;
      },
      get opacity() {
        return style.opacity ?? "";
      },
      set opacity(value: string) {
        style.opacity = value;
      },
      get display() {
        return style.display ?? "";
      },
      set display(value: string) {
        style.display = value;
      },
    },
    get textContent() {
      return self.text;
    },
    set textContent(value: string) {
      self.text = value;
    },
    appendChild: () => undefined,
    querySelectorAll: () => [],
  } as unknown as HTMLElement;

  for (let i = 0; i < childCount; i += 1) children.push(stub());
  return self;
};

const makeHud = () => {
  const arcs = stub(4);
  const numbers = stub(6);
  const hitMarker = stub();
  const parts: Record<string, Stub> = { arcs, numbers, hitMarker };
  const plain = () => stub();

  const elements: HudElements = {
    crosshair: plain().el,
    hitMarker: hitMarker.el,
    debug: plain().el,
    stance: plain().el,
    ammoCurrent: plain().el,
    ammoReserve: plain().el,
    weaponName: plain().el,
    weaponClass: plain().el,
    reloadHint: plain().el,
    healthFill: plain().el,
    healthValue: plain().el,
    damageVignette: plain().el,
    feed: plain().el,
    scoreA: plain().el,
    scoreB: plain().el,
    clock: plain().el,
    killFeed: plain().el,
    countdown: plain().el,
    respawn: plain().el,
    respawnTimer: plain().el,
    damageArcs: arcs.el,
    damageNumbers: numbers.el,
    spawnShield: plain().el,
    spawnShieldTime: plain().el,
    root: plain().el,
  };
  return { hud: new Hud(elements), parts };
};

/** Advance the HUD by a frame, with the player facing the given yaw. */
const tick = (hud: Hud, yaw: number, deltaSeconds = 1 / 60): void => {
  const player = createPlayer(vec3(0, 0.9, 0), yaw);
  player.yaw = yaw;
  const frame: HudFrame = {
    player,
    loadout: createLoadout(["ar"]),
    health: createHealth(),
    match: createMatch(DEFAULT_MATCH),
    respawnIn: 0,
    fps: 60,
    tier: "high",
    activeMeshes: 10,
    deltaSeconds,
  };
  hud.update(frame);
};

const litArcs = (parts: Record<string, Stub>) =>
  parts.arcs.children.filter((arc) => Number(arc.style.opacity ?? "0") > 0.01);

/** The screen angle an arc is drawn at, in degrees. */
const arcAngle = (arc: Stub): number =>
  Number(/rotate\((-?[\d.]+)deg\)/.exec(arc.style.transform ?? "")?.[1] ?? NaN);

describe("damage direction arcs", () => {
  it("points at the attacker rather than at a fixed corner", () => {
    const { hud, parts } = makeHud();
    // Attacker due east of a player facing north: a quarter turn to the right.
    hud.showDamageFrom(Math.PI / 2);
    tick(hud, 0);

    const lit = litArcs(parts);
    expect(lit).toHaveLength(1);
    expect(arcAngle(lit[0])).toBeCloseTo(90, 1);
  });

  it("keeps pointing at the attacker as the player turns to find them", () => {
    /*
     * The whole purpose of the thing. An arc that stored a screen angle would
     * stay pinned where it first appeared and send the player somewhere the
     * attacker has never been.
     */
    const { hud, parts } = makeHud();
    hud.showDamageFrom(Math.PI / 2);

    tick(hud, 0);
    expect(arcAngle(litArcs(parts)[0])).toBeCloseTo(90, 1);

    // The player turns a quarter of the way toward them.
    tick(hud, Math.PI / 4);
    expect(arcAngle(litArcs(parts)[0])).toBeCloseTo(45, 1);

    // Facing them: the arc is straight up, which reads as "dead ahead".
    tick(hud, Math.PI / 2);
    expect(arcAngle(litArcs(parts)[0])).toBeCloseTo(0, 1);
  });

  it("takes the short way round rather than spinning the long way", () => {
    const { hud, parts } = makeHud();
    hud.showDamageFrom(-Math.PI * 0.9);
    tick(hud, Math.PI * 0.9);
    // 324 degrees apart the long way; the arc must read it as -36.
    expect(Math.abs(arcAngle(litArcs(parts)[0]))).toBeLessThan(180);
  });

  it("shows two attackers as two directions", () => {
    const { hud, parts } = makeHud();
    hud.showDamageFrom(0);
    hud.showDamageFrom(Math.PI);
    tick(hud, 0);
    expect(litArcs(parts)).toHaveLength(2);
  });

  it("reuses one arc for repeated hits from the same direction", () => {
    // A burst from one gun is one attacker, and should light one arc.
    const { hud, parts } = makeHud();
    for (let i = 0; i < 5; i += 1) hud.showDamageFrom(1.2 + i * 0.02);
    tick(hud, 0);
    expect(litArcs(parts)).toHaveLength(1);
  });

  it("expires, so an old arc does not send the player after a dead attacker", () => {
    const { hud, parts } = makeHud();
    hud.showDamageFrom(1);
    tick(hud, 0);
    expect(litArcs(parts)).toHaveLength(1);

    for (let i = 0; i < 200; i += 1) tick(hud, 0, 1 / 60);
    expect(litArcs(parts)).toHaveLength(0);
  });

  it("never lights more arcs than it has, however many attackers there are", () => {
    const { hud, parts } = makeHud();
    for (let i = 0; i < 12; i += 1) hud.showDamageFrom(i * 0.5);
    tick(hud, 0);
    expect(litArcs(parts).length).toBeLessThanOrEqual(4);
  });
});

describe("hit and kill confirmation", () => {
  it("marks a plain hit without claiming a kill", () => {
    const { hud, parts } = makeHud();
    hud.showHitMarker(false, false);
    expect(parts.hitMarker.classes.has("is-kill")).toBe(false);
    expect(parts.hitMarker.style.opacity).toBe("1");
  });

  it("marks a kill distinctly from a headshot that did not kill", () => {
    const { hud, parts } = makeHud();
    hud.showHitMarker(true, false);
    expect(parts.hitMarker.classes.has("is-headshot")).toBe(true);
    expect(parts.hitMarker.classes.has("is-kill")).toBe(false);

    hud.showHitMarker(true, true);
    expect(parts.hitMarker.classes.has("is-kill")).toBe(true);
  });

  it("holds a kill marker longer than a hit marker", () => {
    // The question a kill marker answers — is this fight over — is the one
    // worth keeping on screen.
    const hit = makeHud();
    hit.hud.showHitMarker(false, false);
    const kill = makeHud();
    kill.hud.showHitMarker(false, true);

    for (let i = 0; i < 18; i += 1) {
      tick(hit.hud, 0);
      tick(kill.hud, 0);
    }
    expect(Number(hit.parts.hitMarker.style.opacity)).toBe(0);
    expect(Number(kill.parts.hitMarker.style.opacity)).toBeGreaterThan(0);
  });

  it("clears the kill styling once the marker has gone", () => {
    const { hud, parts } = makeHud();
    hud.showHitMarker(true, true);
    for (let i = 0; i < 60; i += 1) tick(hud, 0);
    expect(parts.hitMarker.classes.has("is-kill")).toBe(false);
    expect(parts.hitMarker.classes.has("is-headshot")).toBe(false);
  });
});

describe("damage numbers", () => {
  it("shows what a shot did, rounded", () => {
    const { hud, parts } = makeHud();
    hud.showDamageNumber(34.4, false, false);
    expect(parts.numbers.children.some((n) => n.text === "34")).toBe(true);
  });

  it("colours a kill apart from a headshot", () => {
    const { hud, parts } = makeHud();
    hud.showDamageNumber(40, true, false);
    expect(parts.numbers.children.some((n) => n.classes.has("is-headshot"))).toBe(true);

    hud.showDamageNumber(40, true, true);
    expect(parts.numbers.children.some((n) => n.classes.has("is-kill"))).toBe(true);
  });

  it("gives each number its own place, so a burst does not stack in one spot", () => {
    const { hud, parts } = makeHud();
    for (let i = 0; i < 4; i += 1) hud.showDamageNumber(20, false, false);
    tick(hud, 0);
    const transforms = new Set(
      parts.numbers.children
        .filter((n) => Number(n.style.opacity ?? "0") > 0)
        .map((n) => n.style.transform),
    );
    expect(transforms.size).toBeGreaterThan(1);
  });

  it("fades away rather than lingering over the fight", () => {
    const { hud, parts } = makeHud();
    hud.showDamageNumber(30, false, false);
    tick(hud, 0);
    expect(parts.numbers.children.some((n) => Number(n.style.opacity ?? "0") > 0)).toBe(true);

    for (let i = 0; i < 120; i += 1) tick(hud, 0);
    expect(parts.numbers.children.every((n) => Number(n.style.opacity ?? "0") === 0)).toBe(true);
  });
});
