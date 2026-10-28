// Quick estimate: the logic. Pure JavaScript (no React): the module's spec, the estimates scheduled from the
// seed (the Full Clearance game's own exercises), how an answer is judged, and the scoring.

import { acceptedRange, buildProblem, EXERCISE_TYPES } from "../../../games/estimation/logic.js";
import { createRandom, randomTools } from "../../../utils/random.js";

export const estimationSpec = {
  id: "estimation",
  title: "Quick estimate",
  competence: "mentalMath",
  secondary: [],
  task: "event",
  voice: false,
  load: 2,
  rule: "Now and then an estimate is asked: a calculation, a dot count, an angle or a comparison. Push the slider to run the number up or down: the further you push, the faster it goes. Your answer appears once you touch it and locks when the bar runs out. To compare, push toward the larger side.",
  recap: "estimate before the bar runs out",
  blocks: [{ key: "card", role: "display", h: 2, w: 2 }, { key: "slider", role: "control", h: 1, w: 4 }],
};

export const WINDOW_MS = 14000;
export const RESULT_MS = 2200;
export { acceptedRange };

// Same exercises as the Full Clearance game (all nine types), drawn from the seed.
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const problems = [];
  for (let at = rnd.int(4000, 6000); at < durationMs - WINDOW_MS - 1500; at += rnd.int(20000, 26000)) problems.push({ ...buildProblem(EXERCISE_TYPES, rnd.random), at });
  return problems;
}

// How an answer to a problem is judged: inside the accepted range (or the right side, for a comparison), and a
// precision from 1 (dead on) to 0 (30 % off or more).
export function judge(problem, answer) {
  const range = acceptedRange(problem);
  const correct = answer !== null && (problem.type === "compare" ? answer === problem.target : answer >= range.lower && answer <= range.upper);
  const precision = answer === null ? 0 : problem.type === "compare" ? Number(correct) : Math.max(0, 1 - Math.abs(answer - problem.target) / (Math.max(1, Math.abs(problem.target)) * 0.3));
  return { correct, precision, range };
}

// scores: one { correct, precision } per estimate locked; planned: how many estimates the flight asks.
export function emptyStats() { return { scores: [], planned: 1 }; }

// The average precision over every estimate the flight asks (one left unanswered counts 0).
export function moduleResult(spec, stats) {
  const count = Math.max(1, stats.planned);
  const scores = stats.scores.filter((score) => score && typeof score === "object");
  const total = scores.reduce((sum, score) => sum + Math.max(0, Math.min(1, Number(score.precision) || 0)), 0);
  return { performance: Math.max(0, Math.min(1, total / count)), detail: `${scores.filter((score) => score.correct).length}/${count} within range` };
}

// The flight nobody estimated: every estimate locks with no answer.
export function idleStats(spec, problems) {
  return { scores: problems.map(() => ({ correct: false, precision: 0 })), planned: problems.length };
}
