import type { PlayerState } from "../sim/types";

export interface HudElements {
  crosshair: HTMLElement;
  debug: HTMLElement;
  stance: HTMLElement;
}

/**
 * Phase 0 HUD: a crosshair, a stance readout and a debug line.
 * The weapon, ammo, minimap and kill feed arrive with Phase 1.
 */
export class Hud {
  private debugVisible = true;
  private accumulator = 0;

  constructor(private readonly elements: HudElements) {}

  toggleDebug(): void {
    this.debugVisible = !this.debugVisible;
    this.elements.debug.style.display = this.debugVisible ? "block" : "none";
  }

  update(
    state: PlayerState,
    fps: number,
    tier: string,
    activeMeshes: number,
    deltaSeconds: number,
  ): void {
    const speed = Math.hypot(state.velocity.x, state.velocity.z);

    // The crosshair widens while moving. In Phase 1 this is driven by real
    // weapon spread; here it previews the feedback so the feel is testable.
    const spread = 4 + speed * 2.2 + (state.grounded ? 0 : 6);
    this.elements.crosshair.style.setProperty("--spread", `${spread.toFixed(1)}px`);

    const stance = state.crouchAmount > 0.5 ? "CROUCH" : state.sprinting ? "SPRINT" : "STAND";
    if (this.elements.stance.textContent !== stance) {
      this.elements.stance.textContent = stance;
    }

    // The debug line is throttled: writing to the DOM every frame is a
    // measurable cost on a phone, and nobody can read 60 updates a second.
    this.accumulator += deltaSeconds;
    if (!this.debugVisible || this.accumulator < 0.25) return;
    this.accumulator = 0;
    this.elements.debug.textContent =
      `${fps.toFixed(0)} fps  ·  ${tier}  ·  ${activeMeshes} meshes\n` +
      `pos ${state.position.x.toFixed(1)} ${state.position.y.toFixed(1)} ${state.position.z.toFixed(1)}  ·  ` +
      `${speed.toFixed(1)} m/s  ·  ${state.grounded ? "ground" : "air"}`;
  }
}
