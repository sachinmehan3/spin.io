import { CONFIG, radiusOf, type SimEvent, type Top, type TopId, type Vec, type World } from "../sim";
import { drawTopBody, withAlpha } from "./shapes";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  kind: "spark" | "shard" | "ring";
  angle: number;
  spinRate: number;
}

/** A knocked-out Top still being shown as it falls off the Rim or winds down. */
interface Fading {
  top: Top;
  angle: number;
  kind: "ring-out" | "spin-out";
  t: number;
}

/** What the renderer remembers about each Top between frames. Purely visual. */
interface Look {
  angle: number;
  trail: Vec[];
  top: Top;
}

const TRAIL_LENGTH = 14;

/**
 * Draws the world. It only reads simulation state; every visual-only effect (rotation,
 * trails, sparks, shatter, camera) lives here (ADR 0002).
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private mini: CanvasRenderingContext2D;
  private looks = new Map<TopId, Look>();
  private particles: Particle[] = [];
  private fading: Fading[] = [];
  private cam = { x: 0, y: 0, zoom: 0.6 };
  private shake = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private clock = 0;

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
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
  }

  /** Where a world point appears on screen, in CSS pixels. */
  worldToScreen(p: Vec): Vec {
    return {
      x: (p.x - this.cam.x) * this.cam.zoom + this.width / 2,
      y: (p.y - this.cam.y) * this.cam.zoom + this.height / 2,
    };
  }

  /** Turns simulation events into visual effects. */
  react(events: SimEvent[], playerId: TopId | null) {
    for (const e of events) {
      if (e.type === "clash") {
        const count = Math.min(40, 4 + e.impact / 25);
        const color = e.impact > 500 ? "#ffe45e" : "#ffffff";
        for (let i = 0; i < count; i++) this.spark(e.at, color, 150 + e.impact * 0.6);
        if (e.a === playerId || e.b === playerId) this.shake = Math.min(18, this.shake + e.impact / 60);
      } else if (e.type === "knockout") {
        const look = this.looks.get(e.victim);
        if (!look) continue;
        this.looks.delete(e.victim);
        if (e.cause === "burst") this.shatter(look.top, e.at);
        else this.fading.push({ top: look.top, angle: look.angle, kind: e.cause, t: 0 });
        if (e.victim === playerId) this.shake = 22;
      } else if (e.type === "dash") {
        const look = this.looks.get(e.top);
        if (!look) continue;
        const t = look.top;
        this.particles.push({
          x: t.pos.x, y: t.pos.y, vx: 0, vy: 0, life: 0.35, maxLife: 0.35,
          size: radiusOf(t), color: t.color, kind: "ring", angle: 0, spinRate: 0,
        });
      } else if (e.type === "pickup" && e.top === playerId) {
        for (let i = 0; i < 6; i++) this.spark(e.at, "#7bf1a8", 120);
      }
    }
  }

  private spark(at: Vec, color: string, speed: number) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.3 + Math.random() * 0.7);
    this.particles.push({
      x: at.x, y: at.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: 0.25 + Math.random() * 0.35, maxLife: 0.6, size: 1.5 + Math.random() * 2.5,
      color, kind: "spark", angle: 0, spinRate: 0,
    });
  }

  private shatter(top: Top, at: Vec) {
    const r = radiusOf(top);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 120 + Math.random() * 380;
      this.particles.push({
        x: at.x + Math.cos(a) * r * 0.5, y: at.y + Math.sin(a) * r * 0.5,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: 0.8 + Math.random() * 0.6, maxLife: 1.4, size: r * (0.2 + Math.random() * 0.3),
        color: i % 3 === 0 ? "#f4f6ff" : top.color, kind: "shard",
        angle: Math.random() * 6, spinRate: (Math.random() - 0.5) * 20,
      });
    }
    this.particles.push({
      x: at.x, y: at.y, vx: 0, vy: 0, life: 0.5, maxLife: 0.5,
      size: r * 1.2, color: top.color, kind: "ring", angle: 0, spinRate: 0,
    });
    for (let i = 0; i < 30; i++) this.spark(at, "#ffe45e", 500);
  }

  render(world: World, player: Top | null, dt: number) {
    this.clock += dt;
    this.updateLooks(world, dt);
    this.updateCamera(player, dt);
    this.updateParticles(dt);

    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = "#06070d";
    ctx.fillRect(0, 0, this.width, this.height);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.shake *= Math.pow(0.001, dt);

    ctx.save();
    ctx.translate(this.width / 2 + sx, this.height / 2 + sy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.translate(-this.cam.x, -this.cam.y);

    this.drawArena();
    this.drawPickups(world);
    this.drawFading(dt);
    this.drawTrails();
    for (const look of this.looks.values()) this.drawTop(world, look, look.top === player);
    this.drawParticles();
    ctx.restore();

    this.drawMinimap(world, player);
  }

  private updateLooks(world: World, dt: number) {
    const seen = new Set<TopId>();
    for (const t of world.tops) {
      if (!t.alive) continue;
      seen.add(t.id);
      let look = this.looks.get(t.id);
      if (!look) {
        look = { angle: Math.random() * 6, trail: [], top: t };
        this.looks.set(t.id, look);
      }
      look.top = t;
      look.angle += spinRate(t) * dt;
      look.trail.unshift({ x: t.pos.x, y: t.pos.y });
      if (look.trail.length > TRAIL_LENGTH) look.trail.pop();
    }
    for (const id of this.looks.keys()) if (!seen.has(id)) this.looks.delete(id);
  }

  private updateCamera(player: Top | null, dt: number) {
    const base = Math.min(this.width, this.height) / 1000;
    let target: Vec;
    let zoom: number;
    if (player) {
      // Stays on the Player, and on the spot where they were knocked out.
      target = player.pos;
      zoom = base * Math.pow(CONFIG.baseRadius / radiusOf(player), 0.6) * 1.15;
    } else {
      // No Player in play: drift slowly over the Arena behind the menus.
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
      p.vx *= Math.pow(0.08, dt);
      p.vy *= Math.pow(0.08, dt);
      p.angle += p.spinRate * dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawArena() {
    const ctx = this.ctx;
    const R = CONFIG.arenaRadius;

    const floor = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    floor.addColorStop(0, "#161a33");
    floor.addColorStop(0.75, "#10132a");
    floor.addColorStop(1, "#0b0d1e");
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // Concentric guides and spokes give a sense of motion and of where the Rim is.
    ctx.strokeStyle = "rgba(120, 150, 255, 0.07)";
    ctx.lineWidth = 2;
    for (let r = 300; r < R; r += 300) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 150, Math.sin(a) * 150);
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.stroke();
    }

    // Danger band just inside the Rim.
    const band = ctx.createRadialGradient(0, 0, R * 0.86, 0, 0, R);
    band.addColorStop(0, "rgba(247, 37, 133, 0)");
    band.addColorStop(1, "rgba(247, 37, 133, 0.16)");
    ctx.fillStyle = band;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();

    // The glowing Rim.
    const pulse = 0.75 + Math.sin(this.clock * 3) * 0.25;
    ctx.save();
    ctx.shadowColor = "#f72585";
    ctx.shadowBlur = 40;
    ctx.strokeStyle = `rgba(247, 37, 133, ${pulse})`;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawPickups(world: World) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "#7bf1a8";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#7bf1a8";
    for (const p of world.pickups) {
      const r = CONFIG.pickupRadius * (0.8 + Math.sin(this.clock * 4 + p.id) * 0.2);
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawTrails() {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    for (const { trail, top } of this.looks.values()) {
      const speed = Math.hypot(top.vel.x, top.vel.y);
      if (trail.length < 2 || speed < 60) continue;
      const r = radiusOf(top);
      for (let i = 1; i < trail.length; i++) {
        const k = 1 - i / trail.length;
        ctx.strokeStyle = withAlpha(top.color, 0.35 * k * Math.min(1, speed / 500));
        ctx.lineWidth = r * 1.4 * k;
        ctx.beginPath();
        ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
        ctx.lineTo(trail[i].x, trail[i].y);
        ctx.stroke();
      }
    }
  }

  private drawTop(world: World, look: Look, isPlayer: boolean) {
    const ctx = this.ctx;
    const t = look.top;
    const r = radiusOf(t);
    const frac = t.spin / t.maxSpin;

    // A Top low on Spin wobbles.
    const wobble = frac < 0.35 ? (0.35 - frac) * r * 0.5 : 0;
    const x = t.pos.x + Math.cos(this.clock * 13 + t.id) * wobble;
    const y = t.pos.y + Math.sin(this.clock * 11 + t.id) * wobble;

    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.beginPath();
    ctx.arc(r * 0.12, r * 0.18, r * 1.02, 0, Math.PI * 2);
    ctx.fill();

    drawTopBody(ctx, t.type, t.color, r, look.angle);

    // Spin gauge around the Top.
    ctx.lineWidth = Math.max(2, r * 0.1);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.28, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = frac < 0.3 ? "#ff5d73" : isPlayer ? "#7bf1a8" : withAlpha(t.color, 0.9);
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.28, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();

    if (world.time < t.protectedUntil) {
      ctx.strokeStyle = `rgba(160, 220, 255, ${0.4 + Math.sin(this.clock * 10) * 0.25})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.55, this.clock * 2, this.clock * 2 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const size = Math.max(13, Math.min(26, r * 0.5));
    ctx.font = `700 ${size}px "Chakra Petch", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = isPlayer ? "#ffffff" : "rgba(232, 236, 255, 0.8)";
    ctx.fillText(t.name, 0, -r * 1.55 - 6);
    ctx.restore();
  }

  private drawFading(dt: number) {
    const ctx = this.ctx;
    for (const f of this.fading) {
      f.t += dt;
      const r = radiusOf(f.top);
      ctx.save();
      ctx.translate(f.top.pos.x, f.top.pos.y);
      if (f.kind === "ring-out") {
        // Falls away past the Rim: shrinks, darkens, keeps drifting outward.
        const out = Math.hypot(f.top.pos.x, f.top.pos.y) || 1;
        ctx.translate((f.top.pos.x / out) * f.t * 200, (f.top.pos.y / out) * f.t * 200);
        ctx.globalAlpha = Math.max(0, 1 - f.t / 0.9);
        ctx.scale(1 - f.t * 0.8, 1 - f.t * 0.8);
        f.angle += 10 * dt;
      } else {
        // Winds down and topples.
        ctx.globalAlpha = Math.max(0, 1 - f.t / 1.2);
        ctx.scale(1, 1 - Math.min(0.6, f.t * 0.6));
        f.angle += Math.max(0, 3 - f.t * 3) * dt;
      }
      drawTopBody(ctx, f.top.type, f.top.color, Math.max(1, r), f.angle);
      ctx.restore();
    }
    this.fading = this.fading.filter((f) => f.t < 1.2);
  }

  private drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const k = Math.max(0, p.life / p.maxLife);
      if (p.kind === "spark") {
        ctx.strokeStyle = withAlpha(p.color, k);
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.kind === "shard") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        ctx.fillStyle = withAlpha(p.color, Math.min(1, k * 1.5));
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.7, p.size * 0.6);
        ctx.lineTo(-p.size * 0.6, p.size * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else {
        ctx.strokeStyle = withAlpha(p.color, k * 0.8);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 + (1 - k) * 1.5), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  private drawMinimap(world: World, player: Top | null) {
    const m = this.mini;
    const size = m.canvas.width;
    const scale = (size / 2 - 8) / CONFIG.arenaRadius;
    m.clearRect(0, 0, size, size);
    m.save();
    m.translate(size / 2, size / 2);
    m.strokeStyle = "rgba(247, 37, 133, 0.8)";
    m.lineWidth = 2;
    m.beginPath();
    m.arc(0, 0, CONFIG.arenaRadius * scale, 0, Math.PI * 2);
    m.stroke();

    const biggest = Math.max(...world.tops.map((t) => t.maxSpin), 1);
    for (const t of world.tops) {
      if (!t.alive || t === player) continue;
      // Only notable Tops appear, so the map shows who to fear.
      if (t.maxSpin < biggest * 0.6 && t.maxSpin <= CONFIG.startMaxSpin * 1.2) continue;
      m.fillStyle = t.color;
      m.beginPath();
      m.arc(t.pos.x * scale, t.pos.y * scale, 2 + Math.sqrt(t.maxSpin / CONFIG.startMaxSpin) * 1.5, 0, Math.PI * 2);
      m.fill();
    }
    if (player?.alive) {
      m.fillStyle = "#ffffff";
      m.shadowColor = "#ffffff";
      m.shadowBlur = 8;
      m.beginPath();
      m.arc(player.pos.x * scale, player.pos.y * scale, 4, 0, Math.PI * 2);
      m.fill();
    }
    m.restore();
  }
}

/** Visual rotation speed (radians/second): a Top visibly slows as it loses Spin. */
function spinRate(t: Top): number {
  return 3 + 27 * (t.spin / t.maxSpin);
}
