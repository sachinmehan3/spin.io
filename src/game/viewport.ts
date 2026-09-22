import type { Vec } from "../sim";

// Phones play in landscape. Where the browser can lock the orientation (Android, after going
// fullscreen) we ask it to; where it can't (iOS) and the phone is held upright, the whole game is
// rotated a quarter turn with CSS instead. Everything that measures the screen or reads touch
// positions goes through this module, so it sees the game's own (landscape) frame either way.

/** A phone or tablet: steered with on-screen controls rather than a mouse. Add ?touch to the URL to try them on a desktop. */
export const isTouch = window.matchMedia("(pointer: coarse)").matches || new URLSearchParams(location.search).has("touch");

/** True while the game is drawn rotated a quarter turn to stay landscape on an upright phone. */
export function isRotated(): boolean {
  return isTouch && window.innerHeight > window.innerWidth;
}

/** The game's width and height in CSS px, in its own frame. */
export function viewSize(): { width: number; height: number } {
  const { innerWidth: w, innerHeight: h } = window;
  return isRotated() ? { width: h, height: w } : { width: w, height: h };
}

/** A touch or mouse position (client px) in the game's own frame. */
export function toView(clientX: number, clientY: number): Vec {
  return isRotated() ? { x: clientY, y: window.innerWidth - clientX } : { x: clientX, y: clientY };
}

/** Keeps the page's classes and size variables in step with the screen. */
export function watchViewport() {
  const root = document.documentElement;
  const update = () => {
    const { width, height } = viewSize();
    root.classList.toggle("touch", isTouch);
    root.classList.toggle("rotated", isRotated());
    // Short screens (phones in landscape) get the small HUD, so it doesn't crowd the stadium.
    root.classList.toggle("compact", isTouch || height < 560);
    root.style.setProperty("--view-w", `${width}px`);
    root.style.setProperty("--view-h", `${height}px`);
  };
  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
}

/** Call from a user gesture: on phones, go fullscreen and lock to landscape where the browser allows. */
export async function goLandscape() {
  if (!isTouch) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
    const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    await orientation.lock?.("landscape");
  } catch {
    // Not allowed here (e.g. iOS): the CSS rotation keeps the game landscape instead.
  }
}
