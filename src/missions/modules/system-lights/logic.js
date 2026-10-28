// System lights: the logic. Pure JavaScript (no React): the module's spec, the faults scheduled from the seed,
// and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const systemLightsSpec = {
  id: "system-lights",
  title: "System lights",
  competence: "attention",
  secondary: [],
  task: "event",
  voice: false,
  load: 2,
  rule: "The top lights must stay on and the bottom lights must stay off. As soon as one changes, tap it to reset it. Tapping a normal light counts as an error.",
  recap: "watch the system lights",
  blocks: [{ key: "panel", role: "display", h: 2, w: 2 }],
};

export const RESPONSE_WINDOW_MS = 6000;
export const AUTO_RESET_MS = 8000;
export const FALSE_ALARM_COST = 0.08;
export const NORMALLY_ON = [true, true, false, false];

// Faults are scheduled from the seed: when they happen and which light fails.
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const faults = [];
  for (let at = rnd.int(5000, 8000); at < durationMs - 4000; at += rnd.int(6000, 12000)) faults.push({ at, light: rnd.int(0, 3) });
  return faults;
}

// outcomes: one entry per fault, { hit, reactionMs } when tapped in time, { hit: false } when missed.
export function emptyStats() { return { outcomes: [], falseAlarms: 0 }; }

// Each fault caught is worth 1 at once, 0.4 at the end of the window, nothing when missed; each false alarm
// costs FALSE_ALARM_COST. No fault measured yet scores 0.
export function moduleResult(spec, stats) {
  const outcomes = stats.outcomes.filter((outcome) => outcome && typeof outcome === "object");
  const scores = outcomes.map((outcome) => (outcome.hit ? Math.max(0, 1 - 0.6 * ((outcome.reactionMs ?? 0) / RESPONSE_WINDOW_MS)) : 0));
  const caught = outcomes.filter((outcome) => outcome.hit);
  const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  const average = caught.length ? caught.reduce((sum, outcome) => sum + (outcome.reactionMs ?? 0), 0) / caught.length / 1000 : null;
  return {
    performance: Math.max(0, Math.min(1, mean - FALSE_ALARM_COST * stats.falseAlarms)),
    detail: `${caught.length}/${outcomes.length} faults caught${average !== null ? ` · ${average.toFixed(1)} s avg` : ""}${stats.falseAlarms ? ` · ${stats.falseAlarms} false` : ""}`,
  };
}

// The flight nobody watched: every fault missed.
export function idleStats(spec, faults) {
  return { outcomes: faults.map(() => ({ hit: false })), falseAlarms: 0 };
}
