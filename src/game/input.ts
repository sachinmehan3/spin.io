import type { TopInput, Vec } from "../sim";
import { isTouch, toView, viewSize } from "./viewport";

/** How far (CSS px) the cursor must be from the Player's Top for full throttle. */
const FULL_THROTTLE_DISTANCE = 160;
/** How far (CSS px) the joystick knob travels from its centre; the edge is full throttle. */
const STICK_RADIUS = 46;
/** Below this knob travel (CSS px) the joystick reads as centred, so a resting thumb doesn't creep. */
const STICK_DEAD_ZONE = 6;

/** The on-screen controls phones steer with. */
export interface TouchControls {
  /** Where a thumb can land to take the joystick: the left side of the screen. */
  zone: HTMLElement;
  base: HTMLElement;
  knob: HTMLElement;
  dash: HTMLElement;
}

/**
 * Turns mouse and keyboard, or on phones a joystick and a Dash button, into the simulation's
 * input shape: a steering direction whose length is throttle, plus a Dash request.
 */
export class PlayerInput {
  // Until the mouse moves, pretend it rests at the screen centre (i.e. on the Player's Top).
  private mouse: Vec = { x: viewSize().width / 2, y: viewSize().height / 2 };
  /** Joystick deflection: direction times throttle, or null when no thumb is on it. */
  private stick: Vec | null = null;
  /** Last real steering direction, so a Dash with the cursor on the Top still goes somewhere. */
  private heading: Vec = { x: 1, y: 0 };
  private dashQueued = false;

  constructor(target: HTMLElement, touch: TouchControls) {
    if (isTouch) {
      this.bindTouch(touch);
    } else {
      window.addEventListener("mousemove", (e) => {
        this.mouse = toView(e.clientX, e.clientY);
      });
      target.addEventListener("mousedown", (e) => {
        if (e.button === 0) this.dashQueued = true;
      });
    }
    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.dashQueued = true;
      }
    });
  }

  /** The input for the next simulation step, steering from the Top's on-screen position toward the cursor. */
  take(topOnScreen: Vec): TopInput {
    const dash = this.dashQueued;
    this.dashQueued = false;
    let dir: Vec;
    if (isTouch) {
      dir = this.stick ?? { x: 0, y: 0 };
    } else {
      const dx = this.mouse.x - topOnScreen.x;
      const dy = this.mouse.y - topOnScreen.y;
      const dist = Math.hypot(dx, dy);
      const throttle = Math.min(1, dist / FULL_THROTTLE_DISTANCE);
      dir = dist < 4 ? { x: 0, y: 0 } : { x: (dx / dist) * throttle, y: (dy / dist) * throttle };
    }
    const length = Math.hypot(dir.x, dir.y);
    if (length === 0) {
      // Not steering (cursor on the Top, or thumb off the stick): coast, but a Dash still fires along the last heading.
      return dash ? { dir: this.heading, dash } : { dir, dash };
    }
    this.heading = { x: dir.x / length, y: dir.y / length };
    return { dir, dash };
  }

  clear() {
    this.dashQueued = false;
  }

  /**
   * The joystick sits faintly at rest in the bottom-left corner; a thumb landing anywhere on the
   * left side picks it up there, so the player never has to look for it.
   */
  private bindTouch({ zone, base, knob, dash }: TouchControls) {
    let finger: number | null = null;
    let origin: Vec = { x: 0, y: 0 };

    const move = (at: Vec) => {
      let dx = at.x - origin.x;
      let dy = at.y - origin.y;
      const dist = Math.hypot(dx, dy);
      if (dist > STICK_RADIUS) {
        dx *= STICK_RADIUS / dist;
        dy *= STICK_RADIUS / dist;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.stick = dist < STICK_DEAD_ZONE ? { x: 0, y: 0 } : { x: dx / STICK_RADIUS, y: dy / STICK_RADIUS };
    };
    const release = () => {
      finger = null;
      this.stick = null;
      knob.style.transform = "";
      base.style.left = base.style.top = "";
      base.classList.remove("held");
    };

    zone.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        if (finger !== null) return;
        const t = e.changedTouches[0];
        finger = t.identifier;
        origin = toView(t.clientX, t.clientY);
        base.style.left = `${origin.x}px`;
        base.style.top = `${origin.y}px`;
        base.classList.add("held");
        move(origin);
      },
      { passive: false },
    );
    zone.addEventListener(
      "touchmove",
      (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches)) if (t.identifier === finger) move(toView(t.clientX, t.clientY));
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === finger) release();
    };
    zone.addEventListener("touchend", end);
    zone.addEventListener("touchcancel", end);

    dash.addEventListener(
      "touchstart",
      (e) => {
        e.preventDefault();
        this.dashQueued = true;
        dash.classList.add("pressed");
      },
      { passive: false },
    );
    const lift = () => dash.classList.remove("pressed");
    dash.addEventListener("touchend", lift);
    dash.addEventListener("touchcancel", lift);
  }
}
