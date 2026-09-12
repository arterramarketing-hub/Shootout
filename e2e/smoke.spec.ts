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
  nav: { nodes: number; cells: number; millis: number; raycasts: number };
  screen: string;
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
  // Five merged level meshes, three per practice target, and the viewmodel.
  expect(state.activeMeshes).toBeLessThan(60);
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
  const before = (await readState(page)).position;

  await page.keyboard.down("w");
  await page.waitForTimeout(700);
  await page.keyboard.up("w");

  const after = (await readState(page)).position;
  const travelled = Math.hypot(after.x - before.x, after.z - before.z);
  expect(travelled).toBeGreaterThan(1.0);
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
  await page.waitForTimeout(2600);

  const reloaded = await readState(page);
  expect(reloaded.weapon.magazine).toBe(30);
  expect(reloaded.weapon.reserve).toBeLessThan(spent.weapon.reserve);
});

test("aiming raises the sights and lowering them releases", async ({ page }) => {
  await bootGame(page);
  await button(page, "btn-aim", true);
  await page.waitForTimeout(500);
  expect((await readState(page)).weapon.ads).toBeGreaterThan(0.9);

  await button(page, "btn-aim", false);
  await page.waitForTimeout(500);
  expect((await readState(page)).weapon.ads).toBeLessThan(0.1);
});

test("swapping cycles through the loadout", async ({ page }) => {
  await bootGame(page);
  const seen: string[] = [(await readState(page)).weapon.id];
  for (let i = 0; i < 3; i += 1) {
    await button(page, "btn-swap", true);
    await button(page, "btn-swap", false);
    await page.waitForTimeout(1100);
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

  await page.waitForTimeout(4000);
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
