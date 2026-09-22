import type { Identity } from "../sim";
import type { ClashStyle } from "./audio";

// Per-browser conveniences only. Storage may be unavailable (private mode, blocked site
// data), so every access is guarded and the game works without it.

const KEY = "spin.io/v1";
/** Where saves lived before the game was renamed; read once so nobody loses their best. */
const OLD_KEY = "beyblade.io/v1";

export interface PersonalBest {
  peakMaxSpin: number;
  knockouts: number;
}

interface Saved {
  identity?: Identity;
  best?: PersonalBest;
  muted?: boolean;
  clashStyle?: ClashStyle;
}

function load(): Saved {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY) ?? "{}");
    return saved && typeof saved === "object" ? (saved as Saved) : {};
  } catch {
    return {};
  }
}

function save(patch: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
  } catch {
    // Nothing to do: progress just isn't remembered.
  }
}

export const loadIdentity = () => load().identity;
export const saveIdentity = (identity: Identity) => save({ identity });
export const loadMuted = () => load().muted ?? false;
export const saveMuted = (muted: boolean) => save({ muted });
export const loadClashStyle = (): ClashStyle => (load().clashStyle === "classic" ? "classic" : "heavy");
export const saveClashStyle = (clashStyle: ClashStyle) => save({ clashStyle });
export const loadBest = (): PersonalBest => load().best ?? { peakMaxSpin: 0, knockouts: 0 };

/** Records a finished life; returns true if it set a new personal best on either measure. */
export function recordLife(life: PersonalBest): boolean {
  const best = loadBest();
  const improved = life.peakMaxSpin > best.peakMaxSpin || life.knockouts > best.knockouts;
  if (improved) {
    save({
      best: {
        peakMaxSpin: Math.max(best.peakMaxSpin, life.peakMaxSpin),
        knockouts: Math.max(best.knockouts, life.knockouts),
      },
    });
  }
  return improved;
}
