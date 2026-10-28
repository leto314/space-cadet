// Running total: the logic. Pure JavaScript (no React): the module's spec, the operations scripted from the
// seed, and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const runningTotalSpec = {
  id: "running-total",
  title: "Running total",
  competence: "mentalMath",
  secondary: ["memory"],
  task: "event",
  voice: false,
  load: 2,
  rule: "A starting number, then additions and subtractions appear one at a time. Keep the running total in your head. Three times the mission pauses and asks for it: type it and confirm. The real total is shown after each answer.",
  recap: "keep the running total",
  blocks: [{ key: "strip", role: "display", h: 1, w: 4 }],
};

export const OPERATION_MS = 2500;
export const PROMPT_MS = 12000;
export const RESULT_MS = 2500;
// When the total is asked, as shares of the flight.
export const PROMPT_POINTS = [0.38, 0.68, 0.94];

// The sequence of operations comes from the seed; the total stays between 0 and 199. Questions pause the stream.
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  let total = rnd.int(20, 60);
  const events = [{ at: 1200, type: "start", value: total, total }];
  const prompts = PROMPT_POINTS.map((point) => Math.round(point * durationMs));
  for (let at = 6000; at < durationMs - 3000; at += rnd.int(6000, 9000)) {
    if (prompts.some((time) => at > time - OPERATION_MS && at < time + PROMPT_MS + RESULT_MS)) continue;
    const size = rnd.chance(0.2) ? rnd.int(10, 15) : rnd.int(1, 9);
    const sign = total - size < 0 ? 1 : total + size > 199 ? -1 : rnd.item([1, -1]);
    total += sign * size;
    events.push({ at, type: "operation", value: sign * size, total });
  }
  prompts.forEach((at) => events.push({ at, type: "prompt" }));
  events.sort((a, b) => a.at - b.at);
  let running = null;
  events.forEach((event) => { if (event.type === "prompt") event.total = running; else running = event.total; });
  return events;
}

// outcomes: one boolean per question (true when the total typed was right).
export function emptyStats() { return { outcomes: [] }; }

// Each of the PROMPT_POINTS questions is worth a third.
export function moduleResult(spec, stats) {
  const correct = Math.min(PROMPT_POINTS.length, stats.outcomes.filter(Boolean).length);
  return { performance: Math.max(0, Math.min(1, correct / PROMPT_POINTS.length)), detail: `${correct}/${PROMPT_POINTS.length} totals right` };
}

// The flight nobody counted: every question skipped.
export function idleStats(spec, events) {
  return { outcomes: events.filter((event) => event.type === "prompt").map(() => false) };
}
