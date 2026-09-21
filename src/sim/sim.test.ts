import { describe, expect, it } from "vitest";
import { addTop, CONFIG, createWorld, leaderboard, spawnTop, step } from "./index";

const emptyArena = () => createWorld({ seed: 1, bots: 0, pickups: 0 });

/** Steps the world until `done` is true or `maxSteps` pass; returns every event seen. */
function runUntil(world: ReturnType<typeof createWorld>, done: () => boolean, maxSteps = 600) {
  const events = [];
  for (let i = 0; i < maxSteps && !done(); i++) events.push(...step(world, {}));
  return events;
}

describe("Clash", () => {
  it("drains both Tops, and the Top with more Spin loses less", () => {
    const world = emptyArena();
    const strong = addTop(world, { x: -60, y: 0, vx: 200, vy: 0, spin: 100 });
    const weak = addTop(world, { x: 60, y: 0, vx: -200, vy: 0, spin: 50 });

    const events = runUntil(world, () => world.time > 1);

    expect(events.some((e) => e.type === "clash")).toBe(true);
    const strongLoss = 100 - strong.spin;
    const weakLoss = 50 - weak.spin;
    expect(strongLoss).toBeGreaterThan(0);
    expect(weakLoss).toBeGreaterThan(strongLoss);
  });
});

describe("Burst", () => {
  it("destroys a weakened Top hit hard, crediting the hitter", () => {
    const world = emptyArena();
    const hitter = addTop(world, { x: -80, y: 0, vx: 900, vy: 0 });
    const victim = addTop(world, { x: 0, y: 0, spin: 15 });

    const events = runUntil(world, () => !victim.alive, 60);

    expect(victim.alive).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "knockout", victim: victim.id, cause: "burst", credit: hitter.id }),
    );
  });

  it("gives no Credit to a Top that is Burst in the same Clash", () => {
    const world = emptyArena();
    const a = addTop(world, { x: -60, y: 0, vx: 600, vy: 0, spin: 10 });
    const b = addTop(world, { x: 60, y: 0, vx: -600, vy: 0, spin: 10 });

    const events = runUntil(world, () => !a.alive && !b.alive, 60);

    const knockouts = events.filter((e) => e.type === "knockout");
    expect(knockouts).toHaveLength(2);
    expect(knockouts.every((e) => e.type === "knockout" && e.credit === null)).toBe(true);
    expect(a.maxSpin).toBe(100);
    expect(b.maxSpin).toBe(100);
  });

  it("does not destroy a healthy Top taking the same hit", () => {
    const world = emptyArena();
    addTop(world, { x: -80, y: 0, vx: 900, vy: 0 });
    const victim = addTop(world, { x: 0, y: 0, spin: 100 });

    const events = runUntil(world, () => world.time > 0.5);

    expect(victim.alive).toBe(true);
    expect(events.some((e) => e.type === "knockout")).toBe(false);
  });

  it("does not destroy a weakened Top from a gentle bump", () => {
    const world = emptyArena();
    addTop(world, { x: -80, y: 0, vx: 150, vy: 0 });
    const victim = addTop(world, { x: 0, y: 0, spin: 15 });

    runUntil(world, () => world.time > 1);

    expect(victim.alive).toBe(true);
  });
});

describe("Ring-out", () => {
  it("knocks out a Top that crosses the Rim, with no Credit if nobody hit it", () => {
    const world = emptyArena();
    const edge = CONFIG.arenaRadius;
    const drifter = addTop(world, { x: edge - 20, y: 0, vx: 300, vy: 0 });

    const events = runUntil(world, () => !drifter.alive);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "knockout", victim: drifter.id, cause: "ring-out", credit: null }),
    );
  });

  it("credits the last Top to Clash with the victim shortly before", () => {
    const world = emptyArena();
    const edge = CONFIG.arenaRadius;
    const pusher = addTop(world, { x: edge - 200, y: 0, vx: 500, vy: 0 });
    const victim = addTop(world, { x: edge - 120, y: 0 });

    const events = runUntil(world, () => !victim.alive);

    expect(pusher.alive).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({ type: "knockout", victim: victim.id, cause: "ring-out", credit: pusher.id }),
    );
  });

  it("gives no Credit when the last Clash was long ago", () => {
    const world = emptyArena();
    addTop(world, { x: -100, y: 0, vx: 300, vy: 0 });
    const victim = addTop(world, { x: 0, y: 0 });
    runUntil(world, () => world.time > 5);

    // Long after the Clash, the victim wanders over the Rim on its own.
    victim.pos = { x: CONFIG.arenaRadius - 10, y: 0 };
    victim.vel = { x: 300, y: 0 };
    const events = runUntil(world, () => !victim.alive);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "knockout", victim: victim.id, cause: "ring-out", credit: null }),
    );
  });
});

describe("Spin decay and Spin-out", () => {
  it("drains a larger Top's Spin faster", () => {
    const world = emptyArena();
    const small = addTop(world, { x: -500, y: 0, maxSpin: 100 });
    const big = addTop(world, { x: 500, y: 0, maxSpin: 400 });

    runUntil(world, () => world.time > 5);

    expect(100 - small.spin).toBeGreaterThan(0);
    expect(400 - big.spin).toBeGreaterThan(100 - small.spin);
  });

  it("spins out a Top whose Spin runs out, with no Credit if nobody hit it", () => {
    const world = emptyArena();
    const fading = addTop(world, { x: 0, y: 0, spin: 0.5 });

    const events = runUntil(world, () => !fading.alive);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "knockout", victim: fading.id, cause: "spin-out", credit: null }),
    );
  });

  it("credits a Spin-out to the Top that recently Clashed with it", () => {
    const world = emptyArena();
    // Too gentle to Burst, but enough to drain what little Spin is left.
    const bumper = addTop(world, { x: -57, y: 0, vx: 40, vy: 0 });
    const fading = addTop(world, { x: 0, y: 0, spin: 1.5 });

    const events = runUntil(world, () => !fading.alive);

    expect(events).toContainEqual(
      expect.objectContaining({ type: "knockout", victim: fading.id, cause: "spin-out", credit: bumper.id }),
    );
  });
});

describe("Growth on Knockout", () => {
  function burstVictim(victimMaxSpin: number) {
    const world = emptyArena();
    const hitter = addTop(world, { x: -120, y: 0, vx: 1200, vy: 0, spin: 40 });
    const victim = addTop(world, { x: 0, y: 0, maxSpin: victimMaxSpin, spin: 10 });
    runUntil(world, () => !victim.alive, 60);
    expect(victim.alive).toBe(false);
    return hitter;
  }

  it("rewards the credited Top with Spin and a larger Max Spin", () => {
    const hitter = burstVictim(100);

    expect(hitter.maxSpin).toBeGreaterThan(100);
    expect(hitter.spin).toBeGreaterThan(70);
  });

  it("rewards more for knocking out a bigger Top", () => {
    const fromSmall = burstVictim(100);
    const fromBig = burstVictim(300);

    expect(fromBig.maxSpin).toBeGreaterThan(fromSmall.maxSpin);
  });
});

describe("Steering and Dash", () => {
  const right = { dir: { x: 1, y: 0 }, dash: false };
  const dashRight = { dir: { x: 1, y: 0 }, dash: true };

  it("moves a Top in the direction it is steered", () => {
    const world = emptyArena();
    const top = addTop(world, { x: 0, y: 0 });

    for (let i = 0; i < 60; i++) step(world, { [top.id]: right });

    expect(top.pos.x).toBeGreaterThan(50);
    expect(Math.abs(top.pos.y)).toBeLessThan(1);
  });

  it("caps how fast steering alone can go", () => {
    const world = emptyArena();
    const top = addTop(world, { x: -1000, y: 0 });

    for (let i = 0; i < 300; i++) step(world, { [top.id]: right });

    expect(top.vel.x).toBeLessThan(400);
  });

  it("launches the Top forward at a Spin cost", () => {
    const world = emptyArena();
    const dasher = addTop(world, { x: 0, y: 200 });
    const coaster = addTop(world, { x: 0, y: -200 });

    const events = step(world, { [dasher.id]: dashRight, [coaster.id]: right });

    expect(dasher.vel.x).toBeGreaterThan(coaster.vel.x + 300);
    expect(dasher.spin).toBeLessThan(coaster.spin - 1);
    expect(events).toContainEqual({ type: "dash", top: dasher.id });
  });

  it("cannot Dash again until the cooldown has passed", () => {
    const world = emptyArena();
    const dasher = addTop(world, { x: 0, y: 0 });
    step(world, { [dasher.id]: dashRight });
    const spinAfterFirst = dasher.spin;

    const events = step(world, { [dasher.id]: dashRight });

    expect(events.some((e) => e.type === "dash")).toBe(false);
    expect(spinAfterFirst - dasher.spin).toBeLessThan(0.1);
  });
});

describe("Knockback", () => {
  it("pushes the Top with less Spin further", () => {
    const world = emptyArena();
    const steady = addTop(world, { x: -60, y: 0, vx: 200, vy: 0, spin: 100 });
    const wobbly = addTop(world, { x: 60, y: 0, vx: -200, vy: 0, spin: 40 });

    runUntil(world, () => world.time > 0.5);

    expect(Math.abs(wobbly.vel.x)).toBeGreaterThan(Math.abs(steady.vel.x));
  });
});

describe("Top Types", () => {
  it("Attack Dashes harder than Stamina", () => {
    const world = emptyArena();
    const attack = addTop(world, { x: 0, y: 300, type: "attack" });
    const stamina = addTop(world, { x: 0, y: -300, type: "stamina" });
    const dash = { dir: { x: 1, y: 0 }, dash: true };

    step(world, { [attack.id]: dash, [stamina.id]: dash });

    expect(attack.vel.x).toBeGreaterThan(stamina.vel.x);
  });

  it("Stamina loses Spin slower than Attack", () => {
    const world = emptyArena();
    const attack = addTop(world, { x: 0, y: 300, type: "attack" });
    const stamina = addTop(world, { x: 0, y: -300, type: "stamina" });

    runUntil(world, () => world.time > 5);

    expect(stamina.spin).toBeGreaterThan(attack.spin);
  });

  it("Defense is pushed less than Attack by the same Clash", () => {
    const pushOn = (type: "attack" | "defense") => {
      const world = emptyArena();
      addTop(world, { x: -80, y: 0, vx: 500, vy: 0, type: "stamina" });
      const target = addTop(world, { x: 0, y: 0, type });
      runUntil(world, () => world.time > 0.3);
      return target.vel.x;
    };

    expect(pushOn("defense")).toBeLessThan(pushOn("attack"));
  });

  it("Stamina hits weaker than Attack", () => {
    const lossFrom = (type: "attack" | "stamina") => {
      const world = emptyArena();
      addTop(world, { x: -80, y: 0, vx: 500, vy: 0, type });
      const target = addTop(world, { x: 0, y: 0, type: "defense" });
      runUntil(world, () => world.time > 0.3);
      return 100 - target.spin;
    };

    expect(lossFrom("stamina")).toBeLessThan(lossFrom("attack"));
  });
});

describe("Pickups", () => {
  it("scatters the requested number of Pickups inside the Arena", () => {
    const world = createWorld({ seed: 7, bots: 0, pickups: 50 });

    expect(world.pickups).toHaveLength(50);
    for (const p of world.pickups) expect(Math.hypot(p.pos.x, p.pos.y)).toBeLessThan(CONFIG.arenaRadius);
  });

  it("restores Spin to the Top that collects one, and a new one appears elsewhere", () => {
    const world = createWorld({ seed: 7, bots: 0, pickups: 1 });
    const [pickup] = world.pickups;
    const top = addTop(world, { x: pickup.pos.x, y: pickup.pos.y, spin: 50 });

    const events = step(world, {});

    expect(top.spin).toBeGreaterThan(50);
    expect(events).toContainEqual(expect.objectContaining({ type: "pickup", top: top.id }));
    expect(world.pickups).toHaveLength(1);
    expect(world.pickups[0].id).not.toBe(pickup.id);
  });

  it("never fills a Top past its Max Spin", () => {
    const world = createWorld({ seed: 7, bots: 0, pickups: 1 });
    const [pickup] = world.pickups;
    const top = addTop(world, { x: pickup.pos.x, y: pickup.pos.y });

    step(world, {});

    expect(top.spin).toBeLessThanOrEqual(top.maxSpin);
  });
});

describe("Spawning", () => {
  const who = { name: "Pegasus", color: "#4cf", type: "attack" as const };

  it("places a new Top well inside the Rim, away from large Tops", () => {
    const world = emptyArena();
    const giant = addTop(world, { x: 0, y: 0, maxSpin: 800 });

    for (let i = 0; i < 20; i++) {
      const top = spawnTop(world, who);
      const fromCentre = Math.hypot(top.pos.x, top.pos.y);
      expect(fromCentre).toBeLessThan(CONFIG.arenaRadius * 0.8);
      expect(Math.hypot(top.pos.x - giant.pos.x, top.pos.y - giant.pos.y)).toBeGreaterThan(400);
    }
  });

  it("starts at full Spin with the chosen name, colour and Top Type", () => {
    const world = emptyArena();
    const top = spawnTop(world, who);

    expect(top).toMatchObject({ name: "Pegasus", color: "#4cf", type: "attack", alive: true });
    expect(top.spin).toBe(top.maxSpin);
  });

  it("protects a new Top from losing Spin and from Burst", () => {
    const world = emptyArena();
    const fresh = spawnTop(world, who);
    fresh.spin = 10;
    // Hit it from the outside so the Knockback drives it toward the centre, not over the Rim.
    const out = Math.hypot(fresh.pos.x, fresh.pos.y) || 1;
    const ux = fresh.pos.x / out;
    const uy = fresh.pos.y / out;
    addTop(world, { x: fresh.pos.x + ux * 80, y: fresh.pos.y + uy * 80, vx: -ux * 900, vy: -uy * 900 });

    runUntil(world, () => world.time > 1);

    expect(fresh.alive).toBe(true);
    expect(fresh.spin).toBe(10);
  });

  it("ends protection after a few seconds", () => {
    const world = emptyArena();
    const fresh = spawnTop(world, who);

    runUntil(world, () => world.time > 6, 1000);

    expect(fresh.spin).toBeLessThan(fresh.maxSpin);
  });

  it("ends protection early when the new Top Dashes", () => {
    const world = emptyArena();
    const fresh = spawnTop(world, who);
    step(world, { [fresh.id]: { dir: { x: 1, y: 0 }, dash: true } });
    const afterDash = fresh.spin;

    runUntil(world, () => world.time > 1);

    expect(fresh.spin).toBeLessThan(afterDash);
  });
});

describe("Bots", () => {
  it("fills the Arena with Bots of every Top Type", () => {
    const world = createWorld({ seed: 3, bots: 15, pickups: 0 });

    const bots = world.tops.filter((t) => t.bot);
    expect(bots).toHaveLength(15);
    expect(new Set(bots.map((b) => b.type))).toEqual(new Set(["attack", "defense", "stamina"]));
  });

  it("replaces a knocked-out Bot after a short delay", () => {
    const world = createWorld({ seed: 3, bots: 1, pickups: 0 });
    const [bot] = world.tops;
    bot.pos = { x: CONFIG.arenaRadius + 50, y: 0 };

    step(world, {});
    expect(bot.alive).toBe(false);
    runUntil(world, () => world.time > 5, 1000);

    const liveBots = world.tops.filter((t) => t.bot && t.alive);
    expect(liveBots).toHaveLength(1);
    expect(liveBots[0].id).not.toBe(bot.id);
  });

  it("chases a nearby weaker Top", () => {
    const world = createWorld({ seed: 3, bots: 1, pickups: 0 });
    const [bot] = world.tops;
    bot.pos = { x: 0, y: 0 };
    bot.protectedUntil = 0;
    const prey = addTop(world, { x: 300, y: 0, spin: 20 });

    const events = runUntil(world, () => world.time > 1.5);

    expect(events).toContainEqual(expect.objectContaining({ type: "clash", a: bot.id, b: prey.id }));
  });

  it("runs from a much larger Top", () => {
    const world = createWorld({ seed: 3, bots: 1, pickups: 0 });
    const [bot] = world.tops;
    bot.pos = { x: 0, y: 0 };
    const giant = addTop(world, { x: 250, y: 0, maxSpin: 600 });

    runUntil(world, () => world.time > 1);

    expect(Math.hypot(giant.pos.x - bot.pos.x, giant.pos.y - bot.pos.y)).toBeGreaterThan(300);
  });

  it("steers back from the Rim instead of drifting over it", () => {
    const world = createWorld({ seed: 3, bots: 1, pickups: 0 });
    const [bot] = world.tops;
    bot.pos = { x: CONFIG.arenaRadius - 120, y: 0 };
    bot.vel = { x: 150, y: 0 };

    runUntil(world, () => world.time > 2);

    expect(bot.alive).toBe(true);
    expect(bot.pos.x).toBeLessThan(CONFIG.arenaRadius - 120);
  });
});

describe("Determinism", () => {
  const snapshot = (seed: number) => {
    const world = createWorld({ seed, bots: 15, pickups: 100 });
    for (let i = 0; i < 1200; i++) step(world, {});
    return world.tops.map((t) => [t.id, t.alive, t.pos.x, t.pos.y, t.spin]);
  };

  it("plays out identically from the same seed", () => {
    expect(snapshot(42)).toEqual(snapshot(42));
  });

  it("plays out differently from a different seed", () => {
    expect(snapshot(42)).not.toEqual(snapshot(43));
  });
});

describe("Leaderboard", () => {
  it("ranks Tops in play by Max Spin, largest first, up to the requested length", () => {
    const world = emptyArena();
    addTop(world, { x: -400, y: 0, maxSpin: 150, name: "Mid" });
    addTop(world, { x: 0, y: 0, maxSpin: 300, name: "Big" });
    addTop(world, { x: 400, y: 0, maxSpin: 100, name: "Small" });

    expect(leaderboard(world, 2).map((t) => t.name)).toEqual(["Big", "Mid"]);
  });
});

describe("Bot names", () => {
  it("gives every Bot in play a different name", () => {
    const world = createWorld({ seed: 5, bots: 15, pickups: 0 });

    const names = world.tops.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
