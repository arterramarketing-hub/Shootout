import type { ProgressionState } from "./progression";

/**
 * Weapon finishes.
 *
 * Finishes change three colours on the viewmodel and nothing else. That is the
 * whole design: there is no finish that shoots straighter, holds more rounds
 * or reloads faster, so nothing here can be sold that would affect a match.
 */
export interface Finish {
  id: string;
  name: string;
  /** Body, metalwork and furniture colours. */
  body: string;
  metal: string;
  accent: string;
  /** How it becomes available. */
  source: FinishSource;
}

export type FinishSource =
  /** Everyone has it from the start. */
  | { kind: "default" }
  /** Granted on reaching a level. */
  | { kind: "level"; level: number }
  /** Granted by an entitlement, if the player has one. */
  | { kind: "entitlement" };

export const FINISHES: Finish[] = [
  {
    id: "issue",
    name: "Standard Issue",
    body: "#33383f",
    metal: "#23272c",
    accent: "#4a3e31",
    source: { kind: "default" },
  },
  {
    id: "sand",
    name: "Desert Sand",
    body: "#8a7a5e",
    metal: "#4c463a",
    accent: "#5e5241",
    source: { kind: "level", level: 2 },
  },
  {
    id: "slate",
    name: "Slate",
    body: "#4a525c",
    metal: "#2b3138",
    accent: "#39414a",
    source: { kind: "level", level: 4 },
  },
  {
    id: "woodland",
    name: "Woodland",
    body: "#4a5540",
    metal: "#2c3228",
    accent: "#5a4c36",
    source: { kind: "level", level: 7 },
  },
  {
    id: "arctic",
    name: "Arctic",
    body: "#b8bfc6",
    metal: "#6d757e",
    accent: "#8f979f",
    source: { kind: "level", level: 11 },
  },
  {
    id: "ember",
    name: "Ember",
    body: "#6d3a2a",
    metal: "#39241d",
    accent: "#a2512c",
    source: { kind: "level", level: 16 },
  },
  {
    id: "verdigris",
    name: "Verdigris",
    body: "#3f6155",
    metal: "#26372f",
    accent: "#5f8a74",
    source: { kind: "entitlement" },
  },
];

export const DEFAULT_FINISH = FINISHES[0];

export const finishById = (id: string | undefined): Finish =>
  FINISHES.find((finish) => finish.id === id) ?? DEFAULT_FINISH;

/**
 * Where entitlements come from.
 *
 * This is the seam a storefront would sit behind, and nothing more. The game
 * ships with the local provider below, which grants only what the player has
 * already been given; there is no purchase path, no currency and no prompt.
 * Anything plugged in here can still only unlock a set of colours, because
 * that is all a finish is.
 */
export interface EntitlementProvider {
  /** Ids this player is entitled to, beyond what levelling grants. */
  entitlements(): readonly string[];
}

/** The shipped provider: whatever the profile already records, and no more. */
export const localEntitlements = (state: ProgressionState): EntitlementProvider => ({
  entitlements: () => state.owned,
});

export const isFinishUnlocked = (
  finish: Finish,
  state: ProgressionState,
  provider: EntitlementProvider = localEntitlements(state),
): boolean => {
  switch (finish.source.kind) {
    case "default":
      return true;
    case "level":
      return state.level >= finish.source.level;
    case "entitlement":
      return provider.entitlements().includes(finish.id);
  }
};

export const unlockedFinishes = (
  state: ProgressionState,
  provider: EntitlementProvider = localEntitlements(state),
): Finish[] => FINISHES.filter((finish) => isFinishUnlocked(finish, state, provider));

/** How a locked finish is described in the interface. */
export const finishRequirement = (finish: Finish): string => {
  switch (finish.source.kind) {
    case "default":
      return "Available";
    case "level":
      return `Level ${finish.source.level}`;
    case "entitlement":
      return "Not available";
  }
};

/** Finishes unlocked by reaching exactly this level. */
export const finishesForLevel = (level: number): Finish[] =>
  FINISHES.filter((finish) => finish.source.kind === "level" && finish.source.level === level);
