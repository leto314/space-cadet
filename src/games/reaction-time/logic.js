// Reaction Time: the logic. Pure JavaScript (no React, no React Native): the rounds, their timing, the points
// of a round, the daily progression and the results. Every generator takes a seed, so the same seed always
// gives the same rounds.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

export const DIFFICULTY_OPTIONS = [
  { key: "easy", label: "EASY", panelCount: 1, helper: "Tap the green signal as fast as you can." },
  { key: "medium", label: "MEDIUM", panelCount: 1, helper: "Tap green. Ignore red." },
  { key: "hard", label: "HARD", panelCount: 4, helper: "Tap green. It may appear beside a red decoy." },
];
export const levelOf = (key) => DIFFICULTY_OPTIONS.find((option) => option.key === key);

// Timing: the wait before a signal, how long a green stays up (a tap after that is a miss), how long a red-only
// signal stays up, and the pauses after a response.
export const WAIT_MIN_MS = 1000;
export const WAIT_MAX_MS = 5000;
export const GREEN_LIMIT_MS = 2000;
export const RED_VISIBLE_MS = 1600;
export const AFTER_HIT_MS = 620;
export const AFTER_FAULT_MS = 760;

// Points of a round (0–100) from the reaction time: 100 at or under `fast` (never more, however quick the
// tap), then a cubic fall to 0 at the 2-second limit. The cube keeps the curve steep where real reactions sit (roughly 250–700 ms) and leaves only
// crumbs for a distracted 1–2 s. Hard has four panels (choice, not simple reaction), so its "fast" is later.
//   easy/medium  250 ms → 100 · 400 → 76 · 550 → 57 · 850 → 28 · 1200 → 10
//   hard         350 ms → 100 · 500 → 75 · 700 → 49 · 1000 → 22
const FAST_MS = { easy: 250, medium: 250, hard: 350 };
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function roundPoints(level, reactionMs) {
  if (reactionMs === null || reactionMs >= GREEN_LIMIT_MS) return 0;
  const share = clamp((GREEN_LIMIT_MS - reactionMs) / (GREEN_LIMIT_MS - FAST_MS[level]), 0, 1);
  return clamp(Math.round(100 * share ** 3), 0, 100);
}

// Daily training: ten rounds for everyone, 2 easy, 3 medium, 5 hard; the score is the sum of the ten rounds.
export const DAILY_LEVELS = ["easy", "easy", "medium", "medium", "medium", "hard", "hard", "hard", "hard", "hard"];

// A round: an optional red-only signal to ignore (medium and hard, half the time), then the green target.
// Hard has four panels, and the green may come with a red decoy. Every wait and slot is drawn from the seed.
export function buildRounds(levels, seed) {
  const rnd = randomTools(createRandom(seed));
  const empty = (count) => Array.from({ length: count }, () => null);
  return levels.map((level) => {
    const { panelCount } = levelOf(level);
    const cues = [];
    if (level !== "easy" && rnd.chance(0.5)) {
      const panels = empty(panelCount);
      panels[rnd.int(0, panelCount - 1)] = "red";
      cues.push({ panels, targetSlot: null, waitMs: rnd.int(WAIT_MIN_MS, WAIT_MAX_MS) });
    }
    const panels = empty(panelCount);
    const targetSlot = rnd.int(0, panelCount - 1);
    panels[targetSlot] = "green";
    if (level === "hard" && rnd.chance(0.6)) panels[rnd.item(panels.map((_, index) => index).filter((index) => index !== targetSlot))] = "red";
    cues.push({ panels, targetSlot, waitMs: rnd.int(WAIT_MIN_MS, WAIT_MAX_MS) });
    return { level, panelCount, cues };
  });
}

export function summarise(results) {
  const times = results.map((result) => result.reactionMs).filter((value) => value !== null);
  const points = results.reduce((sum, result) => sum + result.points, 0);
  return {
    rounds: results.length,
    score: clamp(points, 0, results.length * 100),
    maxScore: results.length * 100,
    average: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null,
    best: times.length ? Math.min(...times) : null,
    hits: results.filter((result) => result.reactionMs !== null).length,
    misses: results.filter((result) => result.fault === "miss").length,
    wrongTaps: results.filter((result) => result.fault === "red" || result.fault === "panel").length,
    falseStarts: results.filter((result) => result.fault === "early").length,
  };
}

// A Full Clearance run: `roundCount` rounds of one difficulty, from a seed.
export function buildSession({ level, roundCount }, seed) {
  return buildRounds(Array.from({ length: roundCount }, () => level), seed);
}

// The day's ten rounds.
export function buildDailyRounds(seed) {
  return buildRounds(DAILY_LEVELS, deriveSeed(seed, "rounds"));
}

// The daily result from the round results ([{ level, reactionMs, points, fault }]): the score (sum of the ten
// rounds' points), the metrics recorded, and the compact trial list.
export function dailyResult(results) {
  const outcome = summarise(results);
  const pointsIn = (level) => results.filter((result) => result.level === level).reduce((sum, result) => sum + result.points, 0);
  return {
    score: outcome.score,
    metrics: { meanRtMs: outcome.average, bestRtMs: outcome.best, hits: outcome.hits, rounds: outcome.rounds, misses: outcome.misses, wrongTaps: outcome.wrongTaps, falseStarts: outcome.falseStarts, easyPoints: pointsIn("easy"), mediumPoints: pointsIn("medium"), hardPoints: pointsIn("hard") },
    trials: results.map((result) => ({ ok: result.fault ? 0 : 1, rt: result.reactionMs, pts: result.points, level: result.level, fault: result.fault })),
  };
}
