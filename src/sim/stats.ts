import { CONFIG, TYPE_STATS } from "./config";
import type { Top } from "./types";

// Derived physical stats of a Top: they follow from its Max Spin, Spin and Top Type.

const growth = (t: Top) => t.maxSpin / CONFIG.startMaxSpin;

export const radiusOf = (t: Top) => CONFIG.baseRadius * Math.sqrt(growth(t));

export const massOf = (t: Top) => growth(t) * TYPE_STATS[t.type].mass;

/** Mass as felt in a Clash: a Top low on Spin wobbles and is pushed further. */
export const steadyMassOf = (t: Top) => massOf(t) * (1 - CONFIG.spinSteadiness * (1 - t.spin / t.maxSpin));

export const decayRate = (t: Top) =>
  CONFIG.baseDecay * TYPE_STATS[t.type].decay * Math.pow(growth(t), CONFIG.decayGrowth);

export const maxSpeedOf = (t: Top) =>
  (CONFIG.maxSpeed * TYPE_STATS[t.type].speed) / Math.pow(growth(t), CONFIG.sizeSlowdown);
