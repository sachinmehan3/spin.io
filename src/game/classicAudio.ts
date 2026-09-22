import type { SimEvent, Top, Vec } from "../sim";

/** Sounds further than this (world px) from the Player are silent. */
const HEARING = 1400;

/**
 * The classic sound set: the game's original effects, kept as they were so players can choose
 * them over the recorded set in audio.ts. Synthesised with the Web Audio API: no audio files.
 * The context is created on the first user gesture, as browsers require.
 */
export class ClassicSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Call from a user gesture (e.g. the Play button). */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(this.ctx.destination);

    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.hum = { osc, gain, filter };
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.6, this.ctx.currentTime, 0.02);
  }

  /** The Player's own spinning hum: pitch and brightness follow Spin. */
  updateHum(player: Top | null) {
    if (!this.ctx || !this.hum) return;
    const now = this.ctx.currentTime;
    const frac = player?.alive ? player.spin / player.maxSpin : 0;
    this.hum.osc.frequency.setTargetAtTime(45 + frac * 70, now, 0.1);
    this.hum.filter.frequency.setTargetAtTime(200 + frac * 900, now, 0.1);
    this.hum.gain.gain.setTargetAtTime(player?.alive ? 0.035 + frac * 0.03 : 0, now, 0.15);
  }

  react(events: SimEvent[], player: Top | null, listener: Vec) {
    if (!this.ctx) return;
    const pid = player?.id ?? null;
    for (const e of events) {
      if (e.type === "clash") {
        const near = this.nearness(e.at, listener, e.a === pid || e.b === pid);
        if (near > 0) this.clink(Math.min(1, e.impact / 700) * near);
      } else if (e.type === "dash" && e.top === pid) {
        this.whoosh();
      } else if (e.type === "pickup" && e.top === pid) {
        this.blip();
      } else if (e.type === "knockout") {
        const mine = e.victim === pid;
        const near = this.nearness(e.at, listener, mine);
        if (near <= 0) continue;
        if (e.cause === "burst") this.crunch(near);
        else if (e.cause === "ring-out") this.fall(near);
        else this.windDown(near);
        if (e.credit !== null && e.credit === pid) this.fanfare();
      }
    }
  }

  private nearness(at: Vec, listener: Vec, involvesPlayer: boolean): number {
    if (involvesPlayer) return 1;
    const d = Math.hypot(at.x - listener.x, at.y - listener.y);
    return Math.max(0, 1 - d / HEARING) * 0.7;
  }

  private tone(freq: number, endFreq: number, duration: number, volume: number, type: OscillatorType, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private burstOfNoise(duration: number, volume: number, filterFreq: number, filterEnd = filterFreq) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(filterFreq, t);
    filter.frequency.exponentialRampToValueAtTime(filterEnd, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(this.master!);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  private clink(strength: number) {
    if (strength < 0.03) return;
    const f = 1800 + Math.random() * 1400;
    this.tone(f, f * 0.9, 0.18, 0.25 * strength, "triangle");
    this.tone(f * 1.51, f * 1.4, 0.12, 0.12 * strength, "sine");
    this.burstOfNoise(0.06, 0.3 * strength, 3000);
  }

  private whoosh() {
    this.burstOfNoise(0.3, 0.35, 600, 2400);
  }

  private blip() {
    this.tone(880, 1320, 0.07, 0.06, "sine");
  }

  private crunch(near: number) {
    this.burstOfNoise(0.45, 0.6 * near, 1400, 200);
    this.tone(300, 60, 0.4, 0.25 * near, "square");
  }

  private fall(near: number) {
    this.tone(900, 120, 0.7, 0.18 * near, "sine");
  }

  private windDown(near: number) {
    this.tone(180, 40, 0.9, 0.2 * near, "sawtooth");
  }

  private fanfare() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.16, 0.12, "triangle", i * 0.07));
  }
}
