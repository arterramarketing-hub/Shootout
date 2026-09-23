import { expect, test, type Page } from "@playwright/test";

/** The snapshot `readState` pulls out of the running game. */
interface GameState {
  ready: boolean;
  fps: number;
  quality: string;
  activeMeshes: number;
  position: { x: number; y: number; z: number };
  weapon: {
    id: string;
    name: string;
    magazine: number;
    reserve: number;
    reloading: boolean;
    ads: number;
  };
  health: number;
  speed: number;
}

/** The development handle the game exposes on `window`. */
interface DebugHandle extends GameState {
  teleport: (x: number, z: number, yaw?: number, y?: number, pitch?: number) => void;
  weaponScreenPosition: () => { x: number; y: number } | null;
  startMatch: () => void;
  match: {
    phase: string;
    scores: { a: number; b: number };
    timeRemaining: number;
    kills: number;
    deaths: number;
    feed: number;
  };
  bots: {
    id: string;
    name: string;
    team: string;
    behaviour: string;
    health: number;
    dead: boolean;
    pathLength: number;
    position: { x: number; y: number; z: number };
  }[];
  nav: { nodes: number; cells: number; millis: number; raycasts: number; pruned: number };
  survival: {
    phase: string;
    wave: number;
    timer: number;
    left: number;
    kills: number;
    cleared: number;
    zombies: {
      id: string;
      dead: boolean;
      runner: boolean;
      health: number;
      position: { x: number; y: number; z: number };
    }[];
  } | null;
  callWave: () => void;
  invulnerable: boolean;
  map: { id: string; name: string };
  profile: { level: number; xp: number; kills: number; carried: string[] };
  screen: string;
  net: {
    state: string;
    online: boolean;
    id: string | null;
    rtt: number;
    remotes: number;
    tick: number;
    phase: string | null;
  };
  settings: {
    touchSensitivity: number;
    mouseSensitivity: number;
    fovDegrees: number;
    hudScale: number;
    invertY: boolean;
    audioEnabled: boolean;
    difficulty: string;
    teamSize: number;
    mode: string;
  };
}

declare global {
  interface Window {
    __shootout: DebugHandle;
  }
}

const bootGame = async (page: Page): Promise<void> => {
  await page.goto("/");
  await page.waitForFunction(() => window.__shootout?.ready === true, null, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "DEPLOY" }).click();
  // Let the loop run long enough for the frame-rate meter to report.
  await page.waitForFunction(() => window.__shootout.fps > 0, null, { timeout: 20_000 });
  // And long enough for the round to actually start. A round opens on a
  // countdown with everyone held in place, so anything that measures
  // movement before this measures the countdown. How long that takes in
  // wall-clock is a property of the machine, not of the game: the level here
  // renders at a handful of frames a second on a software rasteriser, and
  // the simulation is capped at five steps a frame, so it runs at a fraction
  // of real time. Waiting on the phase rather than on a stopwatch is the
  // only form of this that holds on both.
  await page.waitForFunction(() => window.__shootout.match.phase === "active", null, {
    timeout: 40_000,
  });
};

const readState = (page: Page): Promise<GameState> =>
  page.evaluate(() => ({
    ready: window.__shootout.ready,
    fps: window.__shootout.fps,
    quality: window.__shootout.quality,
    activeMeshes: window.__shootout.activeMeshes,
    position: { ...window.__shootout.position },
    weapon: { ...window.__shootout.weapon },
    health: window.__shootout.health,
    speed: window.__shootout.speed,
  }));

/** Press or release an on-screen button by id. */
const button = (page: Page, id: string, down: boolean): Promise<void> =>
  page.evaluate(
    ([id, down]) => {
      const element = document.getElementById(id);
      if (!element) throw new Error(`missing button: ${id}`);
      element.dispatchEvent(
        new PointerEvent(down ? "pointerdown" : "pointerup", {
          pointerId: 21,
          pointerType: "touch",
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [id, down] as const,
  );

test("boots, builds the level, and renders frames", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await bootGame(page);
  const state = await readState(page);

  expect(state.ready).toBe(true);
  expect(state.fps).toBeGreaterThan(0);
  // Every brush is merged into one mesh per surface kind, so a handful of
  // visible meshes is the whole level.
  expect(state.activeMeshes).toBeGreaterThan(0);
  // The merged level surfaces, three meshes per practice target, the map's
  // landmarks and the weapon in hand. The ceiling is about draw calls on a
  // phone rather than an exact count, so it has room for the map to grow —
  // but not room for the merge to quietly stop happening.
  expect(state.activeMeshes).toBeLessThan(120);
  expect(["low", "medium", "high"]).toContain(state.quality);
  expect(errors).toEqual([]);
});

test("the player spawns standing on the floor", async ({ page }) => {
  await bootGame(page);
  const { position } = await readState(page);
  // Collider centre sits at half the standing height once gravity settles.
  expect(position.y).toBeGreaterThan(0.5);
  expect(position.y).toBeLessThan(1.5);
});

test("keyboard input moves the player", async ({ page }) => {
  await bootGame(page);
  // The spawn faces a wall, which is what the next test walks into on
  // purpose. Start in the street with several metres of it ahead.
  await page.evaluate(() => window.__shootout.teleport(4, -2, 0));
  // Long enough to land and shake off the landing, which costs speed for a
  // moment and would otherwise be measured as walking slowly.
  await page.waitForTimeout(1200);
  const before = (await readState(page)).position;

  await page.keyboard.down("w");
  // Held until the player has covered ground, rather than for a fixed
  // stretch of wall-clock: on a software rasteriser the simulation runs at a
  // fraction of real time, and a stopwatch would be measuring the renderer.
  await page.waitForFunction(
    ([x, z]) => Math.hypot(window.__shootout.position.x - x, window.__shootout.position.z - z) > 3,
    [before.x, before.z] as const,
    { timeout: 25_000 },
  );
  // Speed is the part that does not depend on how many frames were drawn: it
  // is what the simulation has the player doing at this instant.
  const { speed } = await readState(page);
  await page.keyboard.up("w");

  expect(speed).toBeGreaterThan(4);
  expect(speed).toBeLessThan(9);
});

test("the player cannot walk through the level geometry", async ({ page }) => {
  await bootGame(page);

  // Walk hard into a wall for several seconds from the spawn corner.
  await page.keyboard.down("w");
  await page.keyboard.down("Shift");
  await page.waitForTimeout(4000);
  await page.keyboard.up("Shift");
  await page.keyboard.up("w");

  const { position } = await readState(page);
  // The level runs to thirty-two metres either side of the middle and
  // twenty-four up and down the street, and the ends of the street are
  // fenced. A metre or two of slack for the collider, and no more: past
  // that is outside, where only the backdrop is.
  expect(Math.abs(position.x)).toBeLessThan(34);
  expect(Math.abs(position.z)).toBeLessThan(26);
  expect(position.y).toBeGreaterThan(0.4);
});

test("a touch drag on the left half moves the player", async ({ page, isMobile }) => {
  test.skip(!isMobile, "touch controls only run on a coarse pointer");
  await bootGame(page);
  const before = (await readState(page)).position;

  const viewport = page.viewportSize();
  if (!viewport) throw new Error("no viewport");
  const originX = viewport.width * 0.22;
  const originY = viewport.height * 0.6;

  await page.touchscreen.tap(originX, originY);
  // Playwright's touchscreen has no drag, so drive the pointer events directly.
  await page.evaluate(
    ({ x, y }) => {
      const canvas = document.getElementById("view");
      if (!canvas) throw new Error("no canvas");
      const send = (type: string, clientX: number, clientY: number) => {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "touch",
            clientX,
            clientY,
            bubbles: true,
            cancelable: true,
          }),
        );
      };
      send("pointerdown", x, y);
      // Hold the stick fully forward for a second of real time.
      send("pointermove", x, y - 90);
      return new Promise<void>((resolve) => setTimeout(resolve, 1000));
    },
    { x: originX, y: originY },
  );

  const after = (await readState(page)).position;
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(1.0);
});

test("starts with a full rifle magazine and full health", async ({ page }) => {
  await bootGame(page);
  const state = await readState(page);
  expect(state.weapon.id).toBe("ar");
  expect(state.weapon.magazine).toBe(30);
  expect(state.health).toBe(100);
});

test("holding fire spends ammunition", async ({ page }) => {
  await bootGame(page);
  await button(page, "btn-fire", true);
  await page.waitForTimeout(500);
  await button(page, "btn-fire", false);

  const state = await readState(page);
  expect(state.weapon.magazine).toBeLessThan(30);
  expect(state.weapon.magazine).toBeGreaterThan(20);
});

test("reloading refills the magazine from the reserve", async ({ page }) => {
  await bootGame(page);
  await button(page, "btn-fire", true);
  await page.waitForTimeout(600);
  await button(page, "btn-fire", false);
  const spent = await readState(page);
  expect(spent.weapon.magazine).toBeLessThan(30);

  await button(page, "btn-reload", true);
  await button(page, "btn-reload", false);
  // Wait for the magazine to come back rather than for a fixed time: under a
  // software rasteriser the simulation runs slower than the wall clock.
  await page.waitForFunction(
    () => window.__shootout.weapon.magazine === 30,
    null,
    { timeout: 20_000 },
  );

  const reloaded = await readState(page);
  expect(reloaded.weapon.magazine).toBe(30);
  expect(reloaded.weapon.reserve).toBeLessThan(spent.weapon.reserve);
});

test("aiming is a toggle: one tap raises the sights, the next drops them", async ({ page }) => {
  /*
   * A phone has no spare thumb to hold an aim button down with, so the
   * sights latch. Releasing the button must not drop them, which is the
   * whole point.
   *
   * Waited on rather than timed. The sights take a fixed amount of
   * simulation time to come up, and how much wall clock that is depends on
   * the frame rate of whatever is running the test: these render on a
   * software rasteriser, and the simulation is capped at five steps a
   * frame, so half a second of stopwatch can be a tenth of a second of
   * game. That is what this test used to assert on, and it read as a
   * broken toggle whenever the machine was busy.
   */
  await bootGame(page);
  const settle = async (up: boolean): Promise<void> => {
    await button(page, "btn-aim", true);
    await button(page, "btn-aim", false);
    await page.waitForFunction(
      (wantUp) => (wantUp ? window.__shootout.weapon.ads > 0.9 : window.__shootout.weapon.ads < 0.1),
      up,
      { timeout: 20_000 },
    );
  };
  // Tapped once, the sights come up and stay up with nothing held down.
  await settle(true);
  // Tapped again, they drop.
  await settle(false);
});

test("swapping cycles through the loadout", async ({ page }) => {
  // Levelling gates the rack, so seed a profile that has all four.
  await page.addInitScript(() => {
    if (!localStorage.getItem("shootout.profile.v1")) {
      localStorage.setItem("shootout.profile.v1", JSON.stringify({ level: 10 }));
    }
  });
  await bootGame(page);
  const seen: string[] = [(await readState(page)).weapon.id];
  for (let i = 0; i < 3; i += 1) {
    const before = seen[seen.length - 1];
    await button(page, "weapon-banner", true);
    await button(page, "weapon-banner", false);
    await page.waitForFunction(
      (previous) => window.__shootout.weapon.id !== previous,
      before,
      { timeout: 20_000 },
    );
    seen.push((await readState(page)).weapon.id);
  }
  expect(seen).toEqual(["ar", "smg", "shotgun", "pistol"]);
});

test("the weapon viewmodel is on screen", async ({ page }) => {
  await bootGame(page);
  await page.waitForTimeout(700);
  const position = await page.evaluate(() => window.__shootout.weaponScreenPosition());
  expect(position).not.toBeNull();
  // Comfortably inside the viewport, not clipped against an edge.
  expect(position!.x).toBeGreaterThan(0.05);
  expect(position!.x).toBeLessThan(0.95);
  expect(position!.y).toBeGreaterThan(0.05);
  expect(position!.y).toBeLessThan(0.95);
});

test("the weapon stays below the crosshair through a burst", async ({ page }) => {
  /*
   * Recoil degrades a player's aim; it must never degrade their vision. The
   * pose maths is pinned by unit tests, but only this says the weapon on the
   * real screen stays out of the way of what the player is shooting at — and
   * that it is on the screen at all, which a single stray NaN is enough to
   * undo without raising an error.
   */
  await bootGame(page);
  await button(page, "btn-aim", true);
  await button(page, "btn-aim", false);
  await page.waitForTimeout(600);

  const resting = await page.evaluate(() => window.__shootout.weaponScreenPosition());
  expect(resting).not.toBeNull();
  expect(Number.isFinite(resting!.y)).toBe(true);
  // Centred left to right, because aiming lines the sight up with the middle.
  expect(resting!.x).toBeCloseTo(0.5, 1);

  await button(page, "btn-fire", true);
  for (let i = 0; i < 8; i += 1) {
    await page.waitForTimeout(120);
    const position = await page.evaluate(() => window.__shootout.weaponScreenPosition());
    // Well into the lower half of the screen, every frame of the burst.
    expect(position!.y).toBeGreaterThan(0.6);
  }
  await button(page, "btn-fire", false);
});

test("the navigation grid is built from the level", async ({ page }) => {
  await bootGame(page);
  const nav = await page.evaluate(() => window.__shootout.nav);
  // Thousands of walkable nodes across a forty metre map, not a handful.
  expect(nav.nodes).toBeGreaterThan(1500);
  expect(nav.nodes).toBeLessThan(nav.cells * 2);
  // Baking must not stall the load; this is a one-off cost at startup.
  expect(nav.millis).toBeLessThan(4000);
});

test("bots stand on the floor, not on the roof", async ({ page }) => {
  await bootGame(page);
  await page.waitForTimeout(2500);
  const bots = await page.evaluate(() => window.__shootout.bots);
  expect(bots.length).toBeGreaterThan(0);
  for (const bot of bots) {
    /*
     * Boulevard Works is three storeys with a bridge across the street at
     * the second floor, and bots spawn and fight on all of them. What must
     * not happen is a bot on the roof, which is where a navigation bake
     * that sampled the wrong surface would put them.
     *
     * The bound used to be four metres, with a note about a mezzanine "at
     * about three metres" — the highest walkable surface of a hall this
     * level replaced two maps ago. It only kept passing because every
     * spawn was on the ground and bots rarely climbed inside the window
     * this test watches.
     */
    expect(bot.position.y).toBeGreaterThanOrEqual(-0.5);
    expect(bot.position.y).toBeLessThan(9.6);
  }
});

test("both teams are fielded and the round starts", async ({ page }) => {
  await bootGame(page);
  const bots = await page.evaluate(() => window.__shootout.bots);
  expect(bots.some((bot) => bot.team === "a")).toBe(true);
  expect(bots.some((bot) => bot.team === "b")).toBe(true);

  await page.waitForFunction(() => window.__shootout.match.phase === "active", null, {
    timeout: 30_000,
  });
  const match = await page.evaluate(() => window.__shootout.match);
  expect(match.phase).toBe("active");
  expect(match.timeRemaining).toBeGreaterThan(0);
});

test("bots patrol away from where they spawned", async ({ page }) => {
  test.setTimeout(90_000);
  await bootGame(page);
  const before = await page.evaluate(() => window.__shootout.bots);
  // Waited for rather than slept through: a bot covers the same ground on a
  // slow machine as on a fast one, it just takes more of the wall clock.
  await page.waitForFunction(
    (start: { x: number; z: number }[]) =>
      window.__shootout.bots.some((bot, index) => {
        const from = start[index];
        return (
          from && Math.hypot(bot.position.x - from.x, bot.position.z - from.z) > 1
        );
      }),
    before.map((bot) => ({ x: bot.position.x, z: bot.position.z })),
    { timeout: 45_000 },
  );
});

test("bots fight each other and the score moves", async ({ page }) => {
  test.setTimeout(150_000);
  await bootGame(page);
  // Long enough for two sides to find each other across the level. The wait
  // is on the score rather than on a stopwatch, because how much of the
  // match runs in a minute depends on how fast the machine draws it.
  await page.waitForFunction(
    () => {
      const match = window.__shootout.match;
      return match.scores.a + match.scores.b > 0 && match.feed > 0;
    },
    null,
    { timeout: 120_000 },
  );
});

test("settings persist across a reload", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__shootout?.ready === true, null, { timeout: 30_000 });
  await page.getByRole("button", { name: "SETTINGS" }).click();

  const slider = page.locator("#set-touch");
  await slider.fill("2.4");
  await slider.dispatchEvent("input");
  await page.getByRole("button", { name: "DONE" }).click();

  await page.reload();
  await page.waitForFunction(() => window.__shootout?.ready === true, null, { timeout: 30_000 });
  const settings = await page.evaluate(() => window.__shootout.settings);
  expect(settings.touchSensitivity).toBeCloseTo(2.4, 2);
});

test("the lobby leads to a match and the round can be ended", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => window.__shootout?.ready === true, null, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__shootout.screen)).toBe("lobby");

  await page.getByRole("button", { name: "DEPLOY" }).click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__shootout.screen)).toBe("game");
});

test("a service worker is registered for offline play", async ({ page }) => {
  await bootGame(page);
  const registered = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration();
    return registration !== undefined;
  });
  expect(registered).toBe(true);
});


/** Put the lobby into online mode before the page boots. */
const useServer = async (page: Page, name: string): Promise<void> => {
  await page.addInitScript((playerName) => {
    localStorage.setItem(
      "shootout.settings.v1",
      JSON.stringify({
        online: true,
        serverUrl: "ws://127.0.0.1:8080",
        playerName,
        audioEnabled: false,
      }),
    );
  }, name);
};

const joinServer = async (page: Page, name: string): Promise<void> => {
  await useServer(page, name);
  await page.goto("/");
  await page.waitForFunction(() => window.__shootout?.ready === true, null, {
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "DEPLOY" }).click();
  await page.waitForFunction(() => window.__shootout.net.online === true, null, {
    timeout: 20_000,
  });
  // A round on the server ends when its clock runs out, and the next one is
  // started by the first player to be standing there when it does -- so a
  // client arriving in the gap between two rounds has to wait for one. That
  // gap is a handful of seconds and it is the server working as intended,
  // not a client that failed to join.
  await page.waitForFunction(() => window.__shootout.net.phase === "active", null, {
    timeout: 30_000,
  });
};

test.describe("online play", () => {
  test("connects to the server and joins a live round", async ({ page }) => {
    await joinServer(page, "Solo");
    await page.waitForTimeout(2500);
    const net = await page.evaluate(() => window.__shootout.net);
    expect(net.state).toBe("connected");
    expect(net.id).not.toBeNull();
    expect(net.phase).toBe("active");
    // The server fills the empty slots with bots, so there is someone to see.
    expect(net.remotes).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__shootout.screen)).toBe("game");
  });

  test("the server's clock drives the match bar", async ({ page }) => {
    await joinServer(page, "Clock");
    const first = await page.evaluate(() => window.__shootout.match.timeRemaining);
    // Waited on rather than slept through, so a slow client is not read as a
    // stopped clock.
    await page.waitForFunction(
      (from) => window.__shootout.match.timeRemaining < from,
      first,
      { timeout: 20_000 },
    );
  });

  test("prediction moves the player without waiting for the server", async ({ page }) => {
    await joinServer(page, "Mover");
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => ({ ...window.__shootout.position }));

    await page.keyboard.down("w");
    // Far less than a round trip's worth of simulation, so only prediction
    // can have moved anything. Counted in ticks the client has run rather
    // than in wall-clock: a machine drawing five frames a second has not
    // simulated a quarter of a second of anything in a quarter of a second.
    const startTick = await page.evaluate(() => window.__shootout.net.tick);
    await page.waitForFunction(
      (from) => window.__shootout.net.tick > from + 12,
      startTick,
      { timeout: 20_000 },
    );
    const during = await page.evaluate(() => ({ ...window.__shootout.position }));
    await page.keyboard.up("w");

    const moved = Math.hypot(during.x - before.x, during.z - before.z);
    expect(moved).toBeGreaterThan(0.3);
  });

  test("the prediction holds up over a longer run", async ({ page }) => {
    await joinServer(page, "Runner");
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => ({ ...window.__shootout.position }));

    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    // Run until real ground has been covered rather than for a set stretch
    // of the clock, then hold still long enough for the server's own answer
    // to arrive and be reconciled against.
    await page.waitForFunction(
      ([x, z]) =>
        Math.hypot(window.__shootout.position.x - x, window.__shootout.position.z - z) > 3,
      [before.x, before.z] as const,
      { timeout: 25_000 },
    );
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    await page.waitForTimeout(900);

    const after = await page.evaluate(() => ({ ...window.__shootout.position }));
    const travelled = Math.hypot(after.x - before.x, after.z - before.z);
    // The ground covered has to still be there: the reconciliation must not
    // have dragged the player back to where they started.
    expect(travelled).toBeGreaterThan(2);
    // Still inside the level, so the server did not let it through a wall.
    expect(Math.abs(after.x)).toBeLessThan(34);
    expect(Math.abs(after.z)).toBeLessThan(26);
  });

  test("a networked player moves at the speed the simulation says", async ({ page }) => {
    await joinServer(page, "Pace");
    await page.waitForTimeout(1500);

    await page.keyboard.down("w");
    await page.keyboard.down("Shift");
    // Read the speed itself rather than measuring distance, which would depend
    // on there being an empty lane in front of wherever the round spawned us.
    await page.waitForFunction(() => window.__shootout.speed > 1, null, { timeout: 15_000 });
    await page.waitForTimeout(500);
    const speed = await page.evaluate(() => window.__shootout.speed);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");

    // Sprint is 6.5 metres per second. A server that simulated each client
    // command for its own tick length instead of the span the command covers
    // would run a sixty-frame client at roughly double this.
    expect(speed).toBeGreaterThan(2);
    expect(speed).toBeLessThan(9);
  });

  test("two clients see each other", async ({ browser }) => {
    test.setTimeout(90_000);
    const alphaContext = await browser.newContext();
    const bravoContext = await browser.newContext();
    const alpha = await alphaContext.newPage();
    const bravo = await bravoContext.newPage();

    await joinServer(alpha, "Alpha");
    await joinServer(bravo, "Bravo");
    await alpha.waitForTimeout(3000);

    const alphaNet = await alpha.evaluate(() => window.__shootout.net);
    const bravoNet = await bravo.evaluate(() => window.__shootout.net);
    expect(alphaNet.id).not.toBe(bravoNet.id);
    // Each sees the other plus whatever bots fill the round out.
    expect(alphaNet.remotes).toBeGreaterThanOrEqual(1);
    expect(bravoNet.remotes).toBeGreaterThanOrEqual(1);

    await alphaContext.close();
    await bravoContext.close();
  });

  test("an unreachable server reports back instead of hanging", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "shootout.settings.v1",
        JSON.stringify({
          online: true,
          serverUrl: "ws://127.0.0.1:9",
          playerName: "Nobody",
          audioEnabled: false,
        }),
      );
    });
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "DEPLOY" }).click();
    await page.waitForTimeout(4000);
    // Back in the lobby with an explanation, rather than a blank screen.
    expect(await page.evaluate(() => window.__shootout.screen)).toBe("lobby");
    await expect(page.locator("#net-status")).toHaveClass(/is-error/);
  });
});


test.describe("maps and progression", () => {
  test("the lobby names the level and describes it", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    const names = await page
      .locator("#pick-map button")
      .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ""));
    expect(names).toContain("Boulevard Works");
    await expect(page.locator("#map-tagline")).not.toBeEmpty();
    // One level, so the row offering a choice of one is not shown.
    await expect(page.locator("#pick-map").locator("xpath=ancestor::div[contains(@class,'lobby-row')]"))
      .toBeHidden();
  });

  test("the lobby has no finish picker", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    await expect(page.locator("#pick-finish")).toHaveCount(0);
  });

  test("the ruined plant loads, with three floors of navigation", async ({ page }) => {
    /*
     * Boulevard Works is several times the geometry of either hall, stacked
     * three high, with a bridge in the air. It has to load in the same blink
     * on a phone, and its bots have to stay off the roofs.
     */
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        "shootout.settings.v1",
        JSON.stringify({ mapId: "boulevard", online: false, audioEnabled: false }),
      );
    });
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "DEPLOY" }).click();
    await page.waitForTimeout(3000);

    expect(await page.evaluate(() => window.__shootout.map.id)).toBe("boulevard");
    const nav = await page.evaluate(() => window.__shootout.nav);
    expect(nav.nodes).toBeGreaterThan(8000);
    expect(nav.millis).toBeLessThan(1500);

    const bots = await page.evaluate(() => window.__shootout.bots);
    expect(bots.length).toBeGreaterThan(0);
    for (const bot of bots) expect(bot.position.y).toBeLessThan(9.6);
    expect(errors).toEqual([]);
  });

  test("a new player carries two weapons, not four", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    const profile = await page.evaluate(() => window.__shootout.profile);
    expect(profile.level).toBe(1);
    expect(profile.carried).toEqual(["ar", "pistol"]);
  });

  test("a levelled profile unlocks the rest of the rack", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "shootout.profile.v1",
        JSON.stringify({ level: 8, xp: 100, kills: 90, deaths: 40, matches: 6 }),
      );
    });
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });

    expect(await page.evaluate(() => window.__shootout.profile.carried)).toHaveLength(4);
    await expect(page.locator("#career-level")).toHaveText("8");
  });
});

test.describe("zombie survival", () => {
  /** Boot straight into survival from a saved setting, and wait for the run. */
  const bootSurvival = async (page: Page): Promise<void> => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "shootout.settings.v1",
        JSON.stringify({ mode: "survival", online: false, audioEnabled: false }),
      );
    });
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "DEPLOY" }).click();
    await page.waitForFunction(
      () => window.__shootout.screen === "game" && window.__shootout.survival !== null,
      null,
      { timeout: 40_000 },
    );
  };

  /** Call the first wave in and wait for the dead to arrive. */
  const callWave = async (page: Page, count = 1): Promise<void> => {
    await page.evaluate(() => window.__shootout.callWave());
    await page.waitForFunction(
      (count) => (window.__shootout.survival?.zombies.length ?? 0) >= count,
      count,
      { timeout: 60_000 },
    );
  };

  /** Stand four metres from the nearest zombie, looking at its chest. */
  const faceNearestZombie = (page: Page, distance: number): Promise<boolean> =>
    page.evaluate((distance) => {
      const game = window.__shootout;
      const living = game.survival?.zombies.filter((zombie) => !zombie.dead) ?? [];
      if (living.length === 0) return false;
      const here = game.position;
      living.sort(
        (a, b) =>
          Math.hypot(a.position.x - here.x, a.position.z - here.z) -
          Math.hypot(b.position.x - here.x, b.position.z - here.z),
      );
      const target = living[0].position;
      const dx = here.x - target.x;
      const dz = here.z - target.z;
      const length = Math.hypot(dx, dz) || 1;
      const x = target.x + (dx / length) * distance;
      const z = target.z + (dz / length) * distance;
      const yaw = Math.atan2(target.x - x, target.z - z);
      // From an eye about 1.6 m up to a chest about 1.1 m up.
      const pitch = Math.atan2(1.1 - 1.6, distance);
      game.teleport(x, z, yaw, target.y, pitch);
      return true;
    }, distance);

  test("the lobby offers survival and puts the bot rows away", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    const difficultyRow = page
      .locator("#pick-difficulty")
      .locator("xpath=ancestor::div[contains(@class,'lobby-row')]");
    await expect(difficultyRow).toBeVisible();
    await page.getByRole("button", { name: "Zombie survival" }).click();
    await expect(difficultyRow).toBeHidden();
    await expect(page.locator("#map-tagline")).toContainText("coming from all of them");
    expect(await page.evaluate(() => window.__shootout.settings.mode)).toBe("survival");
    await page.getByRole("button", { name: "Team deathmatch" }).click();
    await expect(difficultyRow).toBeVisible();
  });

  test("survival opens the streets and sends the dead in", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await bootSurvival(page);

    expect(await page.evaluate(() => window.__shootout.map.id)).toBe("boulevard-survival");
    expect(await page.evaluate(() => window.__shootout.bots)).toHaveLength(0);
    const nav = await page.evaluate(() => window.__shootout.nav);
    expect(nav.nodes).toBeGreaterThan(40_000);
    await expect(page.locator("#tag-a")).toHaveText("WAVE");
    await expect(page.locator("#tag-b")).toHaveText("LEFT");

    await callWave(page);
    const run = await page.evaluate(() => window.__shootout.survival!);
    expect(run.phase).toBe("wave");
    expect(run.left).toBeGreaterThan(0);

    // The fence across the street's north end is gone: walk out through it.
    await page.evaluate(() => {
      window.__shootout.invulnerable = true;
      window.__shootout.teleport(0, 18, 0, 0, 0);
    });
    await page.keyboard.down("KeyW");
    await page
      .waitForFunction(() => window.__shootout.position.z > 30, null, { timeout: 45_000 })
      .finally(() => page.keyboard.up("KeyW"));
    // And the south end.
    await page.evaluate(() => window.__shootout.teleport(0, -18, Math.PI, 0, 0));
    await page.keyboard.down("KeyW");
    await page
      .waitForFunction(() => window.__shootout.position.z < -30, null, { timeout: 45_000 })
      .finally(() => page.keyboard.up("KeyW"));
    expect(errors).toEqual([]);
  });

  test("a zombie can be shot down", async ({ page }) => {
    await bootSurvival(page);
    await page.evaluate(() => {
      window.__shootout.invulnerable = true;
    });
    await callWave(page);

    // They keep walking, so aim again between bursts.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const kills = await page.evaluate(() => window.__shootout.survival!.kills);
      if (kills > 0) break;
      await faceNearestZombie(page, 4);
      await button(page, "btn-fire", true);
      await page.waitForTimeout(600);
      await button(page, "btn-fire", false);
      await page.waitForTimeout(200);
    }
    expect(await page.evaluate(() => window.__shootout.survival!.kills)).toBeGreaterThan(0);
  });

  test("the dead hit back, and falling ends the run on its results", async ({ page }) => {
    test.setTimeout(150_000);
    await bootSurvival(page);
    await callWave(page);
    // Stand in reach and let them come.
    await faceNearestZombie(page, 0.9);
    await page.waitForFunction(() => window.__shootout.health < 100, null, { timeout: 60_000 });
    await page.waitForFunction(
      () => {
        const game = window.__shootout;
        if (game.screen === "scoreboard") return true;
        // Keep the nearest one close until it is over.
        const living = game.survival?.zombies.filter((zombie) => !zombie.dead) ?? [];
        const here = game.position;
        const near = living.some(
          (zombie) => Math.hypot(zombie.position.x - here.x, zombie.position.z - here.z) < 1.3,
        );
        if (!near && living[0]) {
          const at = living[0].position;
          game.teleport(at.x + 0.9, at.z, -Math.PI / 2, at.y, 0);
        }
        return false;
      },
      null,
      { timeout: 120_000, polling: 500 },
    );
    await expect(page.locator("#result-title")).toContainText("FELL ON WAVE 1");
    await expect(page.locator("#label-kills")).toHaveText("Wave");
    await expect(page.locator("#rewards")).toContainText("Round played");
  });
});
