import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../src/engine/settings";

const STORAGE_KEY = "shootout.settings.v1";

/** A minimal in-memory stand-in for the browser's storage. */
const makeStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
};

const install = (storage: Storage | null) => {
  vi.stubGlobal("window", {
    localStorage:
      storage ??
      ({
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage),
  });
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("loadSettings", () => {
  it("returns the defaults when nothing is stored", () => {
    install(makeStorage());
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips what was saved", () => {
    const storage = makeStorage();
    install(storage);
    const wanted = { ...DEFAULT_SETTINGS, touchSensitivity: 1.8, invertY: true, teamSize: 2 };
    saveSettings(wanted);
    expect(loadSettings()).toEqual(wanted);
  });

  it("survives corrupted storage", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    install(storage);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("survives storage that throws outright", () => {
    install(null);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    // Saving must not throw either.
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow();
  });

  it("clamps values that are out of range", () => {
    const storage = makeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ touchSensitivity: 999, fovDegrees: -40, hudScale: 50 }),
    );
    install(storage);
    const loaded = loadSettings();
    expect(loaded.touchSensitivity).toBeLessThanOrEqual(3);
    expect(loaded.fovDegrees).toBeGreaterThanOrEqual(65);
    expect(loaded.hudScale).toBeLessThanOrEqual(1.4);
  });

  it("replaces values of the wrong type", () => {
    const storage = makeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ invertY: "yes", difficulty: "impossible", quality: "ultra" }),
    );
    install(storage);
    const loaded = loadSettings();
    expect(loaded.invertY).toBe(DEFAULT_SETTINGS.invertY);
    expect(loaded.difficulty).toBe(DEFAULT_SETTINGS.difficulty);
    expect(loaded.quality).toBe(DEFAULT_SETTINGS.quality);
  });

  it("keeps the team size a whole number", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ teamSize: 3.7 }));
    install(storage);
    expect(Number.isInteger(loadSettings().teamSize)).toBe(true);
  });
});
