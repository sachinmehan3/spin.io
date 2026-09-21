// The simulation's public interface: inputs in, state and events out.
// No DOM, rendering or audio in here (ADR 0002).
export type { BotMind, KnockoutCause, Pickup, SimEvent, Top, TopId, TopInput, TopType, Vec, World } from "./types";
export { CONFIG, TYPE_STATS } from "./config";
export { addTop, createWorld, leaderboard, spawnTop, TOP_TYPES } from "./world";
export type { Identity, TopSetup, WorldOptions } from "./world";
export { initPhysics } from "./physics";
export { step } from "./step";
export { radiusOf } from "./stats";
