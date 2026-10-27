// Running Total: the logic. Pure JavaScript (no React, no React Native): the series, the daily progression and
// the results. Every generator takes `rnd` (the random tools of utils/random.js) so the same seed always gives
// the same series.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

const MULTIPLIERS = [2, 2, 3, 4, 4, 5, 5, 6, 8, 9, 10, 10, 12, 15, 20, 25];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Daily training: five series for everyone, longer and faster as they go. Each stage draws its length from its
// own range (so a day's ladder always ramps up), its operations from the seed, and is worth a fixed share of the
// 1000 points: 100 / 150 / 200 / 250 / 300, right or wrong.
export const DAILY_STAGES = [
  { pace: 3, operations: ["+", "-"], length: [5, 6], points: 100 },
  { pace: 3, operations: ["+", "-", "x", "/"], length: [6, 7], points: 150 },
  { pace: 2, operations: ["+", "-"], length: [7, 8], points: 200 },
  { pace: 2, operations: ["+", "-", "x", "/"], length: [8, 9], points: 250 },
  { pace: 1, operations: ["+", "-", "x", "/"], length: [9, 10], points: 300 },
];
// With all four signs allowed, the chance of a × or ÷ step eases slightly as the series gets longer: 40 % at
// five steps, 30 % at ten.
const productChance = (length) => 0.4 - 0.02 * (length - 5);

function chooseOperation(operations, history, rnd, length) {
  if (operations.length === 1) return operations[0];
  const previous = history.at(-1);
  const hasProducts = operations.includes("x") || operations.includes("/");
  let pool = operations;
  if (hasProducts && operations.length === 4) pool = rnd.chance(productChance(length)) ? ["x", "/"] : ["+", "-"];
  const candidates = pool.filter((operation) => operation !== previous);
  return rnd.item(candidates.length ? candidates : pool);
}

// One series: a starting value and a chain of operations, drawn from `rnd`.
export function buildSequence({ operations, operationCount }, rnd) {
  const hasProducts = operations.includes("x") || operations.includes("/");
  let total = hasProducts ? rnd.int(6, 20) : rnd.int(25, 99);
  const start = total;
  const steps = [];
  const history = [];
  for (let index = 0; index < operationCount; index += 1) {
    const operation = chooseOperation(operations, history, rnd, operationCount);
    let shown = operation;
    let operand;
    if (operation === "+") { operand = total < 100 ? rnd.int(4, 59) : rnd.int(10, 99); total += operand; }
    if (operation === "-") { operand = total > 20 ? rnd.int(2, Math.max(2, Math.min(total - 1, 59))) : rnd.int(1, Math.max(1, total - 1)); total -= operand; }
    if (operation === "x") { operand = rnd.item(MULTIPLIERS); if (total * operand > 9999) operand = rnd.item([2, 2, 3, 4, 5, 10]); total *= operand; }
    if (operation === "/") {
      const divisors = MULTIPLIERS.filter((divisor) => divisor > 1 && total % divisor === 0);
      if (!divisors.length) { shown = "+"; operand = rnd.int(4, 39); total += operand; }
      else { operand = rnd.item(divisors); total /= operand; }
    }
    steps.push({ operation: shown, operand });
    history.push(shown);
  }
  return { start, steps, answer: total };
}

// The day's five series.
export function buildDailySeries(seed) {
  const rnd = randomTools(createRandom(seed));
  return DAILY_STAGES.map((stage, index) => ({ stage: index, pace: stage.pace, points: stage.points, operations: stage.operations, ...buildSequence({ operations: stage.operations, operationCount: rnd.int(stage.length[0], stage.length[1]) }, rnd) }));
}

// A Full Clearance series from a seed.
export function buildSession({ operations, operationCount }, seed) {
  return buildSequence({ operations, operationCount }, randomTools(createRandom(seed)));
}

// The day's five series, from the daily seed.
export function buildDailyLadder(seed) {
  return buildDailySeries(deriveSeed(seed, "series"));
}

// The daily result from the answers ([{ ok, ms, answer, expected, length, pace, pts }]): the points of the
// series found (out of 1000), the metrics recorded, and the trials.
export function dailyResult(entries) {
  return {
    score: clamp(entries.reduce((sum, entry) => sum + entry.pts, 0), 0, 1000),
    metrics: { correct: entries.filter((entry) => entry.ok).length, series: entries.length, steps: entries.reduce((sum, entry) => sum + entry.length, 0), offByTen: entries.filter((entry) => !entry.ok && Math.abs(entry.answer - entry.expected) <= 10).length, meanAnswerMs: Math.round(entries.reduce((sum, entry) => sum + entry.ms, 0) / entries.length) },
    trials: entries,
  };
}
