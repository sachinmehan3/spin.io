import type { SimEvent, Top, Vec } from "../sim";
import { Sound } from "./audio";
import { ClassicSound } from "./classicAudio";

/** Heavy: recorded Beyblade battles. Classic: the game's original synthesised set. */
export type SoundStyle = "heavy" | "classic";

/** Both sound sets behind one switch; only the chosen one plays. */
export class Sounds {
  private sets = { heavy: new Sound(), classic: new ClassicSound() };
  private unlocked = false;
  style: SoundStyle = "heavy";
  muted = false;

  private get active(): Sound | ClassicSound {
    return this.sets[this.style];
  }

  /** Call from a user gesture (e.g. the Play button). */
  unlock() {
    this.unlocked = true;
    this.active.unlock();
  }

  /** Call from a user gesture, so a set that hasn't played yet can start. */
  setStyle(style: SoundStyle) {
    if (style === this.style) return;
    this.active.updateHum(null);
    this.style = style;
    if (this.unlocked) this.active.unlock();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.sets.heavy.setMuted(muted);
    this.sets.classic.setMuted(muted);
  }

  launch() {
    if (this.active instanceof Sound) this.active.launch();
  }

  updateHum(player: Top | null) {
    this.active.updateHum(player);
  }

  react(events: SimEvent[], player: Top | null, listener: Vec) {
    this.active.react(events, player, listener);
  }
}
