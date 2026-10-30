// Flash Math: the logic. Pure JavaScript (no React, no React Native): the expressions, the daily ladder and
// the results. Every generator takes `rnd` (the random tools of utils/random.js) so the same seed always gives
// the same questions.

import { createRandom, deriveSeed, drawFresh, randomTools } from "../../utils/random.js";

export const OPS = [{ value: "+", label: "+", name: "addition" }, { value: "-", label: "−", name: "subtraction" }, { value: "×", label: "×", name: "multiplication" }, { value: "÷", label: "÷", name: "division" }];
const MULTIPLIERS = [2, 2, 3, 4, 4, 5, 5, 6, 8, 9, 10, 10, 12, 15, 20, 25, 50];
const TABLE_FACTORS = [3, 4, 5, 6, 7, 8, 9, 11, 12];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Daily training: a ladder of 25 questions in 5 stages of 5, 2 minutes for everyone, 40 points per right answer.
// The ladder itself carries the difficulty (you cannot reach question 20 without doing 1 to 19), so every
// question is worth the same and 25 / 25 in time is out of reach for almost everyone.
export const DAILY_SECONDS = 120;
export const DAILY_STAGES = [
  { label: "ONE OPERATION", operations: ["+", "-"], operationCount: 1, questions: 5 },
  { label: "TWO OPERATIONS", operations: ["+", "-"], operationCount: 2, questions: 5 },
  { label: "TIMES AND DIVIDE", operations: ["×", "÷"], operationCount: 1, questions: 5 },
  { label: "ALL SIGNS", operations: ["+", "-", "×", "÷"], operationCount: 2, questions: 5, requireProduct: true },
  { label: "THREE OPERATIONS", operations: ["+", "-", "×", "÷"], operationCount: 3, questions: 5, requireProduct: true },
];
export const DAILY_QUESTIONS = DAILY_STAGES.reduce((sum, stage) => sum + stage.questions, 0);
export const POINTS_PER_QUESTION = 1000 / DAILY_QUESTIONS;

// One expression, drawn from `rnd` (a seeded generator in the daily version, a random one otherwise).
export function buildProblem({ operations, operationCount, history }, rnd) {
  const count = operationCount === "random" ? rnd.int(1, 3) : operationCount;
  const firstCandidates = operations.filter((item) => item !== history.at(-1));
  const first = operations.length === 1 ? operations[0] : rnd.item(firstCandidates.length ? firstCandidates : operations);
  const sequence = [first];
  while (sequence.length < count) { const candidates = operations.filter((item) => item !== sequence.at(-1)); sequence.push(rnd.item(candidates.length ? candidates : operations)); }
  let total = operations.includes("×") || operations.includes("÷") ? rnd.int(2, 20) : rnd.int(12, 99);
  // A × or ÷ as the first step is a proper times-table question (13 × 7, 84 ÷ 7), not 3 × 2 or 60 ÷ 10.
  if (first === "×") total = rnd.int(3, 19);
  if (first === "÷") { const divisor = rnd.item(TABLE_FACTORS); total = divisor * rnd.int(3, 19); }
  const tokens = [total];
  sequence.forEach((operation, index) => {
    let actual = operation; let operand;
    if (operation === "+") { operand = total < 100 ? rnd.int(4, 79) : rnd.int(10, 99); total += operand; }
    else if (operation === "-") { operand = total > 25 ? rnd.int(3, Math.max(3, Math.min(total - 1, 79))) : rnd.int(1, Math.max(1, total - 1)); total -= operand; }
    else if (operation === "×") { operand = index === 0 ? rnd.item(TABLE_FACTORS) : rnd.item(total * 10 > 9999 ? [2, 2, 3, 4, 5, 10] : MULTIPLIERS); total *= operand; }
    else { const divisors = (index === 0 ? TABLE_FACTORS : MULTIPLIERS).filter((item) => item > 1 && total % item === 0); if (!divisors.length) { actual = "+"; operand = rnd.int(4, 49); total += operand; } else { operand = rnd.item(divisors); total /= operand; } }
    tokens.push(actual, operand);
  });
  let expression = `${tokens[0]} ${tokens[1]} ${tokens[2]}`;
  for (let index = 3; index < tokens.length; index += 2) expression = `(${expression}) ${tokens[index]} ${tokens[index + 1]}`;
  return { answer: total, expression, primaryOperation: first };
}

// What makes two questions the same: their first calculation, operands in order for + and ×. "14 × 12",
// "12 × 14" and "(14 × 12) + 30" all start with the same calculation, so a session asks only one of them.
const COMMUTATIVE = ["+", "×"];
export function firstCalculation(expression) {
  const [left, operation, right] = expression.replace(/[()]/g, "").split(" ");
  const [a, b] = COMMUTATIVE.includes(operation) ? [left, right].sort((x, y) => Number(x) - Number(y)) : [left, right];
  return `${a} ${operation} ${b}`;
}
const problemKey = (problem) => firstCalculation(problem.expression);

// The day's 25 questions, in order, each tagged with its stage, never the same calculation twice.
export function buildDailyProblems(seed) {
  const rnd = randomTools(createRandom(seed));
  const history = [];
  const asked = new Set();
  return DAILY_STAGES.flatMap((stage, stageIndex) => Array.from({ length: stage.questions }, () => {
    const problem = drawFresh(() => {
      let candidate;
      // An "all signs" question must actually use a × or a ÷.
      for (let attempt = 0; attempt < 12; attempt += 1) { candidate = buildProblem({ operations: stage.operations, operationCount: stage.operationCount, history }, rnd); if (!stage.requireProduct || /[×÷]/.test(candidate.expression)) break; }
      return candidate;
    }, problemKey, asked);
    history.push(problem.primaryOperation);
    return { ...problem, stage: stageIndex };
  }));
}

// A Full Clearance session: an endless stream of expressions from a seed, drawn one at a time with `next()`
// (the last twelve first operations are remembered so the same sign does not come twice in a row, and no
// calculation comes back until every possible one has been asked).
export function createSession({ operations, operationCount }, seed) {
  const rnd = randomTools(createRandom(seed));
  let history = [];
  const asked = new Set();
  return {
    next() {
      const problem = drawFresh(() => buildProblem({ operations, operationCount, history }, rnd), problemKey, asked);
      history = [...history, problem.primaryOperation].slice(-12);
      return problem;
    },
  };
}

// The ready screen's illustration: one expression for the chosen settings, from a seed.
export function sampleProblem(settings, seed) {
  return buildProblem({ ...settings, history: [] }, randomTools(createRandom(seed)));
}

// The day's ladder, from the daily seed.
export function buildDailyLadder(seed) {
  return buildDailyProblems(deriveSeed(seed, "ladder"));
}

// The daily result from the answers ([{ ok, ms, stage }]) and the ladder: 40 points per right answer, the
// metrics recorded, and the trials.
export function dailyResult(results, ladder) {
  const correct = results.filter((entry) => entry.ok).length;
  const times = results.filter((entry) => entry.ok).map((entry) => entry.ms);
  const stageReached = results.length ? ladder[results.length - 1].stage + 1 : 0;
  return {
    score: clamp(Math.round(correct * POINTS_PER_QUESTION), 0, 1000),
    metrics: { correct, answered: results.length, questions: DAILY_QUESTIONS, stageReached, accuracy: results.length ? Math.round((correct / results.length) * 100) : 0, meanCorrectMs: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null },
    trials: results,
  };
}
