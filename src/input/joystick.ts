import { INPUT } from "../sim/config";
import { clamp } from "../sim/vec3";

export interface JoystickOutput {
  x: number;
  y: number;
  magnitude: number;
  active: boolean;
}

/**
 * Floating movement stick. The base appears wherever the thumb lands on the
 * left half of the screen, which is the only layout that works on a phone held
 * two-handed: the thumb never has to find a fixed target.
 */
export class Joystick {
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private currentX = 0;
  private currentY = 0;

  constructor(
    private readonly base: HTMLElement,
    private readonly knob: HTMLElement,
    private readonly radius: number = INPUT.joystickRadius,
  ) {}

  get isActive(): boolean {
    return this.pointerId !== null;
  }

  owns(pointerId: number): boolean {
    return this.pointerId === pointerId;
  }

  start(pointerId: number, x: number, y: number): void {
    this.pointerId = pointerId;
    this.originX = x;
    this.originY = y;
    this.currentX = x;
    this.currentY = y;
    this.base.style.left = `${x}px`;
    this.base.style.top = `${y}px`;
    this.base.style.opacity = "1";
    this.render();
  }

  move(x: number, y: number): void {
    if (this.pointerId === null) return;
    this.currentX = x;
    this.currentY = y;

    if (INPUT.joystickFollow) {
      // Drag past the ring and the base follows, so the stick never runs out
      // of travel mid-sprint.
      const dx = this.currentX - this.originX;
      const dy = this.currentY - this.originY;
      const distance = Math.hypot(dx, dy);
      if (distance > this.radius) {
        const pull = distance - this.radius;
        this.originX += (dx / distance) * pull;
        this.originY += (dy / distance) * pull;
        this.base.style.left = `${this.originX}px`;
        this.base.style.top = `${this.originY}px`;
      }
    }
    this.render();
  }

  end(): void {
    this.pointerId = null;
    this.base.style.opacity = "0";
    this.knob.style.transform = "translate(-50%, -50%)";
  }

  read(): JoystickOutput {
    if (this.pointerId === null) return { x: 0, y: 0, magnitude: 0, active: false };

    const dx = this.currentX - this.originX;
    // Screen Y grows downward; forward on the stick is up the screen.
    const dy = this.originY - this.currentY;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) return { x: 0, y: 0, magnitude: 0, active: true };

    const raw = clamp(distance / this.radius, 0, 1);
    // Rescale past the deadzone so the stick still reaches full deflection.
    const magnitude =
      raw < INPUT.joystickDeadzone
        ? 0
        : (raw - INPUT.joystickDeadzone) / (1 - INPUT.joystickDeadzone);
    return {
      x: (dx / distance) * magnitude,
      y: (dy / distance) * magnitude,
      magnitude,
      active: true,
    };
  }

  private render(): void {
    const dx = clamp(this.currentX - this.originX, -this.radius, this.radius);
    const dy = clamp(this.currentY - this.originY, -this.radius, this.radius);
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }
}
