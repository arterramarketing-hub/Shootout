import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "off",
    launchOptions: {
      // Use the browser already present in the container rather than
      // downloading one. Override with CHROMIUM_PATH if it moves.
      executablePath:
        process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
      // Headless Chromium has no GPU, so WebGL runs on the software
      // rasteriser. That is enough to prove the scene builds and draws.
      args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7 landscape"] } },
  ],
  webServer: [
    {
      command: "npm run preview -- --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // The authoritative game server, so the online tests have something to
      // connect to. It speaks websocket, so it is waited on by port.
      command: "node dist-server/server.mjs",
      port: 8080,
      env: { PORT: "8080", TEAM_SIZE: "2" },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
