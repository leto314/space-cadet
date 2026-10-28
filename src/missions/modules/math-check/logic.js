// Calculation check: the logic. Pure JavaScript (no React): the module's spec, the equations drawn from the
// seed, and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const mathCheckSpec = {
  id: "math-check",
  title: "Calculation check",
  competence: "mentalMath",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 1,
  rule: "Tap the calculation when it is right. Leave the wrong ones alone: after 10 seconds, the next calculation appears. Tapping a wrong one counts as an error.",
  recap: "catch the right calculations",
  blocks: [{ key: "display", role: "display", h: 2, w: 2 }],
};

export const ANSWER_WINDOW_MS = 10000;
// More equations than a flight can show (one every 10 s at the slowest), so the stream never runs dry.
const EQUATION_COUNT = 200;

// Half the equations are right; wrong ones are off by a plausible slip (±1, ±2 or ±10), never absurd.
export function buildContent(spec, seed) {
  const rnd = randomTools(createRandom(seed));
  return Array.from({ length: EQUATION_COUNT }, () => {
    const operator = rnd.item(["+", "+", "−", "×"]);
    let a; let b; let result;
    if (operator === "+") { a = rnd.int(12, 89); b = rnd.int(5, 49); result = a + b; }
    else if (operator === "−") { a = rnd.int(24, 99); b = rnd.int(5, a - 8); result = a - b; }
    else { a = rnd.int(3, 12); b = rnd.int(3, 9); result = a * b; }
    const correct = rnd.chance(0.5);
    const shown = correct ? result : result + rnd.item([-10, -2, -1, 1, 2, 10].filter((offset) => result + offset > 0));
    return { expression: `${a} ${operator} ${b}`, result: `= ${shown}`, correct };
  });
}

// hits: right ones tapped · misses: right ones left alone · falseAlarms: wrong ones tapped · rejections: wrong
// ones left alone.
export function emptyStats() { return { hits: 0, misses: 0, falseAlarms: 0, rejections: 0 }; }

// Rewards catching the right ones without tapping the wrong ones: hit rate × (1 − false alarm rate).
export function moduleResult(spec, stats) {
  const { hits, misses, falseAlarms, rejections } = stats;
  const hitRate = hits + misses > 0 ? hits / (hits + misses) : 0;
  const falseRate = falseAlarms + rejections > 0 ? falseAlarms / (falseAlarms + rejections) : 0;
  const performance = Math.max(0, Math.min(1, hitRate * (1 - falseRate)));
  return { performance, detail: `${hits}/${hits + misses} right ones caught${falseAlarms ? ` · ${falseAlarms} wrong taps` : ""}` };
}

// The flight nobody played: every calculation times out, the right ones as misses, the wrong ones as rejections.
export function idleStats(spec, equations, { durationMs }) {
  const shown = Math.max(0, Math.floor(durationMs / ANSWER_WINDOW_MS));
  const stats = emptyStats();
  for (let index = 0; index < shown; index += 1) { if (equations[index % equations.length].correct) stats.misses += 1; else stats.rejections += 1; }
  return stats;
}
