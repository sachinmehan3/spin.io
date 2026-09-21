import type { TopInput, Vec } from "../sim";

/** How far (CSS px) the cursor must be from the Player's Top for full throttle. */
const FULL_THROTTLE_DISTANCE = 160;

/**
 * Turns mouse and keyboard into the simulation's input shape: a steering direction whose
 * length is throttle, plus a Dash request. Touch controls can later produce the same shape.
 */
export class PlayerInput {
  private mouse: Vec = { x: 0, y: 0 };
  private dashQueued = false;

  constructor(target: HTMLElement) {
    target.addEventListener("mousemove", (e) => {
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
    const throttle = Math.min(1, dist / FULL_THROTTLE_DISTANCE);
    const dir = dist < 4 ? { x: 0, y: 0 } : { x: (dx / dist) * throttle, y: (dy / dist) * throttle };
    const dash = this.dashQueued;
    this.dashQueued = false;
    return { dir, dash };
  }

  clear() {
    this.dashQueued = false;
  }
}
