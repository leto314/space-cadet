// No repeated questions: within one session (daily or Full Clearance), a game never asks the same question twice.
//   node --test "scripts/games/no-repeats.test.mjs"
//
// "The same question" is defined game by game (the `key` of each entry below): in Flash Math it is the first
// calculation of an expression, so "14 × 12" in one question and "(14 × 12) + 30" in another count as a repeat
// (and "12 × 14" too). Games built on repetition are left out on purpose: N-back, Reaction Time, Selective
// Attention, Anomaly Detection, Airways, Target Drift and Visual Memory (their stimuli come back by design), Cube
// Rotation (a set of turns, never a question), and Visual Scan (one grid per size, so nothing to repeat).

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import * as circuits from "../../src/games/circuits/logic.js";
import * as continuousTotal from "../../src/games/continuous-total/logic.js";
import * as cubeNets from "../../src/games/cube-nets/logic.js";
import * as estimation from "../../src/games/estimation/logic.js";
import * as landingOrder from "../../src/games/landing-order/logic.js";
import * as memorySpan from "../../src/games/memory-span/logic.js";
import * as mentalMath from "../../src/games/mental-math/logic.js";
import * as patternMatrix from "../../src/games/pattern-matrix/logic.js";
import * as spatialBeacon from "../../src/games/spatial-beacon/logic.js";
import * as switchboard from "../../src/games/switchboard/logic.js";
import * as turnCount from "../../src/games/turn-count/logic.js";
import { createRandom, drawFresh, hashString } from "../../src/utils/random.js";

// A year of daily seeds, built like the real ones (one per game and day), and a hundred free-session seeds per
// setting. Games marked `heavy` (their generator searches for a valid puzzle, 10–20 ms a session) get 90 days
// and 25 sessions per setting, so the whole file stays fast.
const DAYS = Array.from({ length: 365 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
const dailySeeds = (gameKey, heavy) => DAYS.slice(0, heavy ? 90 : DAYS.length).map((day) => ({ label: day, seed: hashString(`space-cadet:daily:${day}:${gameKey}:null`) }));
const FREE_SEEDS = Array.from({ length: 100 }, (_, index) => ({ label: `seed ${index * 7919 + 13}`, seed: index * 7919 + 13 }));
const freeSeeds = (heavy) => FREE_SEEDS.slice(0, heavy ? 25 : FREE_SEEDS.length);
const take = (session, count) => Array.from({ length: count }, () => session.next());

// The first pair of questions sharing a key, or null.
function firstRepeat(questions, keyOf) {
  const seen = new Map();
  for (let index = 0; index < questions.length; index += 1) {
    const key = keyOf(questions[index]);
    if (seen.has(key)) return { key, first: seen.get(key) + 1, second: index + 1 };
    seen.set(key, index);
  }
  return null;
}
function assertNoRepeat(questions, keyOf, where) {
  const repeat = firstRepeat(questions, keyOf);
  if (repeat) assert.fail(`${where}: "${repeat.key.length > 90 ? `${repeat.key.slice(0, 90)}…` : repeat.key}" is asked in question ${repeat.first} and again in question ${repeat.second}`);
}

// Flash Math: the first calculation of the expression, operands sorted for + and ×.
const COMMUTATIVE = ["+", "×"];
export function firstStep(expression) {
  const [left, operation, right] = expression.replace(/[()]/g, "").split(" ");
  const [a, b] = COMMUTATIVE.includes(operation) ? [left, right].sort((x, y) => Number(x) - Number(y)) : [left, right];
  return `${a} ${operation} ${b}`;
}
const estimateKey = (problem) => problem.type === "angle" ? `${problem.target}° angle` : problem.type === "points" ? `dots ${JSON.stringify(problem.points)}` : problem.type === "compare" ? `compare ${[...problem.compareLabels].sort().join(" / ")}` : problem.prompt;
const beaconKey = (trial) => trial.mode === "easy" ? `heading ${trial.heading}` : `${trial.mode}: heading ${trial.heading}, beacon ${trial.answerAngle}`;

const GAMES = [
  {
    name: "Flash Math",
    key: (problem) => firstStep(problem.expression),
    daily: (seed) => mentalMath.buildDailyLadder(seed),
    free: [
      ...[["+", "-"], ["×"], ["÷"], ["×", "÷"], ["+", "-", "×", "÷"]].flatMap((operations) => [1, 2, 3, "random"].map((operationCount) => ({ label: `${operations.join(" ")}, ${operationCount} operation(s), 40 questions`, build: (seed) => take(mentalMath.createSession({ operations, operationCount }, seed), 40) }))),
    ],
  },
  {
    name: "Estimation",
    key: estimateKey,
    daily: (seed) => estimation.buildDailyEstimates(seed),
    free: [["all"], ...estimation.EXERCISE_TYPES.map((type) => [type])].map((types) => ({ label: `${types[0]}, 25 questions`, build: (seed) => take(estimation.createSession(types, seed), 25) })),
  },
  {
    name: "Heading and Beacon",
    key: beaconKey,
    daily: (seed) => spatialBeacon.buildDailyTrials(seed),
    free: spatialBeacon.MODES.map((mode) => ({ label: `${mode}, 15 rounds`, build: (seed) => spatialBeacon.buildSession({ mode, roundCount: 15 }, seed) })),
  },
  {
    name: "Cube Nets",
    heavy: true,
    key: (puzzle) => JSON.stringify({ mode: puzzle.mode, net: puzzle.net, views: puzzle.views }),
    daily: (seed) => cubeNets.buildDailyPuzzles(seed),
    free: ["fold", "refold", "unfold", "mixed"].flatMap((mode) => ["easy", "hard", "progressive"].map((difficulty) => ({ label: `${mode}, ${difficulty}, 12 puzzles`, build: (seed) => cubeNets.buildSession({ mode, puzzleCount: 12, difficulty }, seed) }))),
  },
  {
    name: "Circuits",
    heavy: true,
    key: (circuit) => JSON.stringify({ mode: circuit.mode, layers: circuit.layers, inputs: circuit.inputs, target: circuit.target }),
    daily: (seed) => circuits.buildDailySession(seed),
    free: ["gate", "inputs", "outputs", "mixed"].flatMap((mode) => [{ withXor: false, withNegated: false }, { withXor: true, withNegated: true }].map((gates) => ({ label: `${mode}, ${gates.withXor ? "all gates" : "basic gates"}, 8 circuits`, build: (seed) => circuits.buildSession({ mode, circuitCount: 8, gateSet: circuits.gateSetFor(gates) }, seed) }))),
  },
  {
    name: "Landing Order",
    heavy: true,
    key: (scenario) => JSON.stringify({ names: scenario.names, pos: scenario.pos, question: scenario.question.type, actors: scenario.question.actors }),
    daily: (seed) => landingOrder.buildDailySession(seed),
    free: [3, 4, 5, 6].flatMap((aircraftCount) => [false, true].map((memorise) => ({ label: `${aircraftCount} aircraft${memorise ? ", memorise" : ""}, 8 scenarios`, build: (seed) => landingOrder.buildSession({ aircraftCount, scenarioCount: 8, memorise }, seed) }))),
  },
  {
    name: "Pattern Matrix",
    key: (puzzle) => JSON.stringify({ panels: puzzle.panels, answer: puzzle.answer }),
    daily: (seed) => patternMatrix.buildDailySession(seed),
    free: ["easy", "medium", "hard", "progressive"].map((difficulty) => ({ label: `${difficulty}, 8 matrices`, build: (seed) => patternMatrix.buildSession({ puzzleCount: 8, optionCount: 4, difficulty }, seed) })),
  },
  {
    name: "Switchboard",
    key: (panel) => JSON.stringify({ switches: panel.switches, target: panel.target }),
    daily: (seed) => switchboard.buildDailySession(seed),
    free: [],
  },
  {
    name: "Memory Sequences",
    key: (round) => `${round.direction}: ${round.sequence.map((item) => item.symbol).join(" ")}`,
    daily: (seed) => memorySpan.buildDailyLadder(seed),
    free: [],
  },
  {
    name: "Running Total",
    key: (series) => JSON.stringify({ start: series.start, steps: series.steps }),
    daily: (seed) => continuousTotal.buildDailyLadder(seed),
    free: [],
  },
  {
    name: "Turn Count",
    key: (round) => JSON.stringify(round.trajectory),
    daily: (seed) => turnCount.buildDailyRounds(seed),
    free: [{ label: "15 routes", build: (seed) => turnCount.buildSession({ roundCount: 15, turnInterval: 2 }, seed) }],
  },
];

for (const game of GAMES) {
  describe(`${game.name} - no repeated question`, () => {
    test(`daily: ${game.heavy ? "90 days" : "a year of days"}, never the same question twice in a day`, () => {
      for (const { label, seed } of dailySeeds(game.name, game.heavy)) assertNoRepeat(game.daily(seed), game.key, `daily ${label}`);
    });
    if (game.free.length) {
      test(`Full Clearance: every setting, ${game.heavy ? "25" : "a hundred"} sessions each, never the same question twice in a session`, () => {
        for (const setting of game.free) for (const { label, seed } of freeSeeds(game.heavy)) assertNoRepeat(setting.build(seed), game.key, `${setting.label}, ${label}`);
      });
    }
  });
}

describe("drawFresh - a small pool of questions", () => {
  test("every question is asked once before any comes back, then the next round has no repeat either", () => {
    const pool = ["A", "B", "C", "D", "E", "F", "G"];
    for (const { label, seed } of FREE_SEEDS) {
      const random = createRandom(seed);
      const asked = new Set();
      const questions = Array.from({ length: pool.length * 2 }, () => drawFresh(() => pool[Math.floor(random() * pool.length)], (item) => item, asked));
      assertNoRepeat(questions.slice(0, pool.length), (item) => item, `pool of ${pool.length}, ${label}, first round`);
      assertNoRepeat(questions.slice(pool.length), (item) => item, `pool of ${pool.length}, ${label}, second round`);
    }
  });
});

describe("Flash Math - what counts as the same question", () => {
  test("the first calculation is what is compared, whatever comes after it and in whichever order", () => {
    assert.equal(firstStep("14 × 12"), firstStep("(14 × 12) + 30"));
    assert.equal(firstStep("14 × 12"), firstStep("12 × 14"));
    assert.equal(firstStep("((9 × 9) + 21) ÷ 3"), "9 × 9");
    assert.notEqual(firstStep("84 ÷ 7"), firstStep("7 ÷ 84"));
    assert.notEqual(firstStep("30 - 12"), firstStep("12 - 30"));
  });
});
