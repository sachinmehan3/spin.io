import type { TopType } from "../sim";

/**
 * Draws a Top's body centred on the origin, rotated by `angle`. Each Top Type has its own
 * silhouette so they can be told apart at a glance: Attack is bladed, Defense a heavy
 * toothed ring, Stamina a smooth weighted disc.
 */
export function drawTopBody(ctx: CanvasRenderingContext2D, type: TopType, color: string, r: number, angle: number) {
  ctx.save();
  ctx.rotate(angle);
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 0.6;
  ctx.fillStyle = shade(color, -0.55);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, r * 0.08);

  ctx.beginPath();
  if (type === "attack") bladedOutline(ctx, r);
  else if (type === "defense") toothedOutline(ctx, r);
  else ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner ring and markings that make the rotation readable.
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.strokeStyle = shade(color, 0.35);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();

  if (type === "stamina") {
    ctx.fillStyle = color;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, r * 0.1);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * r * 0.25, Math.sin(a) * r * 0.25);
    ctx.lineTo(Math.cos(a + 0.5) * r * 0.58, Math.sin(a + 0.5) * r * 0.58);
    ctx.stroke();
  }

  // Bit chip.
  ctx.fillStyle = "#f4f6ff";
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function bladedOutline(ctx: CanvasRenderingContext2D, r: number) {
  const blades = 3;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const next = ((i + 1) / blades) * Math.PI * 2;
    const p = (ang: number, rad: number) => [Math.cos(ang) * rad, Math.sin(ang) * rad] as const;
    const [x0, y0] = p(a, r * 0.72);
    const [x1, y1] = p(a + 0.35, r * 1.08);
    const [x2, y2] = p(a + 0.75, r * 0.9);
    const [x3, y3] = p(next, r * 0.72);
    if (i === 0) ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.quadraticCurveTo(x2, y2, x3, y3);
  }
}

function toothedOutline(ctx: CanvasRenderingContext2D, r: number) {
  const teeth = 8;
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? r : r * 0.86;
    const x = Math.cos(a) * rad;
    const y = Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb colour. */
export function shade(hex: string, amount: number): string {
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
