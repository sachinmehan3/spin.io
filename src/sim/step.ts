import { botInput } from "./bots";
import { CONFIG, TYPE_STATS } from "./config";
import { decayRate, massOf, maxSpeedOf, radiusOf, steadyMassOf } from "./stats";
import type { KnockoutCause, SimEvent, Top, TopId, TopInput, World } from "./types";
import { refillPickups, spawnBot } from "./world";

const isProtected = (world: World, t: Top) => world.time < t.protectedUntil;

/**
 * Advances the world by one fixed timestep. Bots decide their own inputs; `inputs` covers
 * every other Top. Knocked-out Tops are reported once in the events, then leave `world.tops`.
 */
export function step(world: World, inputs: Record<TopId, TopInput>): SimEvent[] {
  const dt = CONFIG.dt;
  const events: SimEvent[] = [];
  const live = world.tops.filter((t) => t.alive);

  for (const t of live) {
    const input = t.bot ? botInput(world, t) : inputs[t.id];
    if (input) applyInput(world, t, input, events);
  }

  const velocityKept = Math.pow(CONFIG.friction, dt);
  for (const t of live) {
    t.vel.x *= velocityKept;
    t.vel.y *= velocityKept;
    t.pos.x += t.vel.x * dt;
    t.pos.y += t.vel.y * dt;
    if (!isProtected(world, t)) t.spin = Math.max(0, t.spin - decayRate(t) * dt);
  }

  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      if (!a.alive || !b.alive) continue;
      const clash = resolveClash(a, b, isProtected(world, a), isProtected(world, b));
      if (!clash) continue;
      const { bursts, ...clashEvent } = clash;
      events.push(clashEvent);
      a.lastClash = { by: b.id, time: world.time };
      b.lastClash = { by: a.id, time: world.time };
      for (const [victim, other] of [[a, b], [b, a]] as const) {
        if (!bursts.includes(victim)) continue;
        // When a Clash Bursts both Tops, neither earns Credit.
        const credit = bursts.includes(other) ? null : other.id;
        events.push(knockOut(world, victim, "burst", credit));
      }
    }
  }

  collectPickups(world, live, events);

  for (const t of live) {
    if (!t.alive) continue;
    if (t.spin <= 0) events.push(knockOut(world, t, "spin-out", creditFor(world, t)));
    else if (Math.hypot(t.pos.x, t.pos.y) > CONFIG.arenaRadius) {
      events.push(knockOut(world, t, "ring-out", creditFor(world, t)));
    }
  }

  world.tops = world.tops.filter((t) => t.alive);
  world.time += dt;
  respawnBots(world);
  return events;
}

function applyInput(world: World, t: Top, input: TopInput, events: SimEvent[]) {
  const len = Math.hypot(input.dir.x, input.dir.y);
  if (len === 0) return;
  const throttle = Math.min(1, len);
  const dx = input.dir.x / len;
  const dy = input.dir.y / len;

  // Steering never pushes past the top speed, but it doesn't brake a faster Top (e.g. mid-Dash) either.
  const before = Math.hypot(t.vel.x, t.vel.y);
  const accel = CONFIG.accel * TYPE_STATS[t.type].speed * throttle * CONFIG.dt;
  let vx = t.vel.x + dx * accel;
  let vy = t.vel.y + dy * accel;
  const after = Math.hypot(vx, vy);
  const limit = Math.max(before, maxSpeedOf(t));
  if (after > limit) {
    vx *= limit / after;
    vy *= limit / after;
  }
  t.vel.x = vx;
  t.vel.y = vy;

  if (input.dash && world.time >= t.dashReadyAt) {
    t.protectedUntil = 0; // Dashing gives up Spawn Protection.
    const dashSpeed = CONFIG.dashSpeed * TYPE_STATS[t.type].dash;
    t.vel.x += dx * dashSpeed;
    t.vel.y += dy * dashSpeed;
    t.spin = Math.max(0, t.spin - t.maxSpin * CONFIG.dashCost);
    t.dashReadyAt = world.time + CONFIG.dashCooldown;
    events.push({ type: "dash", top: t.id });
  }
}

function collectPickups(world: World, live: Top[], events: SimEvent[]) {
  world.pickups = world.pickups.filter((p) => {
    const collector = live.find(
      (t) => t.alive && Math.hypot(t.pos.x - p.pos.x, t.pos.y - p.pos.y) < radiusOf(t) + CONFIG.pickupRadius,
    );
    if (!collector) return true;
    collector.spin = Math.min(collector.maxSpin, collector.spin + CONFIG.pickupValue);
    events.push({ type: "pickup", top: collector.id, at: p.pos });
    return false;
  });
  refillPickups(world);
}

function respawnBots(world: World) {
  const due = world.botRespawns.filter((at) => at <= world.time);
  world.botRespawns = world.botRespawns.filter((at) => at > world.time);
  for (let i = 0; i < due.length; i++) spawnBot(world);
}

/** The last Top to Clash with `victim`, if that was recent enough and it is still in play. */
function creditFor(world: World, victim: Top): TopId | null {
  const last = victim.lastClash;
  if (!last || world.time - last.time > CONFIG.creditWindow) return null;
  const by = world.tops.find((t) => t.id === last.by);
  return by?.alive ? by.id : null;
}

function knockOut(world: World, victim: Top, cause: KnockoutCause, credit: TopId | null): SimEvent {
  victim.alive = false;
  if (victim.bot) world.botRespawns.push(world.time + CONFIG.botRespawnDelay);
  const winner = world.tops.find((t) => t.id === credit && t.alive);
  if (winner) {
    winner.knockouts++;
    winner.maxSpin += victim.maxSpin * CONFIG.knockoutGrowth;
    winner.spin = Math.min(winner.maxSpin, winner.spin + victim.maxSpin * CONFIG.knockoutSpinReward);
  }
  return { type: "knockout", victim: victim.id, cause, credit, at: { ...victim.pos } };
}

type ClashEvent = Extract<SimEvent, { type: "clash" }>;

function resolveClash(a: Top, b: Top, aSafe: boolean, bSafe: boolean): (ClashEvent & { bursts: Top[] }) | null {
  const dx = b.pos.x - a.pos.x;
  const dy = b.pos.y - a.pos.y;
  const dist = Math.hypot(dx, dy) || 0.0001;
  const overlap = radiusOf(a) + radiusOf(b) - dist;
  if (overlap <= 0) return null;
  const nx = dx / dist;
  const ny = dy / dist;

  // Push apart so they never sink into each other.
  const aMoves = overlap * (massOf(b) / (massOf(a) + massOf(b)));
  const bMoves = overlap - aMoves;
  a.pos.x -= nx * aMoves;
  a.pos.y -= ny * aMoves;
  b.pos.x += nx * bMoves;
  b.pos.y += ny * bMoves;

  // How hard each Top drives into the other, before Knockback changes their velocities.
  const aDrive = a.vel.x * nx + a.vel.y * ny;
  const bDrive = -(b.vel.x * nx + b.vel.y * ny);
  const impact = aDrive + bDrive;
  if (impact <= 0) return null;

  const steadyA = steadyMassOf(a);
  const steadyB = steadyMassOf(b);
  const impulse = ((1 + CONFIG.restitution) * impact) / (1 / steadyA + 1 / steadyB);
  a.vel.x -= (impulse / steadyA) * nx;
  a.vel.y -= (impulse / steadyA) * ny;
  b.vel.x += (impulse / steadyB) * nx;
  b.vel.y += (impulse / steadyB) * ny;

  if (impact < CONFIG.minClashImpact) return null;

  // Judged on Spin before this Clash's loss, so Burst depends on how weakened the Top already was.
  // The attacker (the Top driving in harder) is never Burst by its own attack; on a dead-even
  // collision there is no attacker and both can Burst.
  const powerA = TYPE_STATS[a.type].clashPower;
  const powerB = TYPE_STATS[b.type].clashPower;
  const bursts: Top[] = [];
  if (!aSafe && aDrive <= bDrive && impact * powerB >= CONFIG.burstRatio * a.spin) bursts.push(a);
  if (!bSafe && bDrive <= aDrive && impact * powerA >= CONFIG.burstRatio * b.spin) bursts.push(b);

  // The Top with more Spin takes the smaller share of the loss, scaled by the other's Clash power (ADR 0001).
  const total = impact * CONFIG.spinLossPerImpact;
  const sum = a.spin + b.spin || 1;
  const aLoss = total * (b.spin / sum) * powerB;
  const bLoss = total * (a.spin / sum) * powerA;
  if (!aSafe) a.spin = Math.max(0, a.spin - aLoss);
  if (!bSafe) b.spin = Math.max(0, b.spin - bLoss);

  return {
    type: "clash",
    a: a.id,
    b: b.id,
    impact,
    at: { x: a.pos.x + nx * radiusOf(a), y: a.pos.y + ny * radiusOf(a) },
    bursts,
  };
}
