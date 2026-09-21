import type { TopType } from "../sim";

// Anime-style Top art: cel-shaded metal wheels with bold dark outlines, drawn once per
// (Top Type, colour, size) and then rotated each frame.

export const COLORS = {
  blue: "#2f7bff",
  red: "#ff3b3b",
  gold: "#ffb400",
  green: "#19d38a",
  purple: "#a45bff",
  pink: "#ff5fcf",
  cyan: "#00d5ff",
  white: "#eef2ff",
} as const;

const INK = "#0a0d16";
export const SPRITE_SCALE = 2;

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const c = (n >> shift) & 255;
    const v = amount >= 0 ? c + (255 - c) * amount : c * (1 + amount);
    return Math.round(Math.max(0, Math.min(255, v)));
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The coloured outer wheel: Attack has three hooked blades, Defense a toothed ring, Stamina a smooth weighted rim. */
function wheelPath(type: TopType, r: number): Path2D {
  const p = new Path2D();
  if (type === "attack") {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const step = (Math.PI * 2) / 3;
      const pt = (ang: number, rad: number) => [Math.cos(ang) * rad, Math.sin(ang) * rad] as const;
      const [x0, y0] = pt(a, r * 0.72);
      const [x1, y1] = pt(a + step * 0.2, r * 1.08);
      const [cx, cy] = pt(a + step * 0.55, r * 1.0);
      const [x2, y2] = pt(a + step, r * 0.72);
      if (i === 0) p.moveTo(x0, y0);
      p.lineTo(x1, y1);
      p.quadraticCurveTo(cx, cy, x2, y2);
    }
    p.closePath();
  } else if (type === "defense") {
    const teeth = 10;
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2;
      const rad = i % 2 === 0 ? r : r * 0.88;
      if (i === 0) p.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else p.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    p.closePath();
  } else {
    p.arc(0, 0, r, 0, Math.PI * 2);
  }
  return p;
}

const sprites = new Map<string, HTMLCanvasElement>();

export function topSprite(type: TopType, color: string, radius: number): HTMLCanvasElement {
  const r = Math.max(8, Math.round(radius / 2) * 2);
  const key = `${type}|${color}|${r}`;
  const cached = sprites.get(key);
  if (cached) return cached;

  const size = Math.ceil(r * 2.5 * SPRITE_SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  g.translate(size / 2, size / 2);
  g.scale(SPRITE_SCALE, SPRITE_SCALE);
  g.lineJoin = "round";
  const line = Math.max(1.5, r * 0.06);

  // Coloured outer wheel, cel-shaded: light on one side, dark on the other.
  const wheel = wheelPath(type, r);
  const body = g.createLinearGradient(-r, -r, r, r);
  body.addColorStop(0, shade(color, 0.45));
  body.addColorStop(0.45, color);
  body.addColorStop(0.55, shade(color, -0.25));
  body.addColorStop(1, shade(color, -0.55));
  g.fillStyle = body;
  g.fill(wheel);
  g.strokeStyle = INK;
  g.lineWidth = line;
  g.stroke(wheel);

  if (type === "stamina") {
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      g.beginPath();
      g.arc(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.12, 0, Math.PI * 2);
      g.fillStyle = shade(color, -0.45);
      g.fill();
      g.stroke();
    }
  }

  // Silver metal wheel.
  const metal = g.createLinearGradient(-r * 0.7, -r * 0.7, r * 0.7, r * 0.7);
  metal.addColorStop(0, "#f4f7ff");
  metal.addColorStop(0.35, "#aab3c7");
  metal.addColorStop(0.5, "#e6ebf7");
  metal.addColorStop(0.7, "#6f7890");
  metal.addColorStop(1, "#c9d0e0");
  g.beginPath();
  const spokes = type === "defense" ? 8 : 6;
  for (let i = 0; i < spokes * 2; i++) {
    const a = (i / (spokes * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r * 0.66 : r * 0.54;
    if (i === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
    else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  g.closePath();
  g.fillStyle = metal;
  g.fill();
  g.stroke();

  // Energy-layer cut-outs: dark slots that make the spin readable.
  g.fillStyle = INK;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6;
    g.beginPath();
    g.ellipse(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.1, r * 0.05, a, 0, Math.PI * 2);
    g.fill();
  }

  // Face bolt with a winged emblem.
  g.beginPath();
  g.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  const face = g.createRadialGradient(-r * 0.08, -r * 0.08, 0, 0, 0, r * 0.3);
  face.addColorStop(0, shade(color, 0.35));
  face.addColorStop(1, shade(color, -0.4));
  g.fillStyle = face;
  g.fill();
  g.stroke();
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.moveTo(0, -r * 0.2);
  g.lineTo(r * 0.16, r * 0.06);
  g.lineTo(r * 0.05, r * 0.02);
  g.lineTo(0, r * 0.18);
  g.lineTo(-r * 0.05, r * 0.02);
  g.lineTo(-r * 0.16, r * 0.06);
  g.closePath();
  g.fill();

  sprites.set(key, canvas);
  return canvas;
}

/** Draws a Top centred on the origin at world radius `radius`, rotated by `angle`. */
export function drawTop(ctx: CanvasRenderingContext2D, type: TopType, color: string, radius: number, angle: number, alpha = 1) {
  const sprite = topSprite(type, color, radius);
  const s = sprite.width / SPRITE_SCALE;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.rotate(angle);
  ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
  ctx.restore();
}
