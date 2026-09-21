import { CONFIG } from "./config";
import { nextRandom } from "./rng";
import { massOf, radiusOf } from "./stats";
import type { Top, TopInput, Vec, World } from "./types";

/** How far (px) a Bot notices other Tops. */
const SIGHT = 700;
/** Beyond this fraction of the Arena radius, a Bot starts steering back toward the centre. */
const RIM_COMFORT = 0.72;
/** How close (beyond touching) prey must be before a Bot Dashes at it. */
const DASH_REACH = 220;

/** A Top's fighting weight: how much Spin it has behind how much mass. */
const strength = (t: Top) => t.spin * massOf(t);

/** Decides a Bot's input for this step: the same shape of input a Player sends. */
export function botInput(world: World, me: Top): TopInput {
  const mind = me.bot!;
  const steer: Vec = { x: 0, y: 0 };
  const pull = (x: number, y: number, weight: number) => {
    const len = Math.hypot(x, y) || 1;
    steer.x += (x / len) * weight;
    steer.y += (y / len) * weight;
  };

  const fromCentre = Math.hypot(me.pos.x, me.pos.y);
  const rimDanger = (fromCentre / CONFIG.arenaRadius - RIM_COMFORT) / (1 - RIM_COMFORT);
  if (rimDanger > 0) pull(-me.pos.x, -me.pos.y, rimDanger * 4);

  let prey: Top | null = null;
  let preyDist = Infinity;
  const fleeRange = SIGHT * (0.9 - mind.aggression * 0.4);
  const huntRange = 200 + SIGHT * mind.aggression;
  for (const other of world.tops) {
    if (other === me || !other.alive) continue;
    const dx = other.pos.x - me.pos.x;
    const dy = other.pos.y - me.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > SIGHT) continue;

    const ratio = strength(other) / Math.max(1, strength(me));
    if (ratio > 1.4 + mind.aggression && dist < fleeRange) {
      pull(-dx, -dy, 3 * (1 - dist / fleeRange));
    } else if (ratio < 0.85 && world.time >= other.protectedUntil && dist < huntRange && dist < preyDist) {
      prey = other;
      preyDist = dist;
    }
  }

  let dash = false;
  if (prey) {
    pull(prey.pos.x - me.pos.x, prey.pos.y - me.pos.y, 2);
    const reach = radiusOf(me) + radiusOf(prey) + DASH_REACH;
    dash = preyDist < reach && me.spin > me.maxSpin * 0.3 && world.time >= me.dashReadyAt;
  } else {
    const pickup = nearestPickup(world, me);
    if (pickup) {
      pull(pickup.x - me.pos.x, pickup.y - me.pos.y, 1);
    } else {
      mind.wander += (nextRandom(world) - 0.5) * 0.3;
      pull(Math.cos(mind.wander), Math.sin(mind.wander), 0.6);
    }
  }

  return { dir: steer, dash };
}

function nearestPickup(world: World, me: Top): Vec | null {
  let best: Vec | null = null;
  let bestDist = 900;
  for (const p of world.pickups) {
    const d = Math.hypot(p.pos.x - me.pos.x, p.pos.y - me.pos.y);
    if (d < bestDist) {
      best = p.pos;
      bestDist = d;
    }
  }
  return best;
}
