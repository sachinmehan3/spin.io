import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { CONFIG } from "./config";
import { radiusOf, steadyMassOf } from "./stats";
import type { Top, TopId, Vec, World } from "./types";

// Rigid-body physics for Tops, backed by Rapier's cross-platform deterministic build (ADR 0002).
// Tops stay the source of truth: every step copies them into Rapier, lets it resolve the
// collisions, and copies the result back. Game rules (Clash, Burst, Credit) stay in step.ts.

let ready = false;

/** Loads the physics engine. Await this once before stepping any World. */
export async function initPhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

interface Body {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
}

interface Physics {
  world: RAPIER.World;
  bodies: Map<TopId, Body>;
}

/** Tops `a` and `b` pushed on each other this step, along `normal` (pointing from a to b). */
export interface Contact {
  a: Top;
  b: Top;
  normal: Vec;
}

// A World is plain data, so its Rapier counterpart lives beside it and is rebuilt if missing.
const physicsOf = new WeakMap<World, Physics>();
const freeOnCollect = new FinalizationRegistry<RAPIER.World>((w) => w.free());

function physicsFor(world: World): Physics {
  let physics = physicsOf.get(world);
  if (physics) return physics;
  if (!ready) throw new Error("Call initPhysics() before stepping a World.");
  const rapier = new RAPIER.World({ x: 0, y: 0 });
  rapier.timestep = CONFIG.dt;
  // Rapier's tolerances are in "meters"; one Top is about a meter across.
  rapier.lengthUnit = CONFIG.baseRadius * 2;
  physics = { world: rapier, bodies: new Map() };
  physicsOf.set(world, physics);
  freeOnCollect.register(world, rapier);
  return physics;
}

function addBody(physics: Physics, t: Top): Body {
  const body = physics.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setCanSleep(false)
      // Looks ahead for contacts, so a Dashing Top can't skip through another in a single step.
      .setSoftCcdPrediction(CONFIG.collisionLookahead)
      .setTranslation(t.pos.x, t.pos.y),
  );
  const collider = physics.world.createCollider(
    RAPIER.ColliderDesc.ball(radiusOf(t))
      .setRestitution(CONFIG.restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
      .setFriction(CONFIG.clashGrip)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max),
    body,
  );
  const added = { body, collider };
  physics.bodies.set(t.id, added);
  return added;
}

/**
 * Moves every Top in `live` along its velocity for one step, bouncing off the others.
 * Returns the pairs that actually pushed on each other, in the same pair order as `live`.
 */
export function moveTops(world: World, live: Top[]): Contact[] {
  const physics = physicsFor(world);
  const { bodies } = physics;

  const liveIds = new Set(live.map((t) => t.id));
  for (const [id, { body }] of bodies) {
    if (!liveIds.has(id)) {
      physics.world.removeRigidBody(body);
      bodies.delete(id);
    }
  }

  for (const t of live) {
    const { body, collider } = bodies.get(t.id) ?? addBody(physics, t);
    body.setTranslation(t.pos, true);
    body.setLinvel(t.vel, true);
    // Every Top spins the same way, so where two meet their surfaces rub against each other and
    // grip deflects them sideways: a glancing hit sends both skidding off, as real tops do.
    body.setAngvel(CONFIG.spinRate * (t.spin / t.maxSpin), true);
    const r = radiusOf(t);
    if (collider.radius() !== r) collider.setRadius(r);
    collider.setMass(steadyMassOf(t));
  }

  physics.world.step();

  for (const t of live) {
    const { body } = bodies.get(t.id)!;
    const p = body.translation();
    const v = body.linvel();
    t.pos = { x: p.x, y: p.y };
    t.vel = { x: v.x, y: v.y };
  }

  const contacts: Contact[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      physics.world.contactPair(bodies.get(a.id)!.collider, bodies.get(b.id)!.collider, (manifold, flipped) => {
        let pushed = 0;
        for (let k = 0; k < manifold.numContacts(); k++) pushed += manifold.contactImpulse(k);
        if (pushed <= 0) return;
        const n = manifold.normal();
        const sign = flipped ? -1 : 1;
        contacts.push({ a, b, normal: { x: n.x * sign, y: n.y * sign } });
      });
    }
  }
  return contacts;
}
