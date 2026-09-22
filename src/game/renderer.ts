import { CONFIG, radiusOf, type KnockoutCause, type SimEvent, type Top, type TopId, type Vec, type World } from "../sim";
import { drawTop, withAlpha } from "./art";
import { viewSize } from "./viewport";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "spark" | "flare" | "shard" | "shockwave";
  angle: number;
  spinRate: number;
}

/** A knocked-out Top still being shown as it flies out of the stadium or topples over. */
interface Fading {
  top: Top;
  angle: number;
  kind: "ring-out" | "spin-out";
  t: number;
}

interface TopVisual {
  angle: number;
  trail: Vec[];
  top: Top;
  /** Seconds left of the post-Dash energy aura. */
  aura: number;
}

/** A big anime callout ("BURST FINISH!") stamped over the action. */
interface Callout {
  text: string;
  at: Vec;
  color: string;
  t: number;
  big: boolean;
}

const TRAIL_LENGTH = 16;
const FINISH: Record<KnockoutCause, string> = {
  burst: "BURST FINISH!",
  "ring-out": "OVER FINISH!",
  "spin-out": "SPIN FINISH!",
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Draws the world in an anime battle style. It only reads simulation state; every
 * visual-only effect (spin blur, auras, sparks, impact frames, camera) lives here (ADR 0002).
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private mini: CanvasRenderingContext2D;
  private visuals = new Map<TopId, TopVisual>();
  private particles: Particle[] = [];
  private fading: Fading[] = [];
  private callouts: Callout[] = [];
  private cam = { x: 0, y: 0, zoom: 0.6 };
  private shake = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private clock = 0;
  /** The impact frame: radial speed lines centred on one of the Player's big hits. */
  private impact = { t: 0, at: { x: 0, y: 0 } as Vec, strength: 0 };
  /** Seconds the action should freeze for, to sell a heavy hit. The game loop reads this. */
  hitStop = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    minimap: HTMLCanvasElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.mini = minimap.getContext("2d")!;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    ({ width: this.width, height: this.height } = viewSize());
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
  }

  worldToScreen(p: Vec): Vec {
    return {
      x: (p.x - this.cam.x) * this.cam.zoom + this.width / 2,
      y: (p.y - this.cam.y) * this.cam.zoom + this.height / 2,
    };
  }

  react(events: SimEvent[], playerId: TopId | null) {
    for (const e of events) {
      if (e.type === "clash") {
        const a = this.visuals.get(e.a)?.top;
        const b = this.visuals.get(e.b)?.top;
        const power = Math.min(1, e.impact / 700);
        const involvesPlayer = e.a === playerId || e.b === playerId;
        // Other Tops' clashes stay small, so a busy stadium doesn't drown the Player's own fight.
        const scale = involvesPlayer ? 1 : 0.5;
        const count = Math.round((5 + power * 30) * scale);
        for (let i = 0; i < count; i++) this.spark(e.at, 250 + e.impact * 1.1, i % 5 === 0 ? "#ffffff" : i % 2 ? "#ffd23f" : "#ff8a1f");
        this.flare(e.at, (16 + power * 40) * scale, "#fff4c2", 0.15);
        if (a) this.flare(e.at, (12 + power * 30) * scale, a.color, 0.2);
        if (b) this.flare(e.at, (12 + power * 30) * scale, b.color, 0.2);
        if (e.impact > 300) this.shockwave(e.at, (20 + power * 60) * scale, "#ffffff");
        if (involvesPlayer) {
          this.shake = Math.min(14, this.shake + e.impact / 70);
          if (e.impact > 500) this.impactFrame(e.at, power, 0.04);
        }
      } else if (e.type === "knockout") {
        const visual = this.visuals.get(e.victim);
        if (!visual) continue;
        this.visuals.delete(e.victim);
        const t = visual.top;
        const r = radiusOf(t);
        const mine = e.victim === playerId || e.credit === playerId;
        if (e.cause === "burst") {
          for (let i = 0; i < 26; i++) this.shard(e.at, t.color, r);
          for (let i = 0; i < (mine ? 50 : 25); i++) this.spark(e.at, 900, i % 3 ? "#ffd23f" : "#ffffff");
          this.flare(e.at, r * (mine ? 3.5 : 2.5), t.color, 0.4);
          this.shockwave(e.at, r * 5, t.color);
          if (mine) this.impactFrame(e.at, 1, 0.08);
        } else {
          this.fading.push({ top: t, angle: visual.angle, kind: e.cause, t: 0 });
          if (e.cause === "ring-out") this.shockwave(e.at, r * 3, "#ff3b5c");
        }
        this.callouts.push({ text: FINISH[e.cause], at: { ...e.at }, color: t.color, t: 0, big: mine });
        if (e.victim === playerId) this.shake = 24;
      } else if (e.type === "dash") {
        const v = this.visuals.get(e.top);
        if (!v) continue;
        v.aura = 0.6;
        this.shockwave(v.top.pos, radiusOf(v.top) * 2.2, v.top.color);
      } else if (e.type === "pickup" && e.top === playerId) {
        this.flare(e.at, 26, "#7dfcff", 0.3);
      }
    }
  }

  private spark(at: Vec, speed: number, color: string) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.25 + Math.random() * 0.75);
    this.particles.push({
      x: at.x, y: at.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.18 + Math.random() * 0.35, maxLife: 0.5, size: 1.5 + Math.random() * 2.5,
      color, kind: "spark", angle: 0, spinRate: 0,
    });
  }

  private flare(at: Vec, size: number, color: string, life: number) {
    this.particles.push({ x: at.x, y: at.y, vx: 0, vy: 0, life, maxLife: life, size, color, kind: "flare", angle: 0, spinRate: 0 });
  }

  private shockwave(at: Vec, size: number, color: string) {
    this.particles.push({ x: at.x, y: at.y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35, size, color, kind: "shockwave", angle: 0, spinRate: 0 });
  }

  private shard(at: Vec, color: string, r: number) {
    const a = Math.random() * Math.PI * 2;
    const s = 200 + Math.random() * 600;
    this.particles.push({
      x: at.x, y: at.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.7 + Math.random() * 0.7, maxLife: 1.4, size: r * (0.25 + Math.random() * 0.35),
      color: Math.random() < 0.3 ? "#c9d0e0" : color, kind: "shard",
      angle: Math.random() * 6, spinRate: (Math.random() - 0.5) * 30,
    });
  }

  private impactFrame(at: Vec, strength: number, freeze: number) {
    if (reducedMotion) return;
    this.impact = { t: 0.16, at: { ...at }, strength };
    this.hitStop = Math.max(this.hitStop, freeze);
  }

  render(world: World, player: Top | null, dt: number) {
    this.clock += dt;
    this.updateVisuals(world, dt);
    this.updateCamera(player, dt);
    this.updateParticles(dt);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const sx = reducedMotion ? 0 : (Math.random() - 0.5) * this.shake;
    const sy = reducedMotion ? 0 : (Math.random() - 0.5) * this.shake;
    this.shake *= Math.pow(0.002, dt);

    ctx.save();
    ctx.translate(this.width / 2 + sx, this.height / 2 + sy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawStadium();
    this.drawPickups(world);
    this.drawTrails();
    this.drawFading(dt);
    for (const v of this.visuals.values()) this.drawTopAt(world, v, v.top === player);
    this.drawParticles();
    this.drawCallouts(dt, false);
    ctx.restore();

    this.drawImpactFrame(dt);
    this.drawCallouts(0, true);
    this.drawMinimap(world, player);
  }

  private updateVisuals(world: World, dt: number) {
    const seen = new Set<TopId>();
    for (const t of world.tops) {
      if (!t.alive) continue;
      seen.add(t.id);
      let v = this.visuals.get(t.id);
      if (!v) {
        v = { angle: Math.random() * 6, trail: [], top: t, aura: 0 };
        this.visuals.set(t.id, v);
      }
      v.top = t;
      v.angle += spinRate(t) * dt;
      v.aura = Math.max(0, v.aura - dt);
      v.trail.unshift({ x: t.pos.x, y: t.pos.y });
      if (v.trail.length > TRAIL_LENGTH) v.trail.pop();
    }
    for (const id of this.visuals.keys()) if (!seen.has(id)) this.visuals.delete(id);
  }

  private updateCamera(player: Top | null, dt: number) {
    const base = Math.min(this.width, this.height) / 1000;
    let target: Vec;
    let zoom: number;
    if (player) {
      target = player.pos;
      zoom = base * Math.pow(CONFIG.baseRadius / radiusOf(player), 0.6) * 1.5;
    } else {
      const a = this.clock * 0.05;
      target = { x: Math.cos(a) * CONFIG.arenaRadius * 0.4, y: Math.sin(a) * CONFIG.arenaRadius * 0.4 };
      zoom = base * 0.55;
    }
    const follow = 1 - Math.pow(0.0005, dt);
    this.cam.x += (target.x - this.cam.x) * follow;
    this.cam.y += (target.y - this.cam.y) * follow;
    this.cam.zoom += (zoom - this.cam.zoom) * (1 - Math.pow(0.05, dt));
  }

  private updateParticles(dt: number) {
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = p.kind === "spark" ? 0.05 : 0.2;
      p.vx *= Math.pow(drag, dt);
      p.vy *= Math.pow(drag, dt);
      p.angle += p.spinRate * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private view() {
    const hw = this.width / 2 / this.cam.zoom + 80;
    const hh = this.height / 2 / this.cam.zoom + 80;
    return { x0: this.cam.x - hw, y0: this.cam.y - hh, x1: this.cam.x + hw, y1: this.cam.y + hh };
  }

  /** A steel stadium bowl: deep blue dish, machined grooves, a spiral ridge and a heavy rim wall. */
  private drawStadium() {
    const ctx = this.ctx;
    const R = CONFIG.arenaRadius;
    const v = this.view();

    ctx.fillStyle = "#05070d";
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);
    const glow = ctx.createRadialGradient(0, 0, R, 0, 0, R * 1.8);
    glow.addColorStop(0, "rgba(40, 70, 160, 0.35)");
    glow.addColorStop(1, "rgba(5, 7, 13, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(v.x0, v.y0, v.x1 - v.x0, v.y1 - v.y0);

    // Dish: lit from above, darker toward the wall, like a bowl.
    const dish = ctx.createRadialGradient(-R * 0.15, -R * 0.2, R * 0.05, 0, 0, R);
    dish.addColorStop(0, "#3d5fb8");
    dish.addColorStop(0.45, "#223f8a");
    dish.addColorStop(0.85, "#142659");
    dish.addColorStop(1, "#0a1433");
    ctx.fillStyle = dish;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    ctx.lineWidth = 3;
    for (let r = 160; r < R; r += 110) {
      ctx.strokeStyle = `rgba(160, 200, 255, ${0.05 + (r / R) * 0.05})`;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Spiral "tornado ridge".
    ctx.lineWidth = 18;
    ctx.strokeStyle = "rgba(120, 170, 255, 0.12)";
    for (let arm = 0; arm < 3; arm++) {
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const k = i / 60;
        const a = arm * ((Math.PI * 2) / 3) + k * Math.PI * 1.4;
        const r = 250 + k * (R - 450);
        if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.stroke();
    }

    // Centre cone.
    const cone = ctx.createRadialGradient(-20, -20, 0, 0, 0, 120);
    cone.addColorStop(0, "#9fb8ff");
    cone.addColorStop(1, "rgba(60, 90, 180, 0)");
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.arc(0, 0, 120, 0, Math.PI * 2);
    ctx.fill();

    // Danger glow just inside the wall.
    const danger = ctx.createRadialGradient(0, 0, R * 0.88, 0, 0, R);
    danger.addColorStop(0, "rgba(255, 40, 80, 0)");
    danger.addColorStop(1, `rgba(255, 40, 80, ${0.22 + Math.sin(this.clock * 4) * 0.06})`);
    ctx.fillStyle = danger;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // Rim wall: brushed steel with dark notches, and a hot red lip where Tops fly out.
    const wall = ctx.createLinearGradient(-R, -R, R, R);
    wall.addColorStop(0, "#e9eef8");
    wall.addColorStop(0.3, "#7d879c");
    wall.addColorStop(0.5, "#dfe5f1");
    wall.addColorStop(0.75, "#4d566b");
    wall.addColorStop(1, "#b9c1d3");
    ctx.lineWidth = 70;
    ctx.strokeStyle = wall;
    ctx.beginPath();
    ctx.arc(0, 0, R + 35, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#0a0d16";
    ctx.beginPath();
    ctx.arc(0, 0, R + 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#0a0d16";
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.fillRect(R + 8, -5, 54, 10);
      ctx.restore();
    }
    ctx.save();
    ctx.shadowColor = "#ff2850";
    ctx.shadowBlur = 30;
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#ff3b5c";
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPickups(world: World) {
    const ctx = this.ctx;
    const v = this.view();
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of world.pickups) {
      if (p.pos.x < v.x0 || p.pos.x > v.x1 || p.pos.y < v.y0 || p.pos.y > v.y1) continue;
      const pulse = 0.75 + Math.sin(this.clock * 5 + p.id) * 0.25;
      const g = ctx.createRadialGradient(p.pos.x, p.pos.y, 0, p.pos.x, p.pos.y, 22 * pulse);
      g.addColorStop(0, "rgba(220, 255, 255, 0.95)");
      g.addColorStop(0.25, "rgba(60, 230, 255, 0.6)");
      g.addColorStop(1, "rgba(0, 150, 255, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(p.pos.x - 22, p.pos.y - 22, 44, 44);
    }
    ctx.restore();
  }

  /** Glowing ribbons behind moving Tops, and speed lines while an aura burns. */
  private drawTrails() {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const { trail, top, aura } of this.visuals.values()) {
      const speed = Math.hypot(top.vel.x, top.vel.y);
      if (trail.length < 2 || speed < 50) continue;
      const r = radiusOf(top);
      for (let i = 1; i < trail.length; i++) {
        const k = 1 - i / trail.length;
        ctx.strokeStyle = withAlpha(top.color, 0.45 * k * Math.min(1, speed / 400) + aura * 0.4 * k);
        ctx.lineWidth = r * 1.5 * k;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
      if (aura > 0) {
        const back = Math.atan2(-top.vel.y, -top.vel.x);
        ctx.strokeStyle = withAlpha("#ffffff", aura);
        ctx.lineWidth = 3;
        for (let i = 0; i < 6; i++) {
          const off = (i - 2.5) * r * 0.35;
          const sx = top.pos.x + Math.cos(back + Math.PI / 2) * off + Math.cos(back) * r;
          const sy = top.pos.y + Math.sin(back + Math.PI / 2) * off + Math.sin(back) * r;
          const len = r * (2 + ((i * 37) % 5) * 0.6);
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + Math.cos(back) * len, sy + Math.sin(back) * len);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawTopAt(world: World, v: TopVisual, isPlayer: boolean) {
    const ctx = this.ctx;
    const t = v.top;
    const r = radiusOf(t);
    const frac = t.spin / t.maxSpin;
    const wobble = frac < 0.3 ? (0.3 - frac) * r * 0.6 : 0;
    const x = t.pos.x + Math.cos(this.clock * 14 + t.id) * wobble;
    const y = t.pos.y + Math.sin(this.clock * 12 + t.id) * wobble;

    ctx.save();
    ctx.translate(x, y);

    // Energy aura: always a faint glow, flaring after a Dash.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const auraSize = r * (1.7 + v.aura * 1.5);
    const aura = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, auraSize);
    aura.addColorStop(0, withAlpha(t.color, 0.35 + v.aura * 0.6));
    aura.addColorStop(1, withAlpha(t.color, 0));
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, auraSize, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "rgba(0, 0, 10, 0.45)";
    ctx.beginPath();
    ctx.ellipse(r * 0.18, r * 0.25, r * 1.02, r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // Spin blur: ghost copies trailing the rotation, stronger the faster it spins.
    const blur = Math.min(1, frac * 1.2);
    drawTop(ctx, t.type, t.color, r, v.angle - 0.5, 0.18 * blur);
    drawTop(ctx, t.type, t.color, r, v.angle - 0.25, 0.3 * blur);
    drawTop(ctx, t.type, t.color, r, v.angle);

    // Fixed specular highlight: the light doesn't spin with the Top.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = r * 0.12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.82, Math.PI * 1.1, Math.PI * 1.45);
    ctx.stroke();
    ctx.restore();

    // Spin gauge.
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, r * 0.1);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = frac < 0.3 ? "#ff3b5c" : isPlayer ? "#7dfcff" : t.color;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.32, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();

    if (world.time < t.protectedUntil) {
      ctx.save();
      ctx.rotate(this.clock * 2);
      ctx.setLineDash([r * 0.4, r * 0.25]);
      ctx.strokeStyle = `rgba(125, 252, 255, ${0.5 + Math.sin(this.clock * 10) * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const size = Math.max(14, Math.min(28, r * 0.55));
    ctx.font = `italic 800 ${size}px "Exo 2", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(5, 7, 13, 0.85)";
    ctx.strokeText(t.name, 0, -r * 1.6 - 6);
    ctx.fillStyle = isPlayer ? "#ffffff" : "rgba(230, 236, 255, 0.85)";
    ctx.fillText(t.name, 0, -r * 1.6 - 6);
    ctx.restore();
  }

  private drawFading(dt: number) {
    const ctx = this.ctx;
    for (const f of this.fading) {
      f.t += dt;
      const r = radiusOf(f.top);
      ctx.save();
      ctx.translate(f.top.pos.x, f.top.pos.y);
      let alpha: number;
      if (f.kind === "ring-out") {
        // Launched out of the stadium, tumbling away.
        const out = Math.hypot(f.top.pos.x, f.top.pos.y) || 1;
        ctx.translate((f.top.pos.x / out) * f.t * 500, (f.top.pos.y / out) * f.t * 500);
        ctx.scale(1 + f.t * 0.5, 1 - f.t * 0.4);
        alpha = Math.max(0, 1 - f.t / 1.1);
        f.angle += 20 * dt;
      } else {
        ctx.scale(1, 1 - Math.min(0.55, f.t * 0.7));
        alpha = Math.max(0, 1 - f.t / 1.4);
        f.angle += Math.max(0, 3 - f.t * 3) * dt;
      }
      drawTop(ctx, f.top.type, f.top.color, r, f.angle, alpha);
      ctx.restore();
    }
    this.fading = this.fading.filter((f) => f.t < 1.4);
  }

  private drawParticles() {
    const ctx = this.ctx;
    ctx.save();
    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.maxLife);
      if (p.kind === "spark") {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = withAlpha(p.color, Math.min(1, k * 2));
        ctx.lineWidth = p.size;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045);
        ctx.stroke();
      } else if (p.kind === "flare") {
        ctx.globalCompositeOperation = "lighter";
        const size = p.size * (1 + (1 - k) * 0.6);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
        g.addColorStop(0, withAlpha(p.color, 0.9 * k));
        g.addColorStop(1, withAlpha(p.color, 0));
        ctx.fillStyle = g;
        ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
      } else if (p.kind === "shockwave") {
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = withAlpha(p.color, k * 0.9);
        ctx.lineWidth = 3 + k * 8;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.3 + (1 - k) * 1.2), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.strokeStyle = "#0a0d16";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.8, p.size * 0.5);
        ctx.lineTo(-p.size * 0.5, p.size * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  /** A split-second anime impact frame: thin radial speed lines around the Player's big hit. */
  private drawImpactFrame(dt: number) {
    if (this.impact.t <= 0) return;
    this.impact.t -= dt;
    const ctx = this.ctx;
    const k = Math.max(0, this.impact.t / 0.16);
    const c = this.worldToScreen(this.impact.at);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.35 * k * (0.5 + this.impact.strength * 0.5)})`;
    const far = Math.hypot(this.width, this.height);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2 + ((i * 97) % 7) * 0.03;
      const inner = 160 + ((i * 53) % 9) * 30;
      ctx.lineWidth = 1 + ((i * 31) % 2);
      ctx.beginPath();
      ctx.moveTo(c.x + Math.cos(a) * inner, c.y + Math.sin(a) * inner);
      ctx.lineTo(c.x + Math.cos(a) * far, c.y + Math.sin(a) * far);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** "BURST FINISH!" and friends: stamped in, held, then gone. Big ones for the Player's fights sit on screen. */
  private drawCallouts(dt: number, screenSpace: boolean) {
    const ctx = this.ctx;
    if (!screenSpace) for (const c of this.callouts) c.t += dt;
    for (const c of this.callouts) {
      if (c.big !== screenSpace) continue;
      const pop = c.t < 0.12 ? 1.6 - (c.t / 0.12) * 0.6 : 1;
      const alpha = c.t > 1.1 ? Math.max(0, 1 - (c.t - 1.1) / 0.3) : 1;
      const pos = screenSpace ? { x: this.width / 2, y: this.height * 0.3 } : { x: c.at.x, y: c.at.y - 60 };
      const size = screenSpace ? Math.min(96, this.width / 9, this.height / 7) : 44;
      ctx.save();
      ctx.translate(pos.x, pos.y);
      ctx.rotate(-0.08);
      ctx.scale(pop, pop);
      ctx.globalAlpha = alpha;
      ctx.font = `${size}px "Bangers", Impact, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = size * 0.22;
      ctx.strokeStyle = "#0a0d16";
      ctx.strokeText(c.text, 0, 0);
      const fill = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
      fill.addColorStop(0, "#fff7c2");
      fill.addColorStop(0.5, "#ffd23f");
      fill.addColorStop(1, "#ff6a1f");
      ctx.fillStyle = fill;
      ctx.fillText(c.text, 0, 0);
      ctx.restore();
    }
    this.callouts = this.callouts.filter((c) => c.t < 1.4);
  }

  private drawMinimap(world: World, player: Top | null) {
    const m = this.mini;
    const size = m.canvas.width;
    const scale = (size / 2 - 8) / CONFIG.arenaRadius;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.clearRect(0, 0, size, size);
    m.translate(size / 2, size / 2);
    m.fillStyle = "rgba(20, 38, 89, 0.85)";
    m.strokeStyle = "#ff3b5c";
    m.lineWidth = 3;
    m.beginPath();
    m.arc(0, 0, CONFIG.arenaRadius * scale, 0, Math.PI * 2);
    m.fill();
    m.stroke();
    for (const t of world.tops) {
      if (!t.alive || t === player || t.maxSpin <= CONFIG.startMaxSpin) continue;
      m.fillStyle = t.color;
      m.beginPath();
      m.arc(t.pos.x * scale, t.pos.y * scale, 2.5 + Math.sqrt(t.maxSpin / CONFIG.startMaxSpin) * 1.5, 0, Math.PI * 2);
      m.fill();
    }
    if (player?.alive) {
      m.fillStyle = "#ffffff";
      m.shadowColor = "#7dfcff";
      m.shadowBlur = 8;
      m.beginPath();
      m.arc(player.pos.x * scale, player.pos.y * scale, 4, 0, Math.PI * 2);
      m.fill();
      m.shadowBlur = 0;
    }
  }
}

function spinRate(t: Top): number {
  return 4 + 30 * (t.spin / t.maxSpin);
}
