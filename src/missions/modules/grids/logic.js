// The two 3 × 3 grid modules: the logic. Pure JavaScript (no React): the specs, the grids and patterns drawn
// from the seed, and the scoring. Sequence scan (tap the cells in order) and Pattern memory (recall the flashed
// cells) are neighbours here because they share the grid, not variants of one system.

import { createRandom, randomTools } from "../../../utils/random.js";

const LETTERS = "ABCDEFGHI";

// ---- Sequence scan ---------------------------------------------------------------------------------------
export const miniScanSpec = {
  id: "mini-scan",
  title: "Sequence scan",
  competence: "attention",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 2,
  rule: "Tap the nine cells in the order shown at the top. Each cleared grid brings a harder order: reversed, letters, then numbers and letters alternating. Clear as many as you can.",
  recap: "clear the scan grids",
  blocks: [{ key: "grid", role: "display", h: 2, w: 2 }],
};

// Each completed grid unlocks a harder order; after the last level the cycle keeps its hardest steps.
export const SCAN_LEVELS = [
  { characters: "numbers", reverse: false }, { characters: "numbers", reverse: true },
  { characters: "letters", reverse: false }, { characters: "letters", reverse: true },
  { characters: "mixed", reverse: false }, { characters: "mixed", reverse: true },
];
// The pace a perfect score asks for: one grid every 26 s of flight.
export const SCAN_SECONDS_PER_GRID = 26;
export const SCAN_ERROR_COST = 0.03;
// Grids in the stream: more than anyone can clear (one every 4 s), so it never runs dry.
const gridCount = (durationMs) => Math.ceil(durationMs / 4000) + 5;

function buildScanRound(level, rnd) {
  const orient = (values) => (level.reverse ? [...values].reverse() : values);
  let sequence;
  if (level.characters === "mixed") {
    const numbersFirst = rnd.chance(0.5);
    const lead = orient(numbersFirst ? ["1", "2", "3", "4", "5"] : LETTERS.slice(0, 5).split(""));
    const follow = orient(numbersFirst ? LETTERS.slice(0, 4).split("") : ["1", "2", "3", "4"]);
    sequence = lead.flatMap((value, index) => (index < follow.length ? [value, follow[index]] : [value]));
  } else sequence = orient(level.characters === "letters" ? LETTERS.split("") : ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  return { sequence, cells: rnd.shuffle(sequence) };
}
export const scanHint = (round) => `${round.sequence[0]} → ${round.sequence[1]} → ${round.sequence[2]} …`;

// The grids of the flight, in order: grid k is at level min(k, last).
export function buildScanContent(seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  return Array.from({ length: gridCount(durationMs) }, (_, index) => ({ level: Math.min(index, SCAN_LEVELS.length - 1), ...buildScanRound(SCAN_LEVELS[Math.min(index, SCAN_LEVELS.length - 1)], rnd) }));
}

export function scanResult(stats, { durationMs }) {
  const target = Math.max(1, durationMs / 1000 / SCAN_SECONDS_PER_GRID);
  return { performance: Math.max(0, Math.min(1, Math.min(1, stats.grids / target) - SCAN_ERROR_COST * stats.errors)), detail: `${stats.grids} grids cleared${stats.errors ? ` · ${stats.errors} wrong taps` : ""}` };
}

// ---- Pattern memory --------------------------------------------------------------------------------------
export const miniMemorySpec = {
  id: "mini-memory",
  title: "Pattern memory",
  competence: "memory",
  secondary: [],
  task: "event",
  voice: false,
  load: 2,
  rule: "From time to time a few cells light up briefly (the light blinks and the phone vibrates). Remember them, then tap the same cells when RECALL appears. The pattern grows after a success and shrinks after a miss.",
  recap: "recall the flashed patterns",
  blocks: [{ key: "grid", role: "display", h: 2, w: 2 }],
};

export const FLASH_MS = 3600;
export const BLANK_MS = 900;
export const RECALL_MS = 17000;
export const MEMORY_MIN_SIZE = 3;
export const MEMORY_MAX_SIZE = 6;

// When each pattern flashes, and the order its cells are drawn in (the first `size` of them light up, the size
// depending on how the player has done so far).
export function buildMemoryContent(seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const rounds = [];
  for (let at = rnd.int(5000, 8000); at < durationMs - RECALL_MS - 3000; at += rnd.int(24000, 32000)) rounds.push({ at, order: rnd.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8]) });
  return rounds;
}

export function memoryResult(stats) {
  const scores = stats.scores.map((value) => Math.max(0, Math.min(1, Number(value) || 0)));
  const count = scores.length;
  const mean = count ? scores.reduce((sum, value) => sum + value, 0) / count : 0;
  return { performance: mean, detail: `${scores.filter((value) => value === 1).length}/${count} patterns recalled · up to ${stats.size} cells` };
}

// ---- The shared contract ---------------------------------------------------------------------------------
export function buildContent(spec, seed, context) {
  return spec.id === miniScanSpec.id ? buildScanContent(seed, context) : buildMemoryContent(seed, context);
}
// Scan: grids cleared and wrong taps. Memory: the share of each pattern recalled, and the size reached.
export function emptyStats(spec) {
  return spec.id === miniScanSpec.id ? { grids: 0, errors: 0 } : { scores: [], size: MEMORY_MIN_SIZE };
}
export function moduleResult(spec, stats, context) {
  return spec.id === miniScanSpec.id ? scanResult(stats, context) : memoryResult(stats);
}

// The flight nobody played: no grid cleared; every pattern that completes within the flight recalled with no cell.
export function idleStats(spec, content, { durationMs }) {
  if (spec.id === miniScanSpec.id) return { grids: 0, errors: 0 };
  return { scores: content.filter((round) => round.at + FLASH_MS + BLANK_MS + RECALL_MS <= durationMs).map(() => 0), size: MEMORY_MIN_SIZE };
}
