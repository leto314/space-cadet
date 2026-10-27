// Heading and Beacon: the logic. Pure JavaScript (no React, no React Native): headings, trials, the placement
// geometry, the daily progression and the scores. Every generator takes `random` (a Math.random-like function,
// see utils/random.js) so the same seed always gives the same trials.

import { createRandom } from "../../utils/random.js";

export const DEFAULT_ROUNDS = 10;
export const HEADING_ANGLES = Array.from({ length: 24 }, (_, index) => index * 15);
export const ANSWER_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

// The eight cells around the beacon: bearing and place in the 3 × 3 matrix.
export const SLOT_DEFINITIONS = [
  { key: "nw", angle: 315, row: 0, col: 0 },
  { key: "n", angle: 0, row: 0, col: 1 },
  { key: "ne", angle: 45, row: 0, col: 2 },
  { key: "w", angle: 270, row: 1, col: 0 },
  { key: "e", angle: 90, row: 1, col: 2 },
  { key: "sw", angle: 225, row: 2, col: 0 },
  { key: "s", angle: 180, row: 2, col: 1 },
  { key: "se", angle: 135, row: 2, col: 2 },
];

export const MODES = ["easy", "medium", "hard"];

const randomItem = (random, items) => items[Math.floor(random() * items.length)];
function shuffle(random, items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = current;
  }
  return copy;
}

export function normalizeAngle(value) { return ((value % 360) + 360) % 360; }
export function angleToRadians(angle) { return (angle * Math.PI) / 180; }
export function average(values) { return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length); }
export function angleDifference(left, right) {
  const difference = Math.abs(normalizeAngle(left - right));
  return Math.min(difference, 360 - difference);
}

// Four headings to choose from, the right one among three others at least 30° apart.
function buildOptionAngles(random, correctAngle) {
  const options = [correctAngle];
  while (options.length < 4) {
    const candidate = randomItem(random, HEADING_ANGLES);
    if (options.every((angle) => angleDifference(angle, candidate) >= 30)) options.push(candidate);
  }
  return shuffle(random, options);
}

function buildEasyTrial(random) {
  const heading = randomItem(random, HEADING_ANGLES);
  return { heading, optionAngles: buildOptionAngles(random, heading) };
}

function buildSpatialTrial(random, includeOptions) {
  const heading = randomItem(random, HEADING_ANGLES);
  const answerAngle = randomItem(random, ANSWER_ANGLES);
  const relativeBearing = normalizeAngle(answerAngle - heading - 180);
  return { heading, answerAngle, relativeBearing, optionAngles: includeOptions ? buildOptionAngles(random, heading) : [] };
}

// One trial. "easy": read the heading. "medium": place the aircraft around the beacon. "hard": both.
export function buildTrial(mode, random) {
  return { mode, ...(mode === "easy" ? buildEasyTrial(random) : buildSpatialTrial(random, mode === "hard")) };
}

// A Full Clearance session from a seed: `roundCount` trials of one mode.
export function buildSession({ mode, roundCount }, seed) {
  const random = createRandom(seed);
  return Array.from({ length: roundCount }, () => buildTrial(mode, random));
}

// Daily training: the same ten rounds for everyone, in three stages of growing difficulty.
export const DAILY_STAGES = [{ mode: "easy", rounds: 3 }, { mode: "medium", rounds: 3 }, { mode: "hard", rounds: 4 }];
export function buildDailyTrials(seed) {
  const random = createRandom(seed);
  return DAILY_STAGES.flatMap((stage) => Array.from({ length: stage.rounds }, () => buildTrial(stage.mode, random)));
}

// The matrix is 3 × 3 cells around the beacon, MATRIX_HALF points from its centre to its edge. A release counts
// as a placement only inside one of the eight outer cells; anywhere else (outside the matrix, or back on the
// beacon) it is treated as a plain tap.
export const MATRIX_HALF = 143;
export function releasedInSlot(dx, dy) {
  const cell = (MATRIX_HALF * 2) / 3;
  if (Math.abs(dx) > MATRIX_HALF || Math.abs(dy) > MATRIX_HALF) return false;
  return !(Math.abs(dx) < cell / 2 && Math.abs(dy) < cell / 2);
}

// The slot angle a drag from the beacon points to (null when the drag is too short to mean anything).
export function getAngleFromDrag(dx, dy) {
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < 26) return null;
  const rawAngle = normalizeAngle((Math.atan2(dx, -dy) * 180) / Math.PI);
  let bestSlot = SLOT_DEFINITIONS[0];
  SLOT_DEFINITIONS.forEach((slot) => { if (angleDifference(rawAngle, slot.angle) < angleDifference(rawAngle, bestSlot.angle)) bestSlot = slot; });
  return bestSlot.angle;
}

// The daily result from the round results and their trials: a score out of 1000 (100 per round fully right),
// the metrics recorded, and the compact trial list. Result shape: { correct, reactionMs } for easy and medium
// rounds, { stage1Correct, stage2Correct, stage1ReactionMs, stage2ReactionMs, fallback } for hard rounds.
export function dailyResult(results, trials) {
  const rounds = results.map((result, index) => {
    const trial = trials[index];
    const ok = trial.mode === "hard" ? Boolean(result.stage1Correct && result.stage2Correct) : Boolean(result.correct);
    return { mode: trial.mode, ok: ok ? 1 : 0, ms: result.reactionMs ?? result.stage1ReactionMs ?? null, ms2: result.stage2ReactionMs ?? null, tap: result.fallback ? 1 : 0 };
  });
  const correctIn = (stageMode) => rounds.filter((round) => round.mode === stageMode && round.ok).length;
  const times = rounds.map((round) => (round.ms ?? 0) + (round.ms2 ?? 0)).filter(Boolean);
  return {
    score: Math.round((rounds.filter((round) => round.ok).length / rounds.length) * 1000),
    metrics: { correct: rounds.filter((round) => round.ok).length, rounds: rounds.length, heading: correctIn("easy"), position: correctIn("medium"), combined: correctIn("hard"), tapPlacements: rounds.filter((round) => round.tap).length, meanRoundMs: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null },
    trials: rounds,
  };
}

// The Full Clearance summary, per mode: stage counts for "hard", accuracy and reaction times otherwise.
export function sessionSummary(results, mode) {
  if (results.length === 0) return null;
  if (mode === "hard") {
    const stage1Reactions = results.map((item) => item.stage1ReactionMs).filter(Boolean);
    const stage2Reactions = results.map((item) => item.stage2ReactionMs).filter(Boolean);
    return {
      stage1Correct: results.filter((item) => item.stage1Correct).length,
      stage2Correct: results.filter((item) => item.stage2Correct).length,
      perfectRounds: results.filter((item) => item.stage1Correct && item.stage2Correct).length,
      stage1Average: average(stage1Reactions),
      stage2Average: average(stage2Reactions),
    };
  }
  const reactionValues = results.map((item) => item.reactionMs).filter(Boolean);
  const correctCount = results.filter((item) => item.correct).length;
  return {
    correctCount,
    accuracy: Math.round((correctCount / results.length) * 100),
    averageReaction: average(reactionValues),
    bestReaction: reactionValues.length > 0 ? Math.min(...reactionValues) : null,
  };
}
