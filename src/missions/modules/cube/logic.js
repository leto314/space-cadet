// Cube tracking: the logic. Pure JavaScript (no React): the module's spec, the rolls and questions drawn from
// the seed, the cube's rotation arithmetic and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const cubeSpec = {
  id: "cube",
  title: "Cube tracking",
  competence: "spatial",
  secondary: ["memory"],
  task: "event",
  voice: false,
  load: 2,
  rule: "Remember the highlighted face: it becomes plain after a few seconds. Every now and then the cube rolls a quarter turn; the light and a vibration warn you just before. Keep track of where that face goes: near the end you will be asked where it is now.",
  recap: "track the cube's marked face",
  blocks: [{ key: "cube", role: "display", h: 2, w: 2 }],
};

export const ROLL_MS = 650;
export const WARNING_MS = 1500;
export const MARK_VISIBLE_MS = 3000;
export const ANSWER_LEAD_MS = 10000;
export const IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export const multiply = (a, b) => a.map((row) => [0, 1, 2].map((column) => row.reduce((sum, value, k) => sum + value * b[k][column], 0)));
export const apply = (m, v) => m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
export function rotation(axis, degrees) {
  const r = (degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return axis === "x" ? [[1, 0, 0], [0, c, -s], [0, s, c]] : [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
export const snap = (m) => m.map((row) => row.map((value) => Math.round(value)));

// Where the marked face (initially facing the player) points now, in the player's frame.
export function markedDirection(matrix) {
  const [x, y, z] = apply(matrix, [0, 0, 1]);
  if (Math.abs(x) > 0.5) return x > 0 ? "right" : "left";
  if (Math.abs(y) > 0.5) return y > 0 ? "top" : "bottom";
  return z > 0 ? "front" : "back";
}

// The rolls (when, which axis, which way) and the moments a question is asked: one near the end, plus one
// halfway through on a long flight.
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const questions = durationMs >= 240000 ? [durationMs / 2, durationMs - ANSWER_LEAD_MS] : [durationMs - ANSWER_LEAD_MS];
  const rolls = [];
  for (let at = rnd.int(6000, 9000); at < durationMs - ANSWER_LEAD_MS - 2000; at += rnd.int(10000, 16000)) {
    if (questions.some((time) => at > time - 2000 && at < time + ANSWER_LEAD_MS)) continue;
    rolls.push({ at, axis: rnd.item(["x", "y"]), direction: rnd.item([1, -1]) });
  }
  return { rolls, questions };
}

// outcomes: one boolean per question (true when the right face was picked); questions: how many the flight asks.
export function emptyStats() { return { outcomes: [], questions: 1, rolls: 0 }; }

// Each question is worth an equal share.
export function moduleResult(spec, stats) {
  const questions = Math.max(1, stats.questions);
  const correct = Math.min(questions, stats.outcomes.filter(Boolean).length);
  return { performance: Math.max(0, Math.min(1, correct / questions)), detail: `${correct}/${questions} final positions right · ${stats.rolls} rolls` };
}

// The flight nobody watched: every question left unanswered.
export function idleStats(spec, plan) {
  return { outcomes: plan.questions.map(() => false), questions: plan.questions.length, rolls: plan.rolls.length };
}
