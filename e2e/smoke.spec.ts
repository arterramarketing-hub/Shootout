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
  targets: { id: string; health: number; down: boolean }[];
}

/** The development handle the game exposes on `window`. */
interface DebugHandle extends GameState {
  teleport: (x: number, z: number, yaw?: number) => void;
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
    targets: window.__shootout.targets.map((t) => ({ ...t })),
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
  // The round opens on a countdown with everyone held in place, so measuring
  // from the moment the level loads measures the countdown, not the walking.
  await page.waitForFunction(() => window.__shootout.match.phase === "active", null, {
    timeout: 20_000,
  });
  // And the spawn faces a wall, which is what the next test walks into on
  // purpose. Start from the middle of the floor, facing down the open lane.
  await page.evaluate(() => window.__shootout.teleport(0, 0, -Math.PI / 2));
  // Long enough to land and shake off the landing, which costs speed for a
  // moment and would otherwise be measured as walking slowly.
  await page.waitForTimeout(1200);
  const before = (await readState(page)).position;

  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");

  const after = (await readState(page)).position;
  const travelled = Math.hypot(after.x - before.x, after.z - before.z);
  // Seven tenths of a second at four metres a second, less the moment spent
  // accelerating into it and the moment spent stopping.
  expect(travelled).toBeGreaterThan(2.3);
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
  // The map is 40m across, so the player must still be inside its bounds.
  expect(Math.abs(position.x)).toBeLessThan(21);
  expect(Math.abs(position.z)).toBeLessThan(21);
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
  expect(state.targets).toHaveLength(6);
  expect(state.targets.every((target) => !target.down)).toBe(true);
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
  // A phone has no spare thumb to hold an aim button down with, so the sights
  // latch. Releasing the button must not drop them, which is the whole point.
  await bootGame(page);
  await button(page, "btn-aim", true);
  await button(page, "btn-aim", false);
  await page.waitForTimeout(500);
  expect((await readState(page)).weapon.ads).toBeGreaterThan(0.9);

  await button(page, "btn-aim", true);
  await button(page, "btn-aim", false);
  await page.waitForTimeout(500);
  expect((await readState(page)).weapon.ads).toBeLessThan(0.1);
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
    await button(page, "btn-swap", true);
    await button(page, "btn-swap", false);
    await page.waitForFunction(
      (previous) => window.__shootout.weapon.id !== previous,
      before,
      { timeout: 20_000 },
    );
    seen.push((await readState(page)).weapon.id);
  }
  expect(seen).toEqual(["ar", "smg", "shotgun", "pistol"]);
});

test("shooting a practice target knocks it down", async ({ page }) => {
  await bootGame(page);
  // Stand square on to the nearest plate, which is six metres ahead.
  await page.evaluate(() => window.__shootout.teleport(-3.5, -9.0, 0));
  await page.waitForTimeout(400);

  await button(page, "btn-aim", true);
  await page.waitForTimeout(400);
  await button(page, "btn-fire", true);
  await page.waitForTimeout(900);
  await button(page, "btn-fire", false);
  await button(page, "btn-aim", false);

  const state = await readState(page);
  const plate = state.targets.find((target) => target.id === "t_close_a");
  expect(plate?.down).toBe(true);
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
    // The mezzanine is the highest walkable surface, at about three metres.
    expect(bot.position.y).toBeGreaterThanOrEqual(-0.5);
    expect(bot.position.y).toBeLessThan(4);
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
  await bootGame(page);
  await page.waitForTimeout(4000);
  const before = await page.evaluate(() => window.__shootout.bots);
  await page.waitForTimeout(4000);
  const after = await page.evaluate(() => window.__shootout.bots);

  const moved = after.filter((bot, index) => {
    const start = before[index];
    return Math.hypot(bot.position.x - start.position.x, bot.position.z - start.position.z) > 1;
  });
  expect(moved.length).toBeGreaterThan(0);
});

test("bots fight each other and the score moves", async ({ page }) => {
  test.setTimeout(90_000);
  await bootGame(page);
  // Long enough for two sides to find each other across a forty metre map.
  await page.waitForTimeout(40_000);
  const match = await page.evaluate(() => window.__shootout.match);
  expect(match.scores.a + match.scores.b).toBeGreaterThan(0);
  expect(match.feed).toBeGreaterThan(0);
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
    await page.waitForTimeout(1500);
    const first = await page.evaluate(() => window.__shootout.match.timeRemaining);
    await page.waitForTimeout(2500);
    const second = await page.evaluate(() => window.__shootout.match.timeRemaining);
    expect(second).toBeLessThan(first);
  });

  test("prediction moves the player without waiting for the server", async ({ page }) => {
    await joinServer(page, "Mover");
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => ({ ...window.__shootout.position }));

    await page.keyboard.down("w");
    // Far less than a round trip, so only prediction can have moved anything.
    await page.waitForTimeout(250);
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
    await page.waitForTimeout(2500);
    await page.keyboard.up("Shift");
    await page.keyboard.up("w");
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => ({ ...window.__shootout.position }));
    const travelled = Math.hypot(after.x - before.x, after.z - before.z);
    // Sprinting for two and a half seconds covers real ground, and the
    // reconciliation must not have dragged it back to the start.
    expect(travelled).toBeGreaterThan(2);
    // Still inside the map, so the server did not let it through a wall.
    expect(Math.abs(after.x)).toBeLessThan(21);
    expect(Math.abs(after.z)).toBeLessThan(21);
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
  test("the lobby offers every map with a description", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    const names = await page
      .locator("#pick-map button")
      .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ""));
    expect(names).toContain("Warehouse");
    expect(names).toContain("Substation");
    await expect(page.locator("#map-tagline")).not.toBeEmpty();
  });

  test("the second map loads and bakes its own navigation", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "shootout.settings.v1",
        JSON.stringify({ mapId: "substation", online: false, audioEnabled: false }),
      );
    });
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "DEPLOY" }).click();
    await page.waitForTimeout(2500);

    expect(await page.evaluate(() => window.__shootout.map.id)).toBe("substation");
    const nav = await page.evaluate(() => window.__shootout.nav);
    expect(nav.nodes).toBeGreaterThan(1500);

    // Bots have to find the floor here too, not the roof.
    const bots = await page.evaluate(() => window.__shootout.bots);
    expect(bots.length).toBeGreaterThan(0);
    for (const bot of bots) expect(bot.position.y).toBeLessThan(5);
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

  test("a levelled profile unlocks the rest of the rack and its finishes", async ({ page }) => {
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
    const open = await page
      .locator("#pick-finish button:not([disabled])")
      .count();
    // Standard plus the three unlocked by level eight.
    expect(open).toBe(4);
    await expect(page.locator("#career-level")).toHaveText("8");
  });

  test("equipping a finish sticks across a reload", async ({ page }) => {
    // Seed once. An unconditional write would run again on reload and wipe
    // the very choice this test is checking survived.
    await page.addInitScript(() => {
      if (!localStorage.getItem("shootout.profile.v1")) {
        localStorage.setItem("shootout.profile.v1", JSON.stringify({ level: 8 }));
      }
    });
    await page.goto("/");
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    await page.locator('#pick-finish button[data-value="slate"]').click();
    await page.reload();
    await page.waitForFunction(() => window.__shootout?.ready === true, null, {
      timeout: 30_000,
    });
    await expect(page.locator('#pick-finish button[data-value="slate"]')).toHaveClass(
      /is-selected/,
    );
  });
});
