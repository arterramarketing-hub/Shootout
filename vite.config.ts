import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("@babylonjs")) return "babylon";
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
