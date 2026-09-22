import type { SimEvent, Top, TopId, Vec } from "../sim";
import spriteUrl from "./sfx/beyblade.mp3";
import { ALIGN_LEVEL, CLIPS, FIRST_LOUD_AT, SPRITE_RATE } from "./sfx/clips";

/** Sounds further than this (world px) from the Player are silent. */
const HEARING = 1400;
/** Master volume when not muted. */
const VOLUME = 0.7;
/** Inharmonic partials of a struck metal plate: what makes a Clash ring instead of beep. */
const METAL_PARTIALS = [1, 2.76, 5.4, 8.93];
/** At most this many Clash sounds start in any CLASH_WINDOW seconds, so a pile-up doesn't turn into mush. */
const MAX_CLASHES = 5;
const CLASH_WINDOW = 0.1;
/** Clashes between the same two Tops closer together than this are one grinding contact, not new hits. */
const CONTACT_GAP = 0.15;

/** Heavy: recorded Beyblade collisions. Classic: the original synthesised metal tink. */
export type ClashStyle = "heavy" | "classic";

type Hum = {
  oscs: OscillatorNode[];
  filter: BiquadFilterNode;
  level: GainNode;
  lfo: OscillatorNode;
  lfoDepth: GainNode;
};

/**
 * Sound effects: clips recorded from real Beyblade X battles (see scripts/build_sfx.py), layered
 * with sounds synthesised with the Web Audio API. Until the recordings are loaded, or if they
 * fail to, the synthesised sounds stand in alone. The context is created on the first user
 * gesture, as browsers require.
 *
 * Everything runs through a compressor (so stacked hits don't clip) and a short synthetic
 * reverb (so the arena sounds like a room). Sounds are panned by where they happen.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverb: GainNode | null = null;
  private hum: Hum | null = null;
  private spinLoop: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noise: AudioBuffer | null = null;
  private recentClashes: number[] = [];
  private lastContact = new Map<string, number>();
  /** Fetched straight away (no gesture needed); decoded once the context exists. */
  private spriteFile: Promise<ArrayBuffer | null> = fetch(spriteUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);
  private samplesLoaded: Promise<void> = Promise.resolve();
  private samples = new Map<string, AudioBuffer[]>();
  muted = false;
  clashStyle: ClashStyle = "heavy";

  /** Call from a user gesture (e.g. the Play button). */
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 10;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;
    compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : VOLUME;
    this.master.connect(compressor);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Reverb: a decaying burst of stereo noise as the impulse response.
    const convolver = ctx.createConvolver();
    const length = Math.floor(ctx.sampleRate * 1.3);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    convolver.buffer = impulse;
    this.reverb = ctx.createGain();
    this.reverb.gain.value = 0.22;
    this.reverb.connect(convolver).connect(this.master);

    this.hum = this.createHum(ctx);
    this.samplesLoaded = this.loadSamples(ctx);
  }

  /** The Player's Top leaves the launcher. */
  launch() {
    const ctx = this.ctx;
    if (!ctx) return;
    const asked = ctx.currentTime;
    // On the very first Play the recordings may still be decoding; play if they land promptly.
    void this.samplesLoaded.then(() => {
      if (ctx.currentTime - asked < 0.4) this.sample("launch", this.output(0, 0.5), 0.8);
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : VOLUME, this.ctx.currentTime, 0.02);
  }

  /**
   * The Player's own spinning hum. Pitch and brightness follow Spin, and it wobbles faster as
   * the Top spins faster, and deeper as it weakens, so low Spin is audible.
   */
  updateHum(player: Top | null) {
    if (!this.ctx || !this.hum) return;
    const now = this.ctx.currentTime;
    const alive = player?.alive ?? false;
    const frac = alive ? player!.spin / player!.maxSpin : 0;
    const base = 45 + frac * 75;
    this.hum.oscs[0].frequency.setTargetAtTime(base, now, 0.1);
    this.hum.oscs[1].frequency.setTargetAtTime(base * 1.007, now, 0.1);
    this.hum.oscs[2].frequency.setTargetAtTime(base * 2, now, 0.1);
    this.hum.filter.frequency.setTargetAtTime(180 + frac * 1100, now, 0.1);
    this.hum.lfo.frequency.setTargetAtTime(4 + frac * 14, now, 0.2);
    const level = alive ? 0.03 + frac * 0.03 : 0;
    this.hum.level.gain.setTargetAtTime(level, now, 0.15);
    this.hum.lfoDepth.gain.setTargetAtTime(level * (0.15 + (1 - frac) * 0.6), now, 0.15);
    if (this.spinLoop) {
      this.spinLoop.source.playbackRate.setTargetAtTime(0.7 + frac * 0.5, now, 0.1);
      this.spinLoop.gain.gain.setTargetAtTime(1.5 + frac * 1.5, now, 0.15);
    }
  }

  react(events: SimEvent[], player: Top | null, listener: Vec) {
    if (!this.ctx) return;
    const pid = player?.id ?? null;
    for (const e of events) {
      if (e.type === "clash") {
        const near = this.nearness(e.at, listener, e.a === pid || e.b === pid);
        if (near > 0 && this.claimClashVoice()) {
          const impact = Math.min(1, e.impact / 700);
          const pan = this.panOf(e.at, listener);
          if (this.clashStyle === "classic") this.tink(impact * near, pan);
          else this.clink(impact, near, pan, this.freshContact(e.a, e.b));
        }
      } else if (e.type === "dash" && e.top === pid) {
        this.whoosh();
      } else if (e.type === "pickup" && e.top === pid) {
        this.blip();
      } else if (e.type === "knockout") {
        const mine = e.victim === pid;
        const near = this.nearness(e.at, listener, mine);
        if (near <= 0) continue;
        const pan = this.panOf(e.at, listener);
        if (e.cause === "burst") this.crunch(near, pan);
        else if (e.cause === "ring-out") this.fall(near, pan);
        else this.windDown(near, pan);
        if (e.credit !== null && e.credit === pid) this.fanfare();
      }
    }
  }

  // ---------- Plumbing ----------

  private createHum(ctx: AudioContext): Hum {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;
    filter.Q.value = 3;
    const level = ctx.createGain();
    level.gain.value = 0;
    filter.connect(level).connect(this.master!);

    // Two detuned saws beat against each other; a quiet octave adds body.
    const oscs = [0.5, 0.5, 0.25].map((mix) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      const g = ctx.createGain();
      g.gain.value = mix;
      osc.connect(g).connect(filter);
      osc.start();
      return osc;
    });

    // Tremolo: the wobble of a spinning Top.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 8;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth).connect(level.gain);
    lfo.start();

    return { oscs, filter, level, lfo, lfoDepth };
  }

  /** Decodes the recorded sprite and cuts it into one buffer per clip, then starts the spin loop. */
  private async loadSamples(ctx: AudioContext) {
    const file = await this.spriteFile;
    if (!file) return;
    let sprite: AudioBuffer;
    try {
      sprite = await ctx.decodeAudioData(file);
    } catch {
      return;
    }
    const data = sprite.getChannelData(0);
    const scale = sprite.sampleRate / SPRITE_RATE;
    let firstLoud = 0;
    while (firstLoud < data.length && Math.abs(data[firstLoud]) <= ALIGN_LEVEL) firstLoud++;
    const shift = firstLoud - Math.round(FIRST_LOUD_AT * scale);

    for (const clip of CLIPS) {
      const start = Math.max(0, Math.round(clip.start * scale) + shift);
      const length = Math.min(Math.round(clip.length * scale), data.length - start);
      if (length <= 0) continue;
      const buffer = ctx.createBuffer(1, length, sprite.sampleRate);
      buffer.copyToChannel(data.subarray(start, start + length), 0);
      const list = this.samples.get(clip.name) ?? [];
      list.push(buffer);
      this.samples.set(clip.name, list);
    }

    const spin = this.samples.get("spin")?.[0];
    if (spin && this.hum) {
      const source = ctx.createBufferSource();
      source.buffer = spin;
      source.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      // Joins the hum after its lowpass (which would dull the recording) but before its wobble.
      source.connect(gain).connect(this.hum.level);
      source.start();
      this.spinLoop = { source, gain };
    }
  }

  /** Plays a random recorded clip of this name. False if none is loaded, so the caller can synthesise instead. */
  private sample(name: string, out: AudioNode, volume: number, rate = 1, delay = 0): boolean {
    const list = this.samples.get(name);
    if (!list?.length) return false;
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(out);
    src.start(ctx.currentTime + delay);
    return true;
  }

  private nearness(at: Vec, listener: Vec, involvesPlayer: boolean): number {
    if (involvesPlayer) return 1;
    const d = Math.hypot(at.x - listener.x, at.y - listener.y);
    return Math.max(0, 1 - d / HEARING) * 0.7;
  }

  private panOf(at: Vec, listener: Vec): number {
    return Math.max(-0.8, Math.min(0.8, (at.x - listener.x) / (HEARING * 0.5)));
  }

  private claimClashVoice(): boolean {
    const now = this.ctx!.currentTime;
    this.recentClashes = this.recentClashes.filter((t) => now - t < CLASH_WINDOW);
    if (this.recentClashes.length >= MAX_CLASHES) return false;
    this.recentClashes.push(now);
    return true;
  }

  /** True unless this pair of Tops already clashed within CONTACT_GAP seconds (they're still grinding). */
  private freshContact(a: TopId, b: TopId): boolean {
    const now = this.ctx!.currentTime;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const last = this.lastContact.get(key);
    this.lastContact.set(key, now);
    if (this.lastContact.size > 64) {
      for (const [k, t] of this.lastContact) if (now - t > CONTACT_GAP) this.lastContact.delete(k);
    }
    return last === undefined || now - last > CONTACT_GAP;
  }

  /** Where a sound goes: panned, into the mix, with some of it sent to the reverb. */
  private output(pan = 0, wet = 1): AudioNode {
    const ctx = this.ctx!;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master!);
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      panner.connect(send).connect(this.reverb!);
    }
    return panner;
  }

  private tone(
    out: AudioNode,
    freq: number,
    endFreq: number,
    duration: number,
    volume: number,
    type: OscillatorType,
    delay = 0,
    attack = 0.002,
  ) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private noiseBurst(
    out: AudioNode,
    duration: number,
    volume: number,
    filterType: BiquadFilterType,
    filterFreq: number,
    filterEnd = filterFreq,
    delay = 0,
    q = 1,
  ) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(filterFreq, t);
    filter.frequency.exponentialRampToValueAtTime(filterEnd, t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + duration + 0.02);
  }

  /** A struck piece of metal: inharmonic partials, the higher ones dying first. */
  private ping(out: AudioNode, freq: number, duration: number, volume: number, delay = 0) {
    METAL_PARTIALS.forEach((ratio, i) => {
      this.tone(out, freq * ratio, freq * ratio * 0.995, duration / (1 + i * 0.8), volume / (1 + i * 1.3), "sine", delay);
    });
  }

  // ---------- Sounds ----------

  /**
   * Tops colliding. A fresh hit plays a real recorded collision, lighter or heavier to match the
   * impact (or a synthesised clang until the recordings load). Tops still in contact from a
   * moment ago only grind, so contact doesn't click.
   */
  private clink(impact: number, near: number, pan: number, fresh: boolean) {
    const strength = impact * near;
    if (strength < 0.03) return;
    const out = this.output(pan, 0.5 + impact * 0.6);
    this.grind(out, 0.07 + impact * 0.25, (fresh ? 0.25 : 0.2) * strength);
    if (!fresh) return;
    const tier = impact < 0.3 ? "light" : impact < 0.65 ? "medium" : "heavy";
    const played = this.sample(tier, out, near * (0.35 + 0.65 * impact), 0.9 + Math.random() * 0.25);
    if (!played && impact > 0.15) this.clang(out, impact, 0.16 * strength);
    if (impact > 0.5) {
      this.tone(out, 150, 45, 0.2, 0.4 * strength, "sine");
      this.noiseBurst(out, 0.15, 0.3 * strength, "lowpass", 900, 150);
    }
  }

  /** The classic Clash: a bright, light metal tink. */
  private tink(strength: number, pan: number) {
    if (strength < 0.03) return;
    const out = this.output(pan, 0.4);
    const f = 1800 + Math.random() * 1400;
    this.tone(out, f, f * 0.9, 0.18, 0.25 * strength, "triangle");
    this.tone(out, f * 1.51, f * 1.4, 0.12, 0.12 * strength, "sine");
    this.noiseBurst(out, 0.06, 0.3 * strength, "bandpass", 3000);
  }

  /** Spinning edges rubbing: bright noise chopped at the rate the Tops' teeth pass each other. */
  private grind(out: AudioNode, duration: number, volume: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(3200 + Math.random() * 1500, t);
    filter.frequency.exponentialRampToValueAtTime(1800, t + duration);
    const chop = ctx.createGain();
    chop.gain.value = 0.5;
    const teeth = ctx.createOscillator();
    teeth.type = "square";
    teeth.frequency.setValueAtTime(70 + Math.random() * 60, t);
    teeth.frequency.exponentialRampToValueAtTime(45, t + duration);
    const teethDepth = ctx.createGain();
    teethDepth.gain.value = 0.5;
    teeth.connect(teethDepth).connect(chop.gain);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(chop).connect(gain).connect(out);
    src.start(t, Math.random() * 0.5);
    teeth.start(t);
    src.stop(t + duration + 0.02);
    teeth.stop(t + duration + 0.02);
  }

  /** A harsh metal clang: FM with an inharmonic ratio, gritty at first and settling into a ring. */
  private clang(out: AudioNode, impact: number, volume: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const f = (1500 - impact * 700) * (0.9 + Math.random() * 0.2);
    const duration = 0.12 + impact * 0.3;
    for (const detune of [1, 1.013]) {
      const carrier = ctx.createOscillator();
      carrier.frequency.value = f * detune;
      const mod = ctx.createOscillator();
      mod.frequency.value = f * detune * 1.41;
      const index = ctx.createGain();
      index.gain.setValueAtTime(f * (1.5 + impact * 2.5), t);
      index.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.08);
      mod.connect(index).connect(carrier.frequency);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume / 2, t + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      carrier.connect(gain).connect(out);
      carrier.start(t);
      mod.start(t);
      carrier.stop(t + duration + 0.02);
      mod.stop(t + duration + 0.02);
    }
  }

  /** Dash: an air rush sweeping up, with a zip on top. */
  private whoosh() {
    const out = this.output(0, 0.4);
    this.noiseBurst(out, 0.32, 0.45, "bandpass", 400, 3200, 0, 1.5);
    this.tone(out, 260, 900, 0.18, 0.04, "sawtooth", 0.02, 0.03);
  }

  /** Pickup: a bright two-note chime. */
  private blip() {
    const out = this.output(0, 0.5);
    const f = 1320 * (0.97 + Math.random() * 0.06);
    this.tone(out, f, f, 0.12, 0.07, "triangle");
    this.tone(out, f * 1.5, f * 1.5, 0.18, 0.06, "triangle", 0.05);
  }

  /** Burst: a heavy crack, a pitch-dropping crunch, then pieces clattering away. */
  private crunch(near: number, pan: number) {
    const out = this.output(pan, 1.4);
    this.sample("heavy", out, near, 0.8);
    this.noiseBurst(out, 0.08, 0.8 * near, "highpass", 2000);
    this.noiseBurst(out, 0.5, 0.7 * near, "lowpass", 3000, 150);
    this.tone(out, 320, 50, 0.45, 0.28 * near, "square");
    this.tone(out, 90, 35, 0.5, 0.5 * near, "sine");
    for (let i = 0; i < 7; i++) {
      const delay = 0.08 + i * 0.07 + Math.random() * 0.05;
      this.ping(out, 1800 + Math.random() * 2400, 0.1, (0.1 - i * 0.012) * near, delay);
    }
  }

  /** Ring-out: a falling whistle, then a distant thud from far below the arena. */
  private fall(near: number, pan: number) {
    const out = this.output(pan, 1);
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(1300, t);
    osc.frequency.exponentialRampToValueAtTime(160, t + 0.8);
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 9;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 25;
    vibrato.connect(vibratoDepth).connect(osc.frequency);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16 * near, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    osc.connect(gain).connect(out);
    osc.start(t);
    vibrato.start(t);
    osc.stop(t + 0.9);
    vibrato.stop(t + 0.9);

    const far = this.output(pan, 2);
    this.tone(far, 110, 40, 0.3, 0.3 * near, "sine", 0.85);
    this.noiseBurst(far, 0.2, 0.25 * near, "lowpass", 500, 100, 0.85);
  }

  /** Spin-out: the Top wobbling down, rattling faster and faster as it tips, then a last clack. */
  private windDown(near: number, pan: number) {
    const out = this.output(pan, 0.8);
    this.tone(out, 170, 40, 1.1, 0.14 * near, "sawtooth", 0, 0.05);
    // A recording of a real Top toppling over, when loaded, in place of the synthesised rattle.
    if (this.sample("topple", out, 0.8 * near)) return;
    let at = 0;
    let gap = 0.16;
    for (let i = 0; i < 14; i++) {
      at += gap;
      gap *= 0.84;
      this.ping(out, 900 + i * 60, 0.05, 0.05 * near * (0.6 + i / 28), at);
      this.noiseBurst(out, 0.02, 0.12 * near, "bandpass", 2500, 2500, at, 2);
    }
    this.ping(out, 700, 0.25, 0.12 * near, at + 0.06);
    this.noiseBurst(out, 0.08, 0.25 * near, "lowpass", 1500, 300, at + 0.06);
  }

  /** The Player got the knockout: a quick arpeggio into a shimmering chord. */
  private fanfare() {
    const out = this.output(0, 1.2);
    [523, 659, 784].forEach((f, i) => this.tone(out, f, f, 0.14, 0.1, "triangle", i * 0.06));
    for (const f of [1046, 1318, 1568]) {
      this.tone(out, f, f, 0.7, 0.05, "triangle", 0.18, 0.01);
      this.tone(out, f * 1.004, f * 1.004, 0.7, 0.03, "sine", 0.18, 0.01);
    }
  }
}
