// Estimation: the logic. Pure JavaScript (no React, no React Native): the problems, the points of an estimate,
// the accepted range, the daily progression and the results. Every generator takes `random` (a Math.random-like
// function, see utils/random.js) so the same seed always gives the same estimates.

import { createRandom, deriveSeed, drawFresh, randomTools } from "../../utils/random.js";

export const TYPES = [
  { value: "all", label: "ALL" }, { value: "multiply", label: "PRODUCT" }, { value: "divide", label: "QUOTIENT" }, { value: "percent", label: "PERCENTAGE" },
  { value: "sum", label: "SUM" }, { value: "compare", label: "COMPARE" }, { value: "increase", label: "CHANGE" }, { value: "missing", label: "MISSING" },
  { value: "points", label: "DOT COUNT" }, { value: "angle", label: "ANGLES" },
];
export const EXERCISE_TYPES = TYPES.filter((item) => item.value !== "all").map((item) => item.value);
const randomInt = (random, min, max) => Math.floor(random() * (max - min + 1)) + min;
const randomItem = (random, items) => items[Math.floor(random() * items.length)];
export const formatNumber = (value) => Math.round(value).toLocaleString("en-US");
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Timing: how long the dots stay on screen before they are hidden, the limit to answer one estimate (whatever
// is typed is then submitted), and the pause showing the target and the points.
export const LOOK_MS = 4000;
export const ANSWER_LIMIT_MS = 15000;
export const FEEDBACK_MS = 1100;

// Points of an estimate (0–100) from its relative error: 100 within the `full` band, then falling evenly to 0
// at the `zero` band, both set per type (counting dots or reading an angle is harder to nail than 20 % of 300).
// Compare questions are right or wrong. No time weighting: the limit above is the only clock.
//   dots, 15 blue: 13–17 → 100 · 12 or 18 → 80 · 19 → 53 · 10 → 27 · 8 or 22 → 0
export const TOLERANCES = {
  multiply: { full: 0.04, zero: 0.28 }, divide: { full: 0.04, zero: 0.28 }, percent: { full: 0.03, zero: 0.25 }, sum: { full: 0.03, zero: 0.2 },
  increase: { full: 0.08, zero: 0.4 }, missing: { full: 0.05, zero: 0.3 }, points: { full: 0.15, zero: 0.4 }, angle: { full: 0.06, zero: 0.3 },
};
export function estimatePoints(problem, answer) {
  if (answer === null || answer === undefined || Number.isNaN(answer)) return 0;
  if (problem.type === "compare") return answer === problem.target ? 100 : 0;
  const { full, zero } = TOLERANCES[problem.type];
  const error = Math.abs(answer - problem.target) / Math.max(1, Math.abs(problem.target));
  return clamp(Math.round(100 * clamp(1 - (error - full) / (zero - full), 0, 1)), 0, 100);
}

// What makes two estimates the same question: the prompt for a calculation, the angle for an angle (whatever
// its rotation), the products for a comparison (whichever side), the dots themselves for a count.
export function problemKey(problem) {
  if (problem.type === "angle") return `angle ${problem.angle}`;
  if (problem.type === "points") return `dots ${JSON.stringify(problem.points)}`;
  if (problem.type === "compare") return `compare ${[...problem.compareLabels].sort().join(" / ")}`;
  return problem.prompt;
}

// Daily training: twelve estimates for everyone, every type once plus three more, in a seeded order, never the
// same question twice (a repeat is drawn again from the next seed of its slot).
export const DAILY_COUNT = 12;
export function buildDailyProblems(seed) {
  const rnd = randomTools(createRandom(seed));
  const types = rnd.shuffle([...EXERCISE_TYPES, ...Array.from({ length: DAILY_COUNT - EXERCISE_TYPES.length }, () => rnd.item(EXERCISE_TYPES))]);
  const asked = new Set();
  return types.map((type, index) => {
    let attempt = 0;
    const draw = () => buildProblem([type], createRandom(deriveSeed(seed, attempt++ === 0 ? `estimate-${index}` : `estimate-${index}:${attempt - 1}`)));
    return drawFresh(draw, problemKey, asked);
  });
}

function buildPoints(random) {
  const count = randomInt(random, 18, 48);
  const blueOnly = random() < 0.45;
  const points = Array.from({ length: count }, () => ({ x: randomInt(random, 8, 92), y: randomInt(random, 9, 91), blue: random() < 0.36 }));
  return { type: "points", title: "DOT COUNT", prompt: blueOnly ? "How many blue dots?" : "How many dots?", target: blueOnly ? points.filter((point) => point.blue).length : count, step: 1, tolerance: 0.35, points };
}

// The angle to estimate is exactly the one drawn (an arc marks it): any whole degree from 15° to 345°, reflex
// angles included, the figure turned by a random amount so the first ray is not always vertical.
export const ANGLES = Array.from({ length: 331 }, (_, index) => 15 + index);
function buildAngle(random) {
  const angle = randomItem(random, ANGLES);
  const rotation = randomInt(random, 0, 359);
  return { type: "angle", title: "ANGLES", prompt: "Estimate the marked angle.", target: angle, step: 1, tolerance: 0.2, angle, rotation };
}

// One problem of one of `types`, drawn from `random` (a Math.random-like function, see utils/random.js).
export function buildProblem(types, random) {
  return buildProblemOf(randomItem(random, types), random);
}
function buildProblemOf(type, random) {
  if (type === "points") return buildPoints(random);
  if (type === "angle") return buildAngle(random);
  if (type === "multiply") { const a = randomInt(random, 28, 94); const b = randomInt(random, 19, 58); return { type, title: "PRODUCT", prompt: a + " × " + b + " ≈ ?", target: a * b, step: 10, tolerance: 0.28 }; }
  if (type === "divide") { const divisor = randomInt(random, 13, 36); const quotient = randomInt(random, 18, 58); const dividend = divisor * quotient + randomItem(random, [-2, -1, 0, 1, 2]); return { type, title: "QUOTIENT", prompt: dividend + " ÷ " + divisor + " ≈ ?", target: dividend / divisor, step: 1, tolerance: 0.28 }; }
  if (type === "percent") { const percent = randomItem(random, [8, 10, 12, 15, 18, 20, 25, 30]); const total = randomInt(random, 14, 48) * 10; return { type, title: "PERCENTAGE", prompt: percent + "% of " + total + " ≈ ?", target: percent * total / 100, step: 1, tolerance: 0.25 }; }
  if (type === "sum") { const a = randomInt(random, 95, 298); const b = randomInt(random, 180, 549); const c = randomInt(random, 45, 180); return { type, title: "SUM", prompt: a + " + " + b + " + " + c + " ≈ ?", target: a + b + c, step: 5, tolerance: 0.2 }; }
  if (type === "compare") { const a = [randomInt(random, 22, 72), randomInt(random, 14, 54)]; const b = [randomInt(random, 22, 72), randomInt(random, 14, 54)]; if (Math.abs(a[0] * a[1] - b[0] * b[1]) < 120) b[0] += 11; return { type, title: "COMPARE", prompt: "Which product is larger?", target: a[0] * a[1] > b[0] * b[1] ? -1 : 1, compareLabels: [a[0] + " × " + a[1], b[0] + " × " + b[1]] }; }
  if (type === "increase") { const start = randomInt(random, 12, 28) * 100; const rate = randomItem(random, [8, 10, 12, 15, 18, 20, 25]); return { type, title: "PERCENT CHANGE", prompt: formatNumber(start) + " → " + formatNumber(Math.round(start * (1 + rate / 100))) + " ≈ + ?%", target: rate, step: 1, tolerance: 0.3 }; }
  const multiplier = randomInt(random, 24, 68); const target = randomInt(random, 13, 42) * 100;
  return { type: "missing", title: "MISSING VALUE", prompt: multiplier + " × ? ≈ " + formatNumber(target), target: target / multiplier, step: 1, tolerance: 0.3 };
}

export function acceptedRange(problem) {
  if (!problem || problem.type === "compare") return null;
  const minimum = problem.type === "points" ? 1 : problem.type === "angle" ? 8 : problem.step;
  const delta = Math.max(minimum, Math.round((Math.abs(problem.target) * 0.15) / problem.step) * problem.step);
  const lower = Math.max(0, Math.round((problem.target - delta) / problem.step) * problem.step);
  const upper = Math.round((problem.target + delta) / problem.step) * problem.step;
  return { lower, upper, delta };
}

// A Full Clearance session: an endless stream of problems of the chosen types, from a seed, drawn one at a time
// with `next()`. `types` may be ["all"]. No question comes back until every possible one has been asked.
export function createSession(types, seed) {
  const random = createRandom(seed);
  const pool = types.includes("all") ? EXERCISE_TYPES : types;
  const asked = new Set();
  return { next: () => drawFresh(() => buildProblem(pool, random), problemKey, asked) };
}

// The day's twelve estimates, from the daily seed.
export function buildDailyEstimates(seed) {
  return buildDailyProblems(deriveSeed(seed, "estimates"));
}

// The Full Clearance summary from the answers ([{ pts, ms, answer, … }]).
export function sessionSummary(entries) {
  const points = entries.reduce((sum, entry) => sum + entry.pts, 0);
  return { estimates: entries.length, score: entries.length ? clamp(Math.round((points / entries.length) * 10), 0, 1000) : 0, meanPoints: entries.length ? Math.round(points / entries.length) : 0, close: entries.filter((entry) => entry.pts >= 80).length, meanMs: entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.ms, 0) / entries.length) : null };
}

// The daily result: the twelve estimates' points scaled to 1000, the metrics recorded, and the trials.
export function dailyResult(entries) {
  const points = entries.reduce((sum, entry) => sum + entry.pts, 0);
  const summary = sessionSummary(entries);
  return {
    score: clamp(Math.round(points * (1000 / (DAILY_COUNT * 100))), 0, 1000),
    metrics: { estimates: entries.length, close: summary.close, meanPoints: summary.meanPoints, meanMs: summary.meanMs, unanswered: entries.filter((entry) => entry.answer === null).length },
    trials: entries,
  };
}
