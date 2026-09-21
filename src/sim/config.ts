import type { TopType } from "./types";

export interface TypeStats {
  /** Multiplies steering acceleration and top speed. */
  speed: number;
  /** Multiplies Dash speed. */
  dash: number;
  /** Multiplies mass: heavier Tops take less Knockback. */
  mass: number;
  /** Multiplies natural Spin decay. */
  decay: number;
  /** Multiplies the Spin loss (and Burst power) this Top inflicts in a Clash. */
  clashPower: number;
}

export const TYPE_STATS: Record<TopType, TypeStats> = {
  attack: { speed: 1.15, dash: 1.25, mass: 0.9, decay: 1.35, clashPower: 1.3 },
  defense: { speed: 0.85, dash: 0.9, mass: 1.6, decay: 1.0, clashPower: 1.0 },
  stamina: { speed: 1.0, dash: 1.0, mass: 1.0, decay: 0.6, clashPower: 0.75 },
};

/** Tuning knobs for the simulation. Units: pixels, seconds, Spin points. */
export const CONFIG = {
  dt: 1 / 60,
  arenaRadius: 1800,

  startMaxSpin: 100,
  baseRadius: 28,

  /** Spin lost per second by a starting-size Top. */
  baseDecay: 1,
  /** Decay grows with (Max Spin / start)^this, so big Tops must keep fighting to stay big. */
  decayGrowth: 1.2,

  /** Steering acceleration (px/s^2) and top speed from steering alone (px/s), for a starting-size Top. */
  accel: 900,
  maxSpeed: 260,
  /** Speed falls with (Max Spin / start)^this, so bigger Tops are slower targets. */
  sizeSlowdown: 0.25,

  /** Speed added by a Dash (px/s). */
  dashSpeed: 650,
  /** Spin cost of a Dash, as a fraction of Max Spin. */
  dashCost: 0.05,
  /** Seconds between Dashes. */
  dashCooldown: 1.2,

  /** Fraction of velocity kept per second while coasting. */
  friction: 0.35,

  /**
   * How much Spin steadies a Top against Knockback: a Top resists as if its mass were
   * mass * (1 - spinSteadiness * (1 - Spin / Max Spin)).
   */
  spinSteadiness: 0.5,

  /** Seconds of Spawn Protection. */
  spawnProtection: 3,
  /** New Tops spawn within this fraction of the Arena radius. */
  spawnZone: 0.6,
  /** Seconds before a knocked-out Bot is replaced. */
  botRespawnDelay: 2,

  /** Spin restored by a Pickup, and a Pickup's radius. */
  pickupValue: 4,
  pickupRadius: 8,

  /** Bounciness of a Clash; above 1 adds a little extra Knockback. */
  restitution: 1.15,
  /** How far ahead (px) collisions are predicted; must beat the distance a Dash covers in one step. */
  collisionLookahead: 100,
  /** Grip between Tops' spinning surfaces: how hard a Clash deflects them sideways. */
  clashGrip: 0.25,
  /** How fast a Top at full Spin turns (radians/s); enough that its grip always slips. */
  spinRate: 40,
  /** Closing speeds below this are resting contact, not a Clash. */
  minClashImpact: 30,
  /** Total Spin lost across both Tops per unit of Impact. */
  spinLossPerImpact: 0.035,
  /** A Clash Bursts a Top when Impact >= burstRatio * the Top's Spin (so only weakened Tops can Burst). */
  burstRatio: 40,
  /** Seconds after a Clash during which a Knockout is Credited to the other Top. */
  creditWindow: 3,
  /** On a credited Knockout: Spin gained, as a fraction of the victim's Max Spin. */
  knockoutSpinReward: 0.5,
  /** On a credited Knockout: Max Spin gained, as a fraction of the victim's Max Spin. */
  knockoutGrowth: 0.25,
} as const;
