import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearProfile, loadProfile, saveProfile } from "../src/engine/profile";
import { MAX_LEVEL, createProgression } from "../src/sim/progression";
import { FINISHES } from "../src/sim/cosmetics";

const STORAGE_KEY = "shootout.profile.v1";

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
        removeItem: () => {
          throw new Error("blocked");
        },
      } as unknown as Storage),
  });
};

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("profile storage", () => {
  it("starts fresh when nothing is stored", () => {
    install(makeStorage());
    expect(loadProfile()).toEqual(createProgression());
  });

  it("round-trips a profile", () => {
    install(makeStorage());
    const profile = createProgression();
    profile.level = 9;
    profile.kills = 240;
    profile.equipped.ar = FINISHES[1].id;
    saveProfile(profile);
    expect(loadProfile()).toEqual(profile);
  });

  it("survives corrupted storage", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, "{broken");
    install(storage);
    expect(loadProfile()).toEqual(createProgression());
  });

  it("survives storage that throws outright", () => {
    install(null);
    expect(loadProfile()).toEqual(createProgression());
    expect(() => saveProfile(createProgression())).not.toThrow();
    expect(() => clearProfile()).not.toThrow();
  });

  it("clamps a level someone tampered with", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ level: 9999, kills: -5 }));
    install(storage);
    const loaded = loadProfile();
    expect(loaded.level).toBe(MAX_LEVEL);
    expect(loaded.kills).toBe(0);
  });

  it("drops cosmetic ids that no longer exist", () => {
    const storage = makeStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ owned: ["retired-finish", FINISHES[0].id], equipped: { ar: "gone" } }),
    );
    install(storage);
    const loaded = loadProfile();
    expect(loaded.owned).toEqual([FINISHES[0].id]);
    expect(loaded.equipped.ar).toBeUndefined();
  });

  it("forgets the profile on request", () => {
    const storage = makeStorage();
    install(storage);
    const profile = createProgression();
    profile.level = 5;
    saveProfile(profile);
    clearProfile();
    expect(loadProfile()).toEqual(createProgression());
  });
});
