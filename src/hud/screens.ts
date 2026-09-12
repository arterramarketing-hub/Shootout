import { SETTINGS_LIMITS, type GameSettings } from "../engine/settings";
import type { MatchState } from "../sim/match";

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

  constructor(
    private settings: GameSettings,
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

    this.bindSlider("set-touch", "out-touch", "touchSensitivity", 2);
    this.bindSlider("set-mouse", "out-mouse", "mouseSensitivity", 2);
    this.bindSlider("set-gyro", "out-gyro", "gyroScale", 2);
    this.bindSlider("set-fov", "out-fov", "fovDegrees", 0);
    this.bindSlider("set-hud", "out-hud", "hudScale", 2);
    this.bindToggle("set-invert", "invertY");
    this.bindToggle("set-audio", "audioEnabled");

    byId("btn-start").addEventListener("click", () => callbacks.onStart());
    byId("btn-open-settings").addEventListener("click", () => this.show("settings"));
    byId("btn-close-settings").addEventListener("click", () => this.show("lobby"));
    byId("btn-again").addEventListener("click", () => callbacks.onPlayAgain());
    byId("btn-lobby").addEventListener("click", () => callbacks.onReturnToLobby());

    this.applySettingsToControls();
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
  showResults(match: MatchState): void {
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

  private bindSlider(
    inputId: string,
    outputId: string,
    key: "touchSensitivity" | "mouseSensitivity" | "gyroScale" | "fovDegrees" | "hudScale",
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

  private bindToggle(inputId: string, key: "invertY" | "audioEnabled"): void {
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
    byId<HTMLInputElement>("set-invert").checked = this.settings.invertY;
    byId<HTMLInputElement>("set-audio").checked = this.settings.audioEnabled;
    byId<HTMLOutputElement>("out-touch").textContent = this.settings.touchSensitivity.toFixed(2);
    byId<HTMLOutputElement>("out-mouse").textContent = this.settings.mouseSensitivity.toFixed(2);
    byId<HTMLOutputElement>("out-gyro").textContent = this.settings.gyroScale.toFixed(2);
    byId<HTMLOutputElement>("out-fov").textContent = this.settings.fovDegrees.toFixed(0);
    byId<HTMLOutputElement>("out-hud").textContent = this.settings.hudScale.toFixed(2);
    this.selectDifficulty(this.settings.difficulty);
    this.selectTeamSize(String(this.settings.teamSize));
    this.selectQuality(this.settings.quality);
    void limits;
  }

  private commit(): void {
    this.callbacks.onSettingsChanged(this.settings);
  }
}
