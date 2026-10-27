// Visual Memory: the logic. Pure JavaScript (no React, no React Native): the patterns to remember, the
// distraction frames, the daily ladders and their score. Every generator takes a seed, so the same seed always
// gives the same patterns.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

export const GRID_SIZES = [4, 5, 6];
export const DISTRACTION_BLANK_MS = 600;
export const DISTRACTION_FLASH_MS = 460;
export const DISTRACTION_FRAMES = 3;

// How far a Full Clearance ladder goes before it is considered perfect.
export function maxTargetsForGrid(size) { return size === 4 ? 10 : 12; }

function shuffledIndices(count, random) {
  return randomTools(random).shuffle(Array.from({ length: count }, (_, index) => index));
}
// `targetCount` cells of a grid of `cellCount`, never the pattern of `excludedSignature` (used so a distraction
// frame is never the pattern itself).
export function buildTargets(cellCount, targetCount, random, excludedSignature = null) {
  let targets = shuffledIndices(cellCount, random).slice(0, targetCount);
  for (let attempt = 0; excludedSignature && targets.join(",") === excludedSignature && attempt < 20; attempt += 1) targets = shuffledIndices(cellCount, random).slice(0, targetCount);
  return targets;
}
// The three decoy patterns flashed between the pattern and the recall, from a seed.
export function buildDistractionFrames(cellCount, targetCount, seed, signature) {
  const random = createRandom(seed);
  return Array.from({ length: DISTRACTION_FRAMES }, () => buildTargets(cellCount, targetCount, random, signature));
}

// One round of a ladder: the pattern to remember, which way the grid turns before recall (when it does), and
// the decoy frames flashed in between (when the distraction is on).
export function buildRound({ gridSize, targetCount, rotateBeforeRecall = false, distraction = false }, seed) {
  const random = createRandom(seed);
  const targets = buildTargets(gridSize * gridSize, targetCount, random);
  const rotation = rotateBeforeRecall ? (random() < 0.5 ? -90 : 90) : 0;
  const frames = distraction ? Array.from({ length: DISTRACTION_FRAMES }, () => buildTargets(gridSize * gridSize, targetCount, random, targets.join(","))) : null;
  return { gridSize, targetCount, targets, rotation, frames };
}

// Daily training: three ladders for everyone, each starting at three cells and stopping at the first mistake,
// one harder than the last. The first is a plain 4 x 4 grid; the second and third are drawn from the seed:
//   2  a 5 x 5 grid recalled in order, or a 5 x 5 grid with decoy patterns flashed before recall
//   3  a 5 x 5 grid that turns a quarter before recall, or a 6 x 6 grid recalled in order
// fullSpan is the span that earns the whole weight; the points rise evenly from START_TARGETS - 1 to it.
export const DAILY_START_TARGETS = 3;
export const DAILY_MAX_TARGETS = 10;
const LADDER_BASE = { displaySeconds: 3, rotateBeforeRecall: false, orderedRecall: false, distraction: false };
export const DAILY_LADDER_STAGES = [
  [{ ...LADDER_BASE, key: "plain", label: "PLAIN GRID", gridSize: 4, fullSpan: 8, weight: 334 }],
  [
    { ...LADDER_BASE, key: "order", label: "IN ORDER", gridSize: 5, orderedRecall: true, fullSpan: 6, weight: 333 },
    { ...LADDER_BASE, key: "distraction", label: "THROUGH DECOYS", gridSize: 5, distraction: true, fullSpan: 7, weight: 333 },
  ],
  [
    { ...LADDER_BASE, key: "rotation", label: "GRID TURNS", gridSize: 5, rotateBeforeRecall: true, fullSpan: 7, weight: 333 },
    { ...LADDER_BASE, key: "order6", label: "IN ORDER, 6 x 6", gridSize: 6, orderedRecall: true, fullSpan: 6, weight: 333 },
  ],
];
export const DAILY_LADDERS = DAILY_LADDER_STAGES.flat();

// The day's three ladder definitions.
export function pickDailyLadders(seed) {
  const rnd = randomTools(createRandom(deriveSeed(seed, "ladders")));
  return DAILY_LADDER_STAGES.map((choices) => rnd.item(choices));
}
// Every round of a ladder, prepared in advance from the seed (the ladder stops at the player's first mistake).
export function buildDailyLadder(seed, ladder, ladderIndex) {
  return Array.from({ length: DAILY_MAX_TARGETS - DAILY_START_TARGETS + 1 }, (_, step) => ({
    ...buildRound({ gridSize: ladder.gridSize, targetCount: DAILY_START_TARGETS + step, rotateBeforeRecall: ladder.rotateBeforeRecall, distraction: ladder.distraction }, deriveSeed(seed, `ladder-${ladderIndex}-step-${step}`)),
    ladder: ladder.key,
  }));
}
export function buildDailyLadders(seed) {
  return pickDailyLadders(seed).map((ladder, index) => ({ ...ladder, index, rounds: buildDailyLadder(seed, ladder, index) }));
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Points of one ladder from the span reached (the largest pattern recalled in full, 0 if the first round failed).
export function ladderPoints(ladder, span) {
  const floor = DAILY_START_TARGETS - 1;
  return Math.round(ladder.weight * clamp((span - floor) / (ladder.fullSpan - floor), 0, 1));
}

// The daily result from the three ladders played ([{ ladder, span }], in order, `ladder` being the day's
// definition with its key, weight and fullSpan).
export function dailyResult(entries) {
  const parts = entries.map(({ ladder, span }) => ({ key: ladder.key, span, points: ladderPoints(ladder, span), full: span >= ladder.fullSpan }));
  return {
    score: clamp(parts.reduce((sum, part) => sum + part.points, 0), 0, 1000),
    metrics: {
      ladders: parts.map((part) => part.key).join("+"),
      ...Object.fromEntries(parts.flatMap((part, index) => [[`ladder${index + 1}Span`, part.span], [`ladder${index + 1}Points`, part.points]])),
      bestSpan: parts.reduce((best, part) => Math.max(best, part.span), 0),
      totalCells: parts.reduce((sum, part) => sum + part.span, 0),
    },
    trials: parts.map((part) => ({ ok: part.full ? 1 : 0, span: part.span, pts: part.points, ladder: part.key })),
  };
}
