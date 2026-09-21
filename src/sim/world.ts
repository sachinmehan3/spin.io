import { CONFIG } from "./config";
import { nextRandom } from "./rng";
import { radiusOf } from "./stats";
import type { Top, TopType, Vec, World } from "./types";

export interface WorldOptions {
  seed: number;
  bots: number;
  pickups: number;
}

export const TOP_TYPES: readonly TopType[] = ["attack", "defense", "stamina"];

export function createWorld(opts: WorldOptions): World {
  const world: World = {
    time: 0,
    rngState: opts.seed | 0,
    nextId: 1,
    tops: [],
    pickups: [],
    pickupTarget: opts.pickups,
    botRespawns: [],
  };
  refillPickups(world);
  // Deal Top Types round-robin so every type is present from the start.
  const offset = Math.floor(nextRandom(world) * TOP_TYPES.length);
  for (let i = 0; i < opts.bots; i++) spawnBot(world, TOP_TYPES[(i + offset) % TOP_TYPES.length]);
  return world;
}

export interface Identity {
  name: string;
  color: string;
  type: TopType;
}

/** An exact starting state for a Top. The Top Type defaults to Stamina. */
export interface TopSetup extends Partial<Identity> {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  spin?: number;
  maxSpin?: number;
}

/** Places a Top at an exact spot; the building block for spawning and for scenarios. */
export function addTop(world: World, setup: TopSetup): Top {
  const maxSpin = setup.maxSpin ?? CONFIG.startMaxSpin;
  const top: Top = {
    id: world.nextId++,
    type: setup.type ?? "stamina",
    name: setup.name ?? "",
    color: setup.color ?? "#ffffff",
    pos: { x: setup.x, y: setup.y },
    vel: { x: setup.vx ?? 0, y: setup.vy ?? 0 },
    spin: setup.spin ?? maxSpin,
    maxSpin,
    alive: true,
    lastClash: null,
    protectedUntil: 0,
    dashReadyAt: 0,
    knockouts: 0,
    bot: null,
  };
  world.tops.push(top);
  return top;
}

/** Brings a fresh Top into play at a safe spot, with Spawn Protection. */
export function spawnTop(world: World, who: Identity): Top {
  const pos = safeSpawnPoint(world);
  const top = addTop(world, { ...who, x: pos.x, y: pos.y });
  top.protectedUntil = world.time + CONFIG.spawnProtection;
  return top;
}

const BOT_NAMES = [
  "Vortex", "Talon", "Nova", "Kestrel", "Ember", "Riptide", "Onyx", "Zephyr", "Quake", "Halo",
  "Fang", "Cinder", "Mistral", "Bolt", "Glacier", "Sable", "Comet", "Rook", "Tempest", "Jinx",
];
// The Player palette, minus white: a white Top is always a Player's pick.
const BOT_COLORS = ["#2f7bff", "#ff3b3b", "#ffb400", "#19d38a", "#a45bff", "#ff5fcf", "#00d5ff"];

const pick = <T>(world: World, list: readonly T[]) => list[Math.floor(nextRandom(world) * list.length)];

export function spawnBot(world: World, type?: TopType): Top {
  const taken = new Set(world.tops.filter((t) => t.alive).map((t) => t.name));
  const free = BOT_NAMES.filter((n) => !taken.has(n));
  const top = spawnTop(world, {
    name: pick(world, free.length > 0 ? free : BOT_NAMES),
    color: pick(world, BOT_COLORS),
    type: type ?? pick(world, TOP_TYPES),
  });
  top.bot = { aggression: 0.3 + nextRandom(world) * 0.7, wander: nextRandom(world) * Math.PI * 2 };
  return top;
}

export function refillPickups(world: World) {
  while (world.pickups.length < world.pickupTarget) {
    world.pickups.push({ id: world.nextId++, pos: randomPointWithin(world, CONFIG.arenaRadius * 0.95) });
  }
}

/** A uniformly random point within `radius` of the Arena's centre. */
function randomPointWithin(world: World, radius: number): Vec {
  const r = radius * Math.sqrt(nextRandom(world));
  const a = nextRandom(world) * Math.PI * 2;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r };
}

/** The best of several random candidates: the one furthest from any Top, counting big Tops as closer. */
function safeSpawnPoint(world: World): Vec {
  let best: Vec = { x: 0, y: 0 };
  let bestScore = -Infinity;
  for (let i = 0; i < 16; i++) {
    const c = randomPointWithin(world, CONFIG.arenaRadius * CONFIG.spawnZone);
    let score = Infinity;
    for (const t of world.tops) {
      if (t.alive) score = Math.min(score, Math.hypot(c.x - t.pos.x, c.y - t.pos.y) - radiusOf(t) * 4);
    }
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** The live leaderboard: Tops in play ranked by Max Spin. */
export function leaderboard(world: World, length: number): Top[] {
  return world.tops
    .filter((t) => t.alive)
    .sort((a, b) => b.maxSpin - a.maxSpin)
    .slice(0, length);
}
