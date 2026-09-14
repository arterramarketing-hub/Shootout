import { currentSpread } from "../sim/ballistics";
import { HEALTH, type HealthState } from "../sim/health";
import { activeWeapon, isSwapping, type LoadoutState } from "../sim/loadout";
import type { PlayerState } from "../sim/types";
import { describeKill, formatClock, type MatchState } from "../sim/match";
import { clamp } from "../sim/vec3";

export interface HudElements {
  crosshair: HTMLElement;
  hitMarker: HTMLElement;
  debug: HTMLElement;
  stance: HTMLElement;
  ammoCurrent: HTMLElement;
  ammoReserve: HTMLElement;
  weaponName: HTMLElement;
  weaponClass: HTMLElement;
  reloadHint: HTMLElement;
  healthFill: HTMLElement;
  healthValue: HTMLElement;
  damageVignette: HTMLElement;
  feed: HTMLElement;
  scoreA: HTMLElement;
  scoreB: HTMLElement;
  clock: HTMLElement;
  killFeed: HTMLElement;
  countdown: HTMLElement;
  respawn: HTMLElement;
  respawnTimer: HTMLElement;
  root: HTMLElement;
}

export interface HudFrame {
  player: PlayerState;
  loadout: LoadoutState;
  health: HealthState;
  match: MatchState;
  /** Seconds until the player returns, or zero when alive. */
  respawnIn: number;
  fps: number;
  tier: string;
  activeMeshes: number;
  deltaSeconds: number;
}

/** How long a line stays in the feed. */
const FEED_LIFE = 2.6;
const HIT_MARKER_LIFE = 0.18;

export class Hud {
  private debugVisible = false;
  private debugAccumulator = 0;
  private hitMarkerLife = 0;
  private readonly feedEntries: { element: HTMLElement; life: number }[] = [];
  private lastAmmo = -1;
  private lastWeapon = "";
  private lastFeedLength = 0;
  private lastClock = "";
  private lastScoreA = -1;
  private lastScoreB = -1;

  constructor(private readonly elements: HudElements) {
    this.elements.debug.style.display = "none";
  }

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.elements.debug.style.display = this.debugVisible ? "block" : "none";
  }

  /** Flash the hit marker. Headshots get their own colour. */
  showHitMarker(headshot: boolean): void {
    this.hitMarkerLife = HIT_MARKER_LIFE;
    this.elements.hitMarker.classList.toggle("is-headshot", headshot);
    this.elements.hitMarker.style.opacity = "1";
  }

  /** Add a line to the feed, newest at the bottom. */
  pushFeed(text: string, kind: "hit" | "down" | "info" = "info"): void {
    const element = document.createElement("div");
    element.className = `feed-line feed-${kind}`;
    element.textContent = text;
    this.elements.feed.appendChild(element);
    this.feedEntries.push({ element, life: FEED_LIFE });
    // Never let the feed grow without bound; it is a HUD, not a log.
    while (this.feedEntries.length > 5) {
      const oldest = this.feedEntries.shift();
      oldest?.element.remove();
    }
  }

  /** Scale the whole HUD, so a small screen can get bigger readouts. */
  /**
   * Resize the readouts.
   *
   * This sets a variable the stylesheet applies to each anchored group about
   * its own corner, rather than one transform on the HUD root. A single root
   * transform scales positions as well as sizes, which walks every corner
   * readout off its edge and, at the top of the slider, straight off screen.
   */
  setScale(scale: number): void {
    this.elements.root.style.setProperty("--hud-scale", String(scale));
  }

  update(frame: HudFrame): void {
    const { player, loadout, health, deltaSeconds } = frame;
    this.updateMatch(frame);
    const weapon = activeWeapon(loadout);

    this.updateCrosshair(player, loadout, deltaSeconds);
    this.updateAmmo(loadout);
    this.updateHealth(health);
    this.updateFeed(deltaSeconds);

    const stance = weapon.reloading
      ? "RELOAD"
      : isSwapping(loadout)
        ? "SWAP"
        : player.crouchAmount > 0.5
          ? "CROUCH"
          : player.sprinting
            ? "SPRINT"
            : "STAND";
    if (this.elements.stance.textContent !== stance) {
      this.elements.stance.textContent = stance;
    }

    const needsReload = weapon.magazine === 0 && weapon.reserve > 0 && !weapon.reloading;
    this.elements.reloadHint.classList.toggle("is-visible", needsReload);

    this.updateDebug(frame);
  }

  private updateMatch(frame: HudFrame): void {
    const { match, respawnIn } = frame;

    if (match.scores.a !== this.lastScoreA) {
      this.lastScoreA = match.scores.a;
      this.elements.scoreA.textContent = String(match.scores.a);
    }
    if (match.scores.b !== this.lastScoreB) {
      this.lastScoreB = match.scores.b;
      this.elements.scoreB.textContent = String(match.scores.b);
    }

    const clock = formatClock(match.timeRemaining);
    if (clock !== this.lastClock) {
      this.lastClock = clock;
      this.elements.clock.textContent = clock;
      this.elements.clock.classList.toggle("is-urgent", match.timeRemaining <= 30);
    }

    const counting = match.phase === "countdown";
    this.elements.countdown.classList.toggle("is-visible", counting);
    if (counting) {
      this.elements.countdown.textContent = String(Math.max(1, Math.ceil(match.countdown)));
    }

    const downed = respawnIn > 0;
    this.elements.respawn.classList.toggle("is-visible", downed);
    if (downed) {
      this.elements.respawnTimer.textContent = String(Math.max(1, Math.ceil(respawnIn)));
    }

    // The kill feed is rebuilt only when it actually changed, which on a phone
    // is the difference between a free HUD and one that costs a frame.
    if (match.feed.length !== this.lastFeedLength) {
      this.lastFeedLength = match.feed.length;
      this.renderKillFeed(frame);
    }
  }

  private renderKillFeed(frame: HudFrame): void {
    const container = this.elements.killFeed;
    container.replaceChildren();
    for (const event of frame.match.feed) {
      const line = document.createElement("div");
      line.className = "kill-line";
      if (event.byPlayer) line.classList.add("is-player");
      else if (event.againstPlayer) line.classList.add("is-victim");
      line.textContent = describeKill(event);
      container.appendChild(line);
    }
  }

  private updateCrosshair(
    player: PlayerState,
    loadout: LoadoutState,
    deltaSeconds: number,
  ): void {
    const weapon = activeWeapon(loadout);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    // The crosshair is driven by the same spread the bullets use, so what the
    // player reads is exactly what the weapon will do.
    const spread = currentSpread(weapon.definition.spread, weapon.bloom, {
      speed,
      grounded: player.grounded,
      crouchAmount: player.crouchAmount,
      adsProgress: loadout.adsProgress,
    });
    const pixels = 3 + spread * 7.5;
    this.elements.crosshair.style.setProperty("--spread", `${pixels.toFixed(1)}px`);
    // Aiming hides the crosshair: the weapon's own sight takes over.
    this.elements.crosshair.style.opacity = (1 - loadout.adsProgress * 0.92).toFixed(3);

    if (this.hitMarkerLife > 0) {
      this.hitMarkerLife -= deltaSeconds;
      if (this.hitMarkerLife <= 0) this.elements.hitMarker.style.opacity = "0";
    }
  }

  private updateAmmo(loadout: LoadoutState): void {
    const weapon = activeWeapon(loadout);
    if (weapon.magazine !== this.lastAmmo) {
      this.lastAmmo = weapon.magazine;
      this.elements.ammoCurrent.textContent = String(weapon.magazine);
      this.elements.ammoCurrent.classList.toggle("is-empty", weapon.magazine === 0);
    }
    this.elements.ammoReserve.textContent = String(weapon.reserve);

    if (weapon.definition.name !== this.lastWeapon) {
      this.lastWeapon = weapon.definition.name;
      this.elements.weaponName.textContent = weapon.definition.name;
      this.elements.weaponClass.textContent = weapon.definition.className;
    }
  }

  private updateHealth(health: HealthState): void {
    const fraction = clamp(health.current / HEALTH.max, 0, 1);
    this.elements.healthFill.style.transform = `scaleX(${fraction.toFixed(3)})`;
    this.elements.healthFill.classList.toggle("is-critical", fraction <= 0.3);
    this.elements.healthValue.textContent = String(Math.ceil(health.current));

    // The vignette rises as health falls, and flares briefly on each hit.
    const injury = Math.pow(1 - fraction, 1.6);
    const recent = Math.max(0, 1 - health.sinceDamage / 0.6);
    const intensity = clamp(injury * 0.75 + recent * 0.35, 0, 1);
    this.elements.damageVignette.style.opacity = intensity.toFixed(3);
  }

  private updateFeed(deltaSeconds: number): void {
    for (let i = this.feedEntries.length - 1; i >= 0; i -= 1) {
      const entry = this.feedEntries[i];
      entry.life -= deltaSeconds;
      if (entry.life <= 0) {
        entry.element.remove();
        this.feedEntries.splice(i, 1);
      } else if (entry.life < 0.5) {
        entry.element.style.opacity = (entry.life / 0.5).toFixed(2);
      }
    }
  }

  private updateDebug(frame: HudFrame): void {
    this.debugAccumulator += frame.deltaSeconds;
    if (!this.debugVisible || this.debugAccumulator < 0.25) return;
    this.debugAccumulator = 0;

    const { player, loadout } = frame;
    const weapon = activeWeapon(loadout);
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const spread = currentSpread(weapon.definition.spread, weapon.bloom, {
      speed,
      grounded: player.grounded,
      crouchAmount: player.crouchAmount,
      adsProgress: loadout.adsProgress,
    });
    this.elements.debug.textContent =
      `${frame.fps.toFixed(0)} fps  ·  ${frame.tier}  ·  ${frame.activeMeshes} meshes\n` +
      `pos ${player.position.x.toFixed(1)} ${player.position.y.toFixed(1)} ${player.position.z.toFixed(1)}  ·  ` +
      `${speed.toFixed(1)} m/s  ·  ${player.grounded ? "ground" : "air"}\n` +
      `spread ${spread.toFixed(2)}deg  ·  ads ${(loadout.adsProgress * 100).toFixed(0)}%  ·  ` +
      `bloom ${weapon.bloom.toFixed(2)}`;
  }
}
