// Tank balance: the logic. Pure JavaScript (no React): the module's spec, the flow plan drawn from the seed,
// the simulation step and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const tanksSpec = {
  id: "tanks",
  title: "Tank balance",
  competence: "multitasking",
  secondary: ["logic"],
  task: "continuous",
  voice: false,
  load: 3,
  rule: "Keep every tank inside its white band. Buttons 1 to 4 open and close the pipes with the same number. Tank 1 slowly fills up, tanks 2 and 3 slowly empty, and tank 3's band shifts now and then. A glance every now and then is enough.",
  recap: "balance the tanks",
  blocks: [{ key: "display", role: "display", h: 2, w: 4 }, { key: "valves", role: "control", h: 2, w: 2 }],
};

export const STEP_S = 1 / 30;
const FLOW = 0.009;
export const BAND_HALF = [0.08, 0.08, 0.1];
const BAND_MOVE_S = 2;
// Valves, as [from, to] tank indexes.
export const VALVES = [[0, 1], [1, 0], [0, 2], [2, 1]];

// A "glance at it now and then" task, tuned by simulation on a 5-minute flight: a player checking every 20 s
// keeps ~65 % of the time in range, every 10 s ~80 %, every 3 s ~87 %. Tank 1 fills while tanks 2 and 3 drain
// very slowly, at rates that drift every 20–30 s but balance out on average; tank 3's band shifts every 60–80 s.
// Shorter flights drift proportionally faster, so the tanks leave their bands just as surely in two minutes as
// in five (left alone, the tanks are in range about a fifth of the time whatever the length).
export const REFERENCE_DURATION_MS = 300000;
export function driftFactor(durationMs) { return Math.max(1, REFERENCE_DURATION_MS / durationMs); }
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const seconds = durationMs / 1000;
  const factor = driftFactor(durationMs);
  const phases = [];
  for (let at = 0; at < seconds; at += rnd.float(20, 30)) {
    const drainTwo = rnd.float(0.0015, 0.003) * factor;
    const drainThree = rnd.float(0.0006, 0.0015) * factor;
    phases.push({ at, drainTwo, drainThree, inflow: (drainTwo + drainThree) * rnd.float(0.8, 1.25) });
  }
  const bandThree = [{ at: 0, center: rnd.float(0.4, 0.6) }];
  for (let at = rnd.float(60, 80); at < seconds - 15; at += rnd.float(60, 80)) {
    let center;
    do center = rnd.float(0.3, 0.7); while (Math.abs(center - bandThree.at(-1).center) < 0.15 || Math.abs(center - bandThree.at(-1).center) > 0.25);
    bandThree.push({ at, center });
  }
  const one = rnd.float(0.55, 0.72);
  const two = rnd.float(0.45, 0.62);
  return { phases, bandThree, fixed: [one, two], start: [one, two, bandThree[0].center] };
}

// The simulation state at take-off.
export function initialState(plan) {
  return { steps: 0, levels: [...plan.start], phase: 0, shift: 0, bandFrom: plan.start[2], center: plan.start[2] };
}

// The three bands [low, high] for a state.
export function bandsOf(plan, state) {
  return [[plan.fixed[0] - BAND_HALF[0], plan.fixed[0] + BAND_HALF[0]], [plan.fixed[1] - BAND_HALF[1], plan.fixed[1] + BAND_HALF[1]], [state.center - BAND_HALF[2], state.center + BAND_HALF[2]]];
}

// One fixed step: the current flow phase, tank 3's band easing to its new centre, the open valves moving fluid
// between tanks, then a sample of which tanks sit inside their band.
export function advance(state, plan, open, stats) {
  const time = state.steps * STEP_S;
  while (state.phase + 1 < plan.phases.length && plan.phases[state.phase + 1].at <= time) state.phase += 1;
  if (state.shift + 1 < plan.bandThree.length && plan.bandThree[state.shift + 1].at <= time) { state.bandFrom = state.center; state.shift += 1; }
  const band = plan.bandThree[state.shift];
  const progress = state.shift === 0 ? 1 : Math.min(1, (time - band.at) / BAND_MOVE_S);
  state.center = state.bandFrom + (band.center - state.bandFrom) * progress;
  const { inflow, drainTwo, drainThree } = plan.phases[state.phase];
  const change = [inflow, -drainTwo, -drainThree];
  VALVES.forEach(([from, to], valve) => {
    if (open[valve] && state.levels[from] > 0 && state.levels[to] < 1) { change[from] -= FLOW; change[to] += FLOW; }
  });
  state.levels = state.levels.map((value, tank) => Math.min(1, Math.max(0, value + change[tank] * STEP_S)));
  const bands = bandsOf(plan, state);
  state.levels.forEach((value, tank) => { if (value >= bands[tank][0] && value <= bands[tank][1]) stats.inBand[tank] += 1; });
  stats.samples += 1;
  state.steps += 1;
}

export function emptyStats() { return { inBand: [0, 0, 0], samples: 0 }; }

// The average, over the three tanks, of the share of the flight spent inside the band.
export function moduleResult(spec, stats) {
  const inBand = [0, 1, 2].map((tank) => stats.inBand[tank] ?? 0);
  const shares = inBand.map((count) => (stats.samples > 0 ? Math.max(0, Math.min(1, count / stats.samples)) : 0));
  return { performance: shares.reduce((sum, value) => sum + value, 0) / 3, detail: `In range ${shares.map((share) => `${Math.round(share * 100)}%`).join(" · ")}` };
}

// The flight nobody balanced: every valve closed, sampled like the real one.
export function idleStats(spec, plan, { durationMs }) {
  const state = initialState(plan);
  const stats = emptyStats();
  const steps = Math.floor(durationMs / 1000 / STEP_S);
  while (state.steps < steps) advance(state, plan, [false, false, false, false], stats);
  return stats;
}
