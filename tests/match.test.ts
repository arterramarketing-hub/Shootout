import { damageAllowed } from "../src/sim/match";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH,
  createMatch,
  describeKill,
  finishMatch,
  formatClock,
  recordKill,
  startMatch,
  stepMatch,
  type KillEvent,
  type MatchState,
} from "../src/sim/match";

const kill = (overrides: Partial<KillEvent> = {}): KillEvent => ({
  killerName: "Mercer",
  killerTeam: "a",
  victimName: "Odom",
  victimTeam: "b",
  headshot: false,
  byPlayer: false,
  againstPlayer: false,
  ...overrides,
});

const live = (): MatchState => {
  const match = createMatch();
  startMatch(match);
  stepMatch(match, match.config.countdownSeconds + 0.1);
  return match;
};

describe("formatClock", () => {
  it("formats minutes and seconds", () => {
    expect(formatClock(360)).toBe("6:00");
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(9)).toBe("0:09");
  });

  it("never goes negative", () => {
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("match lifecycle", () => {
  it("starts in the lobby", () => {
    expect(createMatch().phase).toBe("lobby");
  });

  it("counts down before going live", () => {
    const match = createMatch();
    startMatch(match);
    expect(match.phase).toBe("countdown");
    stepMatch(match, match.config.countdownSeconds - 0.1);
    expect(match.phase).toBe("countdown");
    stepMatch(match, 0.2);
    expect(match.phase).toBe("active");
  });

  it("does not run the round clock during the countdown", () => {
    const match = createMatch();
    startMatch(match);
    stepMatch(match, 1);
    expect(match.timeRemaining).toBe(match.config.durationSeconds);
  });

  it("ends when the clock runs out", () => {
    const match = live();
    stepMatch(match, match.config.durationSeconds + 1);
    expect(match.phase).toBe("over");
    expect(match.timeRemaining).toBe(0);
  });

  it("clears the previous result on restart", () => {
    const match = live();
    recordKill(match, kill());
    finishMatch(match);
    startMatch(match);
    expect(match.scores).toEqual({ a: 0, b: 0 });
    expect(match.feed).toHaveLength(0);
    expect(match.winner).toBeNull();
  });
});

describe("scoring", () => {
  it("credits the killer's team", () => {
    const match = live();
    recordKill(match, kill());
    expect(match.scores.a).toBe(1);
    expect(match.scores.b).toBe(0);
  });

  it("takes a point off for a team kill", () => {
    const match = live();
    recordKill(match, kill());
    recordKill(match, kill({ victimTeam: "a", victimName: "Vale" }));
    expect(match.scores.a).toBe(0);
  });

  it("never drives a score below zero", () => {
    const match = live();
    recordKill(match, kill({ victimTeam: "a" }));
    expect(match.scores.a).toBe(0);
  });

  it("tracks the player's own record", () => {
    const match = live();
    recordKill(match, kill({ byPlayer: true, headshot: true }));
    recordKill(match, kill({ againstPlayer: true, killerTeam: "b", victimTeam: "a" }));
    expect(match.playerKills).toBe(1);
    expect(match.playerHeadshots).toBe(1);
    expect(match.playerDeaths).toBe(1);
  });

  it("does not credit the player for a team kill", () => {
    const match = live();
    recordKill(match, kill({ byPlayer: true, victimTeam: "a" }));
    expect(match.playerKills).toBe(0);
  });

  it("ignores kills outside a live round", () => {
    const match = createMatch();
    recordKill(match, kill());
    expect(match.scores.a).toBe(0);
  });

  it("ends the round at the score limit", () => {
    const match = live();
    for (let i = 0; i < DEFAULT_MATCH.scoreLimit; i += 1) recordKill(match, kill());
    expect(match.phase).toBe("over");
    expect(match.winner).toBe("a");
  });

  it("calls a draw on level scores", () => {
    const match = live();
    recordKill(match, kill());
    recordKill(match, kill({ killerTeam: "b", victimTeam: "a" }));
    finishMatch(match);
    expect(match.winner).toBe("draw");
  });
});

describe("kill feed", () => {
  it("puts the newest entry first", () => {
    const match = live();
    recordKill(match, kill({ victimName: "First" }));
    recordKill(match, kill({ victimName: "Second" }));
    expect(match.feed[0].victimName).toBe("Second");
  });

  it("stays bounded", () => {
    const match = live();
    for (let i = 0; i < 30; i += 1) recordKill(match, kill({ victimName: `V${i}` }));
    expect(match.feed.length).toBeLessThanOrEqual(6);
  });

  it("reads as a sentence", () => {
    expect(describeKill(kill())).toBe("Mercer killed Odom");
    expect(describeKill(kill({ headshot: true }))).toBe("Mercer headshot Odom");
  });
});

describe("friendly fire", () => {
  it("is on by default", () => {
    expect(DEFAULT_MATCH.friendlyFire).toBe(true);
  });

  it("lets a round hurt a team-mate when it is on", () => {
    expect(damageAllowed(true, "a", "a")).toBe(true);
    expect(damageAllowed(true, "a", "b")).toBe(true);
  });

  it("spares a team-mate, and only a team-mate, when it is off", () => {
    expect(damageAllowed(false, "a", "a")).toBe(false);
    expect(damageAllowed(false, "b", "b")).toBe(false);
    expect(damageAllowed(false, "a", "b")).toBe(true);
  });
});
