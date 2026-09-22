import {
  SETTINGS_LIMITS,
  sanitisePlayerName,
  sanitiseServerUrl,
  type GameSettings,
} from "../engine/settings";
import { MAPS } from "../maps";

import type { MatchState } from "../sim/match";
import {
  MAX_LEVEL,
  WEAPON_UNLOCKS,
  levelProgress,
  nextUnlock,
  rewardBreakdown,
  rewardTotal,
  type LevelUpResult,
  type MatchReward,
  type ProgressionState,
} from "../sim/progression";
import { WEAPONS, type WeaponId } from "../sim/weapons";

export type ScreenName = "lobby" | "settings" | "scoreboard" | "game";

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element: ${id}`);
  return element as T;
};

/** Wire a row of buttons that behave as one exclusive choice. */
const segmented = (
  containerId: string,
  onPick: (value: string) => void,
): ((value: string) => void) => {
  const container = byId(containerId);
  const buttons = [...container.querySelectorAll<HTMLButtonElement>("button[data-value]")];
  const select = (value: string) => {
    for (const button of buttons) {
      button.classList.toggle("is-selected", button.dataset.value === value);
      button.setAttribute("aria-pressed", String(button.dataset.value === value));
    }
  };
  for (const button of buttons) {
    button.addEventListener("click", () => {
      const value = button.dataset.value;
      if (!value) return;
      select(value);
      onPick(value);
    });
  }
  return select;
};

export interface ScreenCallbacks {
  onStart: () => void;
  onPlayAgain: () => void;
  onReturnToLobby: () => void;
  onSettingsChanged: (settings: GameSettings) => void;
}

/**
 * The lobby, settings and end-of-round screens.
 *
 * Plain DOM over the canvas rather than in-scene UI: text drawn into a 3D
 * scene costs frame time and never matches the crispness a phone browser gives
 * for free, and these screens are shown while nothing is being rendered anyway.
 */
export class Screens {
  private current: ScreenName = "lobby";
  private readonly lobby = byId("boot");
  private readonly settingsPanel = byId("settings");
  private readonly scoreboard = byId("scoreboard");
  private readonly selectDifficulty: (value: string) => void;
  private readonly selectTeamSize: (value: string) => void;
  private readonly selectQuality: (value: string) => void;
  private readonly selectLook: (value: string) => void;
  private readonly selectOnline: (value: string) => void;
  private readonly selectMap: (value: string) => void;
  private readonly card = byId("boot").querySelector<HTMLElement>(".screen-card")!;
  private readonly netStatus = byId("net-status");

  constructor(
    private settings: GameSettings,
    private profile: ProgressionState,
    private readonly callbacks: ScreenCallbacks,
  ) {
    this.selectDifficulty = segmented("pick-difficulty", (value) => {
      this.settings.difficulty = value as GameSettings["difficulty"];
      this.commit();
    });
    this.selectTeamSize = segmented("pick-teamsize", (value) => {
      this.settings.teamSize = Number(value);
      this.commit();
    });
    this.selectQuality = segmented("pick-quality", (value) => {
      this.settings.quality = value as GameSettings["quality"];
      this.commit();
    });
    this.selectLook = segmented("pick-look", (value) => {
      this.settings.look = value as GameSettings["look"];
      this.commit();
    });

    // The map buttons are generated, so adding a level to the registry puts it
    // in the lobby without touching the markup -- and while there is only one
    // level, a row offering a choice of one is hidden rather than shown.
    const mapPicker = byId("pick-map");
    const levels = Object.entries(MAPS);
    for (const [id, map] of levels) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.value = id;
      button.textContent = map.name;
      mapPicker.appendChild(button);
    }
    if (levels.length < 2) {
      mapPicker.closest(".lobby-row")?.classList.add("is-hidden");
    }
    this.selectMap = segmented("pick-map", (value) => {
      this.settings.mapId = value;
      this.showMapTagline();
      this.commit();
    });

    this.selectOnline = segmented("pick-online", (value) => {
      this.settings.online = value === "online";
      this.applyMatchType();
      this.commit();
    });
    this.bindText("set-server", "serverUrl", sanitiseServerUrl);
    this.bindText("set-name", "playerName", sanitisePlayerName);

    this.bindSlider("set-touch", "out-touch", "touchSensitivity", 2);
    this.bindSlider("set-mouse", "out-mouse", "mouseSensitivity", 2);
    this.bindSlider("set-gyro", "out-gyro", "gyroScale", 2);
    this.bindSlider("set-fov", "out-fov", "fovDegrees", 0);
    this.bindSlider("set-hud", "out-hud", "hudScale", 2);
    this.bindSlider("set-controls", "out-controls", "controlScale", 2);
    this.bindToggle("set-ads", "adsToggle");
    this.bindToggle("set-invert", "invertY");
    this.bindToggle("set-audio", "audioEnabled");

    byId("btn-start").addEventListener("click", () => callbacks.onStart());
    byId("btn-open-settings").addEventListener("click", () => this.show("settings"));
    byId("btn-close-settings").addEventListener("click", () => this.show("lobby"));
    byId("btn-again").addEventListener("click", () => callbacks.onPlayAgain());
    byId("btn-lobby").addEventListener("click", () => callbacks.onReturnToLobby());

    this.applySettingsToControls();
    this.renderCareer();
  }

  /** Redraw the level and the progress bar from the profile. */
  renderCareer(profile: ProgressionState = this.profile): void {
    this.profile = profile;

    byId("career-level").textContent = String(profile.level);
    byId<HTMLElement>("career-fill").style.transform =
      `scaleX(${levelProgress(profile).toFixed(3)})`;

    // What the next level hands over is a weapon or it is nothing: the rack
    // is the whole of what levelling gives now that the finishes are not
    // something the player picks between.
    const upcomingWeapon = nextUnlock(profile);
    byId("career-next").textContent =
      profile.level >= MAX_LEVEL
        ? "Top level"
        : upcomingWeapon
          ? `${WEAPONS[upcomingWeapon.weapon].name} at level ${upcomingWeapon.level}`
          : "";

    const ratio = profile.deaths === 0 ? profile.kills : profile.kills / profile.deaths;
    byId("career-stats").textContent =
      `${profile.matches} rounds · ${profile.kills} kills · ${profile.headshots} headshots · ` +
      `${ratio.toFixed(2)} ratio`;

  }

  get activeScreen(): ScreenName {
    return this.current;
  }

  show(screen: ScreenName): void {
    this.current = screen;
    this.lobby.classList.toggle("is-hidden", screen !== "lobby");
    this.settingsPanel.classList.toggle("is-hidden", screen !== "settings");
    this.scoreboard.classList.toggle("is-hidden", screen !== "scoreboard");
  }

  /** Fill the end-of-round screen from the finished match. */
  showResults(
    match: MatchState,
    reward?: MatchReward,
    levels?: LevelUpResult,
  ): void {
    this.renderRewards(reward, levels);
    const { scores, playerKills, playerDeaths, playerHeadshots, winner } = match;
    byId("result-title").textContent =
      winner === "draw" ? "DRAW" : winner === "a" ? "BLUE WINS" : "RUST WINS";
    byId("result-sub").textContent = `Blue ${scores.a} · Rust ${scores.b}`;
    byId("stat-kills").textContent = String(playerKills);
    byId("stat-deaths").textContent = String(playerDeaths);
    byId("stat-headshots").textContent = String(playerHeadshots);
    // Deaths of zero would divide by nothing; a clean sheet reports the kills.
    const ratio = playerDeaths === 0 ? playerKills : playerKills / playerDeaths;
    byId("stat-ratio").textContent = ratio.toFixed(2);
    this.show("scoreboard");
  }

  private renderRewards(reward?: MatchReward, levels?: LevelUpResult): void {
    const container = byId("rewards");
    container.replaceChildren();
    byId("levelup").textContent = "";
    if (!reward) return;

    const line = (label: string, xp: number, total = false) => {
      const row = document.createElement("div");
      row.className = total ? "reward-line is-total" : "reward-line";
      const name = document.createElement("span");
      name.textContent = label;
      const value = document.createElement("span");
      value.textContent = `${xp} XP`;
      row.append(name, value);
      container.appendChild(row);
    };

    for (const entry of rewardBreakdown(reward)) line(entry.label, entry.xp);
    line("Total", rewardTotal(reward), true);

    if (levels && levels.gained > 0) {
      const unlocked = nextUnlockedAt(levels.to);
      byId("levelup").textContent = unlocked
        ? `LEVEL ${levels.to} · ${unlocked} UNLOCKED`
        : `LEVEL ${levels.to}`;
    }
  }

  /** Show a connection message under the lobby's buttons. */
  setNetStatus(text: string, kind: "info" | "error" | "live" = "info"): void {
    this.netStatus.textContent = text;
    this.netStatus.classList.toggle("is-error", kind === "error");
    this.netStatus.classList.toggle("is-live", kind === "live");
  }

  private showMapTagline(): void {
    const map = MAPS[this.settings.mapId];
    byId("map-tagline").textContent = map ? map.tagline : "";
  }

  private applyMatchType(): void {
    this.card.classList.toggle("is-online", this.settings.online);
    this.card.classList.toggle("is-offline", !this.settings.online);
  }

  private bindText(
    inputId: string,
    key: "serverUrl" | "playerName",
    clean: (value: unknown) => string,
  ): void {
    const input = byId<HTMLInputElement>(inputId);
    input.addEventListener("change", () => {
      // Clean on commit rather than on every keystroke, so typing an address
      // is not fought character by character.
      const cleaned = clean(input.value);
      this.settings[key] = cleaned;
      if (cleaned !== input.value) input.value = cleaned;
      this.commit();
    });
  }

  private bindSlider(
    inputId: string,
    outputId: string,
    key:
      | "touchSensitivity"
      | "mouseSensitivity"
      | "gyroScale"
      | "fovDegrees"
      | "hudScale"
      | "controlScale",
    decimals: number,
  ): void {
    const input = byId<HTMLInputElement>(inputId);
    const output = byId<HTMLOutputElement>(outputId);
    const render = () => {
      output.textContent = this.settings[key].toFixed(decimals);
    };
    input.addEventListener("input", () => {
      this.settings[key] = Number(input.value);
      render();
      this.commit();
    });
    render();
  }

  private bindToggle(inputId: string, key: "invertY" | "audioEnabled" | "adsToggle"): void {
    const input = byId<HTMLInputElement>(inputId);
    input.addEventListener("change", () => {
      this.settings[key] = input.checked;
      this.commit();
    });
  }

  /** Push the loaded settings into the controls, once, at startup. */
  private applySettingsToControls(): void {
    const set = (id: string, value: number) => {
      byId<HTMLInputElement>(id).value = String(value);
    };
    const limits = SETTINGS_LIMITS;
    set("set-touch", this.settings.touchSensitivity);
    set("set-mouse", this.settings.mouseSensitivity);
    set("set-gyro", this.settings.gyroScale);
    set("set-fov", this.settings.fovDegrees);
    set("set-hud", this.settings.hudScale);
    set("set-controls", this.settings.controlScale);
    byId<HTMLInputElement>("set-ads").checked = this.settings.adsToggle;
    byId<HTMLInputElement>("set-invert").checked = this.settings.invertY;
    byId<HTMLInputElement>("set-audio").checked = this.settings.audioEnabled;
    byId<HTMLOutputElement>("out-touch").textContent = this.settings.touchSensitivity.toFixed(2);
    byId<HTMLOutputElement>("out-mouse").textContent = this.settings.mouseSensitivity.toFixed(2);
    byId<HTMLOutputElement>("out-gyro").textContent = this.settings.gyroScale.toFixed(2);
    byId<HTMLOutputElement>("out-fov").textContent = this.settings.fovDegrees.toFixed(0);
    byId<HTMLOutputElement>("out-hud").textContent = this.settings.hudScale.toFixed(2);
    byId<HTMLOutputElement>("out-controls").textContent = this.settings.controlScale.toFixed(2);
    this.selectDifficulty(this.settings.difficulty);
    this.selectTeamSize(String(this.settings.teamSize));
    this.selectQuality(this.settings.quality);
    this.selectLook(this.settings.look);
    this.selectOnline(this.settings.online ? "online" : "offline");
    this.selectMap(this.settings.mapId);
    this.showMapTagline();
    byId<HTMLInputElement>("set-server").value = this.settings.serverUrl;
    byId<HTMLInputElement>("set-name").value = this.settings.playerName;
    this.applyMatchType();
    void limits;
  }

  private commit(): void {
    this.callbacks.onSettingsChanged(this.settings);
  }
}

/** What reaching a level hands over, named for the level-up line. */
const nextUnlockedAt = (level: number): string | null => {
  const weapon = (Object.entries(WEAPON_UNLOCKS) as [WeaponId, number][]).find(
    ([, at]) => at === level,
  );
  return weapon ? WEAPONS[weapon[0]].name.toUpperCase() : null;
};
