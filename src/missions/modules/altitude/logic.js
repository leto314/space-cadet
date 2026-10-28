// Altitude hold: the logic. Pure JavaScript (no React): the module's spec, the flight plan drawn from the seed
// (gusts and band moves), the physics step and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const altitudeSpec = {
  id: "altitude",
  title: "Altitude hold",
  competence: "multitasking",
  secondary: ["attention"],
  task: "continuous",
  voice: false,
  load: 3,
  rule: "Your aircraft keeps drifting up and down. Hold the up or down arrows to keep it inside the band. The band moves from time to time.",
  recap: "hold your altitude",
  blocks: [{ key: "gauge", role: "display", h: 4, w: 1 }, { key: "control", role: "control", h: 2, w: 1, use: "frequent" }],
};

export const STEP_S = 1 / 30;
export const BAND_HALF = 0.1;
const THRUST = 0.9;
const DAMPING = 1.6;
const BAND_MOVE_S = 1.4;

// The whole flight is decided by the seed: gusts (drift changes) and the moments the target band moves.
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const seconds = durationMs / 1000;
  const gusts = [];
  for (let at = 0; at < seconds + 5; at += rnd.float(1.8, 3.8)) gusts.push({ at, accel: (rnd.chance(0.5) ? 1 : -1) * rnd.float(0.03, 0.09) });
  const bands = [{ at: 0, center: rnd.float(0.42, 0.58) }];
  for (let at = rnd.float(22, 30); at < seconds - 8; at += rnd.float(22, 34)) {
    let center;
    do center = rnd.float(0.25, 0.75); while (Math.abs(center - bands.at(-1).center) < 0.2);
    bands.push({ at, center });
  }
  return { gusts, bands };
}

// The simulation state at take-off.
export function initialState(plan) {
  const center = plan.bands[0].center;
  return { steps: 0, position: center, velocity: 0, accel: 0, gustIndex: 0, bandIndex: 0, bandFrom: center, center };
}

// One fixed step of the physics: the current gust, the band easing towards its new centre, the thrust the
// player applies ({ up, down }), damping, and the edges of the gauge. Counts the step in the stats.
export function advance(state, plan, thrust, stats) {
  const time = state.steps * STEP_S;
  while (state.gustIndex + 1 < plan.gusts.length && plan.gusts[state.gustIndex + 1].at <= time) state.gustIndex += 1;
  if (state.bandIndex + 1 < plan.bands.length && plan.bands[state.bandIndex + 1].at <= time) { state.bandFrom = state.center; state.bandIndex += 1; }
  const band = plan.bands[state.bandIndex];
  const progress = state.bandIndex === 0 ? 1 : Math.min(1, (time - band.at) / BAND_MOVE_S);
  state.center = state.bandFrom + (band.center - state.bandFrom) * (progress * progress * (3 - 2 * progress));
  state.accel += (plan.gusts[state.gustIndex].accel - state.accel) * 0.05;
  const push = (thrust.up ? THRUST : 0) - (thrust.down ? THRUST : 0);
  state.velocity += (state.accel + push - state.velocity * DAMPING) * STEP_S;
  state.position += state.velocity * STEP_S;
  if (state.position < 0.02) { state.position = 0.02; state.velocity = Math.max(0, state.velocity); }
  if (state.position > 0.98) { state.position = 0.98; state.velocity = Math.min(0, state.velocity); }
  stats.samples += 1;
  if (Math.abs(state.position - state.center) <= BAND_HALF) stats.inBand += 1;
  state.steps += 1;
}

export function emptyStats() { return { inBand: 0, samples: 0 }; }

// The share of the flight spent inside the band.
export function moduleResult(spec, stats) {
  const share = stats.samples > 0 ? Math.max(0, Math.min(1, stats.inBand / stats.samples)) : 0;
  return { performance: share, detail: `In the band ${Math.round(share * 100)}% of the time` };
}

// The flight nobody flew: gusts only, no thrust, sampled like the real one.
export function idleStats(spec, plan, { durationMs }) {
  const state = initialState(plan);
  const stats = emptyStats();
  const steps = Math.floor(durationMs / 1000 / STEP_S);
  while (state.steps < steps) advance(state, plan, { up: false, down: false }, stats);
  return stats;
}
