/** An on-screen button bound to a named action. */
export interface TouchButton {
  action: ButtonAction;
  element: HTMLElement;
}

export type ButtonAction =
  | "fire"
  | "aim"
  | "reload"
  | "crouch"
  | "swap"
  | "dodge"
  | "leanLeft"
  | "leanRight"
  | "mantle";

export class ButtonBank {
  private readonly held = new Set<ButtonAction>();
  private readonly latched = new Set<ButtonAction>();
  private readonly toggles = new Set<ButtonAction>();
  private readonly pressedEdge = new Set<ButtonAction>();
  private readonly pointerToAction = new Map<number, ButtonAction>();
  private readonly buttons: TouchButton[] = [];
  private releaseBackstop: ((event: PointerEvent) => void) | null = null;

  register(button: TouchButton): void {
    this.buttons.push(button);
    this.installBackstop();

    button.element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        button.element.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an enhancement; the press is tracked by pointer id anyway.
      }
      this.pointerToAction.set(event.pointerId, button.action);
      this.pressedEdge.add(button.action);
      if (this.toggles.has(button.action)) {
        if (this.latched.has(button.action)) this.latched.delete(button.action);
        else this.latched.add(button.action);
      } else {
        this.held.add(button.action);
      }
      this.paint(button.action);
    });

    const release = (event: PointerEvent) => this.releasePointer(event.pointerId);
    button.element.addEventListener("pointerup", release);
    button.element.addEventListener("pointercancel", release);
  }

  /**
   * Route a release by pointer id rather than by the element it landed on.
   *
   * A press is normally returned to its button by pointer capture, but capture
   * throws for a pointer the browser has already forgotten, and the press is
   * deliberately kept in that case. Without a release path that does not depend
   * on the element, that press is held forever: on the fire button, a weapon
   * that never stops shooting.
   */
  private installBackstop(): void {
    if (this.releaseBackstop) return;
    const release = (event: PointerEvent) => this.releasePointer(event.pointerId);
    this.releaseBackstop = release;
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
  }

  /** Drop the window-level listeners this bank installed. */
  dispose(): void {
    if (!this.releaseBackstop) return;
    window.removeEventListener("pointerup", this.releaseBackstop);
    window.removeEventListener("pointercancel", this.releaseBackstop);
    this.releaseBackstop = null;
  }

  private releasePointer(pointerId: number): void {
    const action = this.pointerToAction.get(pointerId);
    if (action === undefined) return;
    this.pointerToAction.delete(pointerId);
    // A latched action stays on after the finger leaves; only a held one ends.
    if (!this.toggles.has(action)) this.held.delete(action);
    this.paint(action);
  }

  /**
   * Switch an action between hold-to-use and tap-to-latch.
   *
   * Changing the mode drops whatever the old mode was holding, so a player who
   * flips the setting mid-match does not come back to a weapon stuck aiming.
   */
  setToggle(action: ButtonAction, toggle: boolean): void {
    if (this.toggles.has(action) === toggle) return;
    if (toggle) this.toggles.add(action);
    else this.toggles.delete(action);
    this.held.delete(action);
    this.latched.delete(action);
    this.paint(action);
  }

  isDown(action: ButtonAction): boolean {
    return this.held.has(action) || this.latched.has(action);
  }

  isLatched(action: ButtonAction): boolean {
    return this.latched.has(action);
  }

  /** Drop a latch the game itself has decided to end, such as ADS on death. */
  clearLatch(action: ButtonAction): void {
    if (!this.latched.delete(action)) return;
    this.paint(action);
  }

  /** True once per press. Clears when the frame is consumed. */
  consumePress(action: ButtonAction): boolean {
    if (!this.pressedEdge.has(action)) return false;
    this.pressedEdge.delete(action);
    return true;
  }

  endFrame(): void {
    this.pressedEdge.clear();
  }

  /** Releases everything, latches included. Used when the window loses focus. */
  releaseAll(): void {
    this.held.clear();
    this.latched.clear();
    this.pointerToAction.clear();
    this.pressedEdge.clear();
    for (const button of this.buttons) this.paint(button.action);
  }

  /**
   * Repaint every element bound to an action, not just the one pressed. Fire
   * sits under both thumbs, and lighting only the element that happened to
   * receive the event leaves the other one wrong.
   */
  private paint(action: ButtonAction): void {
    const active = this.isDown(action);
    const latched = this.latched.has(action);
    const toggles = this.toggles.has(action);
    for (const button of this.buttons) {
      if (button.action !== action) continue;
      button.element.classList.toggle("is-active", active);
      button.element.classList.toggle("is-latched", active && latched);
      // Only a latching control has a pressed state worth announcing; a
      // hold-to-use button is momentary, and a stuck "not pressed" on it is
      // worse for a screen reader than saying nothing at all.
      if (toggles) button.element.setAttribute("aria-pressed", String(latched));
      else button.element.removeAttribute("aria-pressed");
    }
  }
}
