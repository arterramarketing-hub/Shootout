/** An on-screen button bound to a named action. */
export interface TouchButton {
  action: ButtonAction;
  element: HTMLElement;
  /** Toggles latch on tap instead of following the press. */
  toggle: boolean;
}

export type ButtonAction =
  | "fire"
  | "aim"
  | "reload"
  | "crouch"
  | "swap"
  | "leanLeft"
  | "leanRight"
  | "mantle";

export class ButtonBank {
  private readonly held = new Set<ButtonAction>();
  private readonly latched = new Set<ButtonAction>();
  private readonly pressedEdge = new Set<ButtonAction>();
  private readonly pointerToAction = new Map<number, ButtonAction>();
  private readonly buttons: TouchButton[] = [];

  register(button: TouchButton): void {
    this.buttons.push(button);
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
      if (button.toggle) {
        if (this.latched.has(button.action)) this.latched.delete(button.action);
        else this.latched.add(button.action);
      } else {
        this.held.add(button.action);
      }
      this.paint(button);
    });

    const release = (event: PointerEvent) => {
      const action = this.pointerToAction.get(event.pointerId);
      if (action === undefined) return;
      this.pointerToAction.delete(event.pointerId);
      if (!button.toggle) this.held.delete(action);
      this.paint(button);
    };
    button.element.addEventListener("pointerup", release);
    button.element.addEventListener("pointercancel", release);
  }

  isDown(action: ButtonAction): boolean {
    return this.held.has(action) || this.latched.has(action);
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

  /** Releases everything. Used when the window loses focus mid-press. */
  releaseAll(): void {
    this.held.clear();
    this.pointerToAction.clear();
    this.pressedEdge.clear();
    for (const button of this.buttons) this.paint(button);
  }

  private paint(button: TouchButton): void {
    button.element.classList.toggle("is-active", this.isDown(button.action));
  }
}
