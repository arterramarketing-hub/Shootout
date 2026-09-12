import { expect, test, type Page } from "@playwright/test";

interface DebugHandle {
  ready: boolean;
  fps: number;
  quality: string;
  activeMeshes: number;
  position: { x: number; y: number; z: number };
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
  await page.getByRole("button", { name: "TAP TO START" }).click();
  // Let the loop run long enough for the frame-rate meter to report.
  await page.waitForFunction(() => window.__shootout.fps > 0, null, { timeout: 20_000 });
};

const readState = (page: Page): Promise<DebugHandle> =>
  page.evaluate(() => ({
    ready: window.__shootout.ready,
    fps: window.__shootout.fps,
    quality: window.__shootout.quality,
    activeMeshes: window.__shootout.activeMeshes,
    position: { ...window.__shootout.position },
  }));

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
  expect(state.activeMeshes).toBeLessThan(20);
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
