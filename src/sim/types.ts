export interface Vec {
  x: number;
  y: number;
}

export type TopId = number;

export type TopType = "attack" | "defense" | "stamina";

export interface Top {
  id: TopId;
  type: TopType;
  name: string;
  color: string;
  pos: Vec;
  vel: Vec;
  spin: number;
  maxSpin: number;
  alive: boolean;
  /** Who this Top last Clashed with, and when; used for Credit. */
  lastClash: { by: TopId; time: number } | null;
  /** World time at which Spawn Protection ends. */
  protectedUntil: number;
  /** World time at which this Top may Dash again. */
  dashReadyAt: number;
  /** Knockouts Credited to this Top in its current life. */
  knockouts: number;
  /** Present when the game, not a human, controls this Top. */
  bot: BotMind | null;
}

export interface BotMind {
  /** 0..1: how readily this Bot picks fights and how bravely it stands its ground. */
  aggression: number;
  /** Current heading (radians) when there is nothing better to do. */
  wander: number;
}

export interface Pickup {
  id: number;
  pos: Vec;
}

export interface World {
  time: number;
  rngState: number;
  nextId: number;
  tops: Top[];
  pickups: Pickup[];
  /** How many Pickups the Arena keeps scattered at all times. */
  pickupTarget: number;
  /** World times at which replacements for knocked-out Bots are due. */
  botRespawns: number[];
}

/** What a Top wants this step: a steering direction (length 0..1 is throttle) and whether to Dash. */
export interface TopInput {
  dir: Vec;
  dash: boolean;
}

export type KnockoutCause = "spin-out" | "ring-out" | "burst";

export type SimEvent =
  | { type: "dash"; top: TopId }
  | { type: "pickup"; top: TopId; at: Vec }
  | { type: "clash"; a: TopId; b: TopId; impact: number; at: Vec }
  | { type: "knockout"; victim: TopId; cause: KnockoutCause; credit: TopId | null; at: Vec };
