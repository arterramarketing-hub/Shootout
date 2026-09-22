import type { Team } from "./bots";

export type MatchPhase = "lobby" | "countdown" | "active" | "over";

export interface MatchConfig {
  /** Kills that end the match early. */
  scoreLimit: number;
  /** Round length in seconds. */
  durationSeconds: number;
  /** Seconds before a downed combatant returns. */
  respawnSeconds: number;
  /** Bots per team, excluding the player. */
  teamSize: number;
  /** Seconds of countdown before the round starts. */
  countdownSeconds: number;
  /**
   * Whether a round that lands on a team-mate hurts them.
   *
   * On. A stray burst into your own side costs the side a point and the
   * team-mate their health, which is what makes a lane with a friend in it
   * a lane to hold fire on. Bots never aim at their own side, and a shot
   * they take is blocked by anybody standing in it, so what friendly fire
   * costs a bot team is only what its own carelessness would.
   */
  friendlyFire: boolean;
}

export const DEFAULT_MATCH: MatchConfig = {
  scoreLimit: 50,
  durationSeconds: 360,
  respawnSeconds: 4,
  teamSize: 5,
  countdownSeconds: 3,
  friendlyFire: true,
};

/**
 * Whether a hit from one side on another does anything.
 *
 * One rule, shared by the local match and the server, so a round that hurts
 * a team-mate offline hurts them online too.
 */
export const damageAllowed = (friendlyFire: boolean, attacker: Team, victim: Team): boolean =>
  friendlyFire || attacker !== victim;

export interface KillEvent {
  killerName: string;
  killerTeam: Team;
  victimName: string;
  victimTeam: Team;
  headshot: boolean;
  /** True when the player did the killing. */
  byPlayer: boolean;
  /** True when the player was killed. */
  againstPlayer: boolean;
}

export interface MatchState {
  config: MatchConfig;
  phase: MatchPhase;
  /** Seconds left in the round, or in the countdown. */
  timeRemaining: number;
  countdown: number;
  scores: Record<Team, number>;
  /** Kills the player scored, and how they died. */
  playerKills: number;
  playerDeaths: number;
  playerHeadshots: number;
  /** Newest first, capped. */
  feed: KillEvent[];
  winner: Team | "draw" | null;
}

export const createMatch = (config: MatchConfig = DEFAULT_MATCH): MatchState => ({
  config,
  phase: "lobby",
  timeRemaining: config.durationSeconds,
  countdown: config.countdownSeconds,
  scores: { a: 0, b: 0 },
  playerKills: 0,
  playerDeaths: 0,
  playerHeadshots: 0,
  feed: [],
  winner: null,
});

export const startMatch = (match: MatchState): void => {
  match.phase = "countdown";
  match.countdown = match.config.countdownSeconds;
  match.timeRemaining = match.config.durationSeconds;
  match.scores.a = 0;
  match.scores.b = 0;
  match.playerKills = 0;
  match.playerDeaths = 0;
  match.playerHeadshots = 0;
  match.feed = [];
  match.winner = null;
};

export const recordKill = (match: MatchState, event: KillEvent): void => {
  if (match.phase !== "active") return;

  // A kill counts for the killer's team. Killing a team-mate takes one off
  // instead, so a stray burst into your own side is never a free point.
  if (event.killerTeam === event.victimTeam) {
    match.scores[event.killerTeam] = Math.max(0, match.scores[event.killerTeam] - 1);
  } else {
    match.scores[event.killerTeam] += 1;
  }

  if (event.byPlayer && event.killerTeam !== event.victimTeam) {
    match.playerKills += 1;
    if (event.headshot) match.playerHeadshots += 1;
  }
  if (event.againstPlayer) match.playerDeaths += 1;

  match.feed.unshift(event);
  if (match.feed.length > 6) match.feed.length = 6;

  if (match.scores[event.killerTeam] >= match.config.scoreLimit) {
    finishMatch(match);
  }
};

export const stepMatch = (match: MatchState, dt: number): void => {
  if (match.phase === "countdown") {
    match.countdown -= dt;
    if (match.countdown <= 0) {
      match.countdown = 0;
      match.phase = "active";
    }
    return;
  }
  if (match.phase !== "active") return;

  match.timeRemaining = Math.max(0, match.timeRemaining - dt);
  if (match.timeRemaining <= 0) finishMatch(match);
};

export const finishMatch = (match: MatchState): void => {
  match.phase = "over";
  match.winner =
    match.scores.a === match.scores.b ? "draw" : match.scores.a > match.scores.b ? "a" : "b";
};

/** Round time as mm:ss. */
export const formatClock = (seconds: number): string => {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
};

export const describeKill = (event: KillEvent): string => {
  const verb = event.headshot ? "headshot" : "killed";
  return `${event.killerName} ${verb} ${event.victimName}`;
};
