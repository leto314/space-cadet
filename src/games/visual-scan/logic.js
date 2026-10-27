// Visual Scan: the logic. Pure JavaScript (no React, no React Native): the grids, the points of a grid, the
// daily progression and the results. Every generator takes `random` (a Math.random-like function, see
// utils/random.js) so the same seed always gives the same grids.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const DIRECTIONS = [{ value: "forward", label: "FORWARD" }, { value: "reverse", label: "REVERSE" }];
export const CHARACTER_SETS = [{ value: "numbers", label: "NUMBERS" }, { value: "letters", label: "LETTERS" }, { value: "mixed", label: "BOTH" }];
function shuffle(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
function numbersUpTo(count) { return Array.from({ length: count }, (_, index) => String(index + 1)); }
function lettersUpTo(count) { return LETTERS.slice(0, count).split(""); }
// In "mixed" mode the starting type gets the extra character on odd grids, and both halves run in the chosen
// direction before being interleaved: forward 1 A 2 B 3…, reverse 5 D 4 C 3… (always opening with `startsWith`).
export function buildRound({ gridSize, direction, characters }, random) {
  const count = gridSize * gridSize;
  const orient = (values) => direction === "reverse" ? [...values].reverse() : values;
  let sequence;
  let startsWith = null;
  if (characters === "mixed") {
    startsWith = random() < 0.5 ? "number" : "letter";
    const leadCount = Math.ceil(count / 2);
    const lead = orient(startsWith === "number" ? numbersUpTo(leadCount) : lettersUpTo(leadCount));
    const follow = orient(startsWith === "number" ? lettersUpTo(count - leadCount) : numbersUpTo(count - leadCount));
    sequence = lead.flatMap((value, index) => index < follow.length ? [value, follow[index]] : [value]);
  } else sequence = orient(characters === "letters" ? lettersUpTo(count) : numbersUpTo(count));
  const cells = shuffle(sequence, random);
  return { sequence, cells, ranks: cells.map((label) => sequence.indexOf(label)), startsWith };
}

// Points of a grid (0–100): a time share, minus error penalties. The time share is 100 at or under `fast` and
// 0 at `slow`, both per cell and scaled by what makes a grid slower to read (letters, mixing, reverse order, a
// wider 5 × 5), with a gentle curve in between. Each error then costs a fixed amount that grows with the
// error's rank, and small grids forgive less: one error in a 3 × 3 already costs a medium penalty.
//   3 × 3  10, 20, 30, 40…      4 × 4  5, 10, 20, 30…      5 × 5  5, 10, 10, 20, 30…
const CELL_FAST_MS = 350;
const CELL_SLOW_MS = 1500;
const CHARACTER_FACTOR = { numbers: 1, letters: 1.15, mixed: 1.35 };
const DIRECTION_FACTOR = { forward: 1, reverse: 1.2 };
const GRID_FACTOR = { 3: 0.95, 4: 1, 5: 1.1 };
const ERROR_PENALTIES = { 3: [10, 20], 4: [5, 10, 20], 5: [5, 10, 10, 20] };
const PENALTY_STEP = 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function gridPoints({ gridSize, direction, characters }, timeMs, errors) {
  const cells = gridSize * gridSize;
  const factor = CHARACTER_FACTOR[characters] * DIRECTION_FACTOR[direction] * GRID_FACTOR[gridSize];
  const fast = cells * CELL_FAST_MS * factor;
  const slow = cells * CELL_SLOW_MS * factor;
  const share = clamp((slow - timeMs) / (slow - fast), 0, 1);
  const table = ERROR_PENALTIES[gridSize];
  let penalty = 0;
  for (let rank = 0; rank < errors; rank += 1) penalty += rank < table.length ? table[rank] : table.at(-1) + PENALTY_STEP * (rank - table.length + 1);
  return clamp(Math.round(100 * share ** 1.2 - penalty), 0, 100);
}

// Daily training: three grids for everyone, 3 × 3, 4 × 4, 5 × 5. Each gets a different character set and its own
// direction, drawn from the seed. The score is the three grids' points scaled to 1000 (300 → 1000).
export const DAILY_GRIDS = [3, 4, 5];
export function buildDailyRounds(seed) {
  const rnd = randomTools(createRandom(seed));
  const characters = rnd.shuffle(CHARACTER_SETS.map((option) => option.value));
  return DAILY_GRIDS.map((gridSize, index) => {
    const settings = { gridSize, direction: rnd.chance(0.5) ? "reverse" : "forward", characters: characters[index] };
    return { settings, round: buildRound(settings, rnd.random) };
  });
}

// A Full Clearance round from a seed.
export function buildSession(settings, seed) {
  return buildRound(settings, createRandom(seed));
}

// The day's three grids, from the daily seed.
export function buildDailyGrids(seed) {
  return buildDailyRounds(deriveSeed(seed, "grids"));
}

// One finished grid: its settings, time, errors, and points.
export function gridEntry(settings, sequenceLength, timeMs, errors, taps) {
  return { ...settings, timeMs, errors, perCellMs: Math.round(timeMs / sequenceLength), accuracy: Math.round((sequenceLength / taps) * 100), points: gridPoints(settings, timeMs, errors) };
}

// The daily result from the three grid entries: the points scaled to 1000, the metrics recorded, and the
// compact trial list.
export function dailyResult(entries) {
  const points = entries.reduce((sum, entry) => sum + entry.points, 0);
  return {
    score: clamp(Math.round(points * (1000 / (entries.length * 100))), 0, 1000),
    metrics: { grids: entries.length, totalMs: entries.reduce((sum, entry) => sum + entry.timeMs, 0), errors: entries.reduce((sum, entry) => sum + entry.errors, 0), ...Object.fromEntries(entries.map((entry) => [`grid${entry.gridSize}Points`, entry.points])) },
    trials: entries.map((entry) => ({ ok: entry.errors ? 0 : 1, ms: entry.timeMs, pts: entry.points, errors: entry.errors, grid: entry.gridSize, direction: entry.direction, characters: entry.characters })),
  };
}
