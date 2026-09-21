import type { TopInput, Vec } from "../sim";

/** How far (CSS px) the cursor must be from the Player's Top for full throttle. */
const FULL_THROTTLE_DISTANCE = 160;

/**
 * Turns mouse and keyboard into the simulation's input shape: a steering direction whose
 * length is throttle, plus a Dash request. Touch controls can later produce the same shape.
 */
export class PlayerInput {
  // Until the mouse moves, pretend it rests at the screen centre (i.e. on the Player's Top).
  private mouse: Vec = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  /** Last real steering direction, so a Dash with the cursor on the Top still goes somewhere. */
  private heading: Vec = { x: 1, y: 0 };
  private dashQueued = false;

  constructor(target: HTMLElement) {
    window.addEventListener("mousemove", (e) => {
      this.mouse = { x: e.clientX, y: e.clientY };
    });
    target.addEventListener("mousedown", (e) => {
      if (e.button === 0) this.dashQueued = true;
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.dashQueued = true;
      }
    });
  }

  /** The input for the next simulation step, steering from the Top's on-screen position toward the cursor. */
  take(topOnScreen: Vec): TopInput {
    const dx = this.mouse.x - topOnScreen.x;
    const dy = this.mouse.y - topOnScreen.y;
    const dist = Math.hypot(dx, dy);
    const dash = this.dashQueued;
    this.dashQueued = false;
    if (dist < 4) {
      // Cursor on the Top: coast, but a Dash still fires along the last heading.
      return dash ? { dir: this.heading, dash } : { dir: { x: 0, y: 0 }, dash };
    }
    this.heading = { x: dx / dist, y: dy / dist };
    const throttle = Math.min(1, dist / FULL_THROTTLE_DISTANCE);
    return { dir: { x: this.heading.x * throttle, y: this.heading.y * throttle }, dash };
  }

  clear() {
    this.dashQueued = false;
  }
}
