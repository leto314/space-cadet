// Selective Attention: the logic. Pure JavaScript (no React, no React Native): the colours, the trials, their
// timing, the points of a trial, the daily progression and the results. Every generator takes a seed, so the
// same seed always gives the same trials.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

export const COLORS = [
  { key: "blue", label: "BLUE", hex: "#4C8DFF", soft: "#10203F" },
  { key: "purple", label: "PURPLE", hex: "#C46BFF", soft: "#28123A" },
  { key: "red", label: "RED", hex: "#D81E5B", soft: "#35101F" },
  { key: "yellow", label: "YELLOW", hex: "#FFCF3D", soft: "#352A08" },
  { key: "green", label: "GREEN", hex: "#34D399", soft: "#0C2B23" },
  { key: "orange", label: "ORANGE", hex: "#FF741A", soft: "#3A1608" },
];

export const DIFFICULTY_OPTIONS = [
  { key: "easy", label: "EASY", allowedTargets: ["word", "color"], preannounce: true, useAudio: false },
  { key: "medium", label: "MEDIUM", allowedTargets: ["word", "color", "audio"], preannounce: true, useAudio: true },
  { key: "hard", label: "HARD", allowedTargets: ["word", "color", "audio"], preannounce: false, useAudio: true },
];
export const levelOf = (key) => DIFFICULTY_OPTIONS.find((option) => option.key === key);

// Timing: the cue card before the word (easy, medium), the stand-by before the word (hard), how long a word stays
// up (no answer by then is a miss), and the pauses after an answer.
export const CUE_MS = 1450;
export const STANDBY_MS = 1050;
export const LIMIT_MS = 6000;
export const AFTER_ANSWER_MS = 460;
export const AFTER_MISS_MS = 700;

// Points of a trial (0–100) from the response time of a right answer: 100 at or under `fast`, then a gentle
// curve (power 1.5) down to 0 at the 6-second limit (a wrong answer, or none, is 0). This is a decision, not a
// reflex, and `fast` depends on the level: with the cue known in advance a word is read quickly, with a spoken
// colour in play there is more to sort out, and in hard the cue itself must be read first.
//   easy (fast 600)    800 → 95 · 1000 → 89 · 1500 → 77 · 2000 → 65 · 3000 → 44 · 4000 → 25
//   hard (fast 900)    1000 → 97 · 1500 → 83 · 1900 → 72 · 2500 → 57 · 3000 → 49 · 4000 → 25
// When the cue is the spoken colour, the player has to hear the word before answering: the time until the voice
// starts, plus the word itself, is taken off the response time (see AUDIO_WORD_MS).
const FAST_MS = { easy: 600, medium: 700, hard: 900 };
const AUDIO_WORD_MS = 350;         // about how long a colour name takes to say
const AUDIO_FALLBACK_MS = 600;     // allowance when the voice never reports when it started
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function trialPoints(level, reactionMs) {
  if (reactionMs === null || reactionMs >= LIMIT_MS) return 0;
  const share = clamp((LIMIT_MS - reactionMs) / (LIMIT_MS - FAST_MS[level]), 0, 1);
  return clamp(Math.round(100 * share ** 1.5), 0, 100);
}

// Daily training: ten trials for everyone, 2 easy, 2 medium (the spoken cue comes in), 6 hard.
export const DAILY_LEVELS = ["easy", "easy", "medium", "medium", "hard", "hard", "hard", "hard", "hard", "hard"];

export function buildTrials(levels, seed) {
  const rnd = randomTools(createRandom(seed));
  return levels.map((level) => {
    const option = levelOf(level);
    return { level, targetType: rnd.item(option.allowedTargets), writtenColor: rnd.item(COLORS), inkColor: rnd.item(COLORS), spokenColor: option.useAudio ? rnd.item(COLORS) : null };
  });
}

export function targetFor(trial) { return trial.targetType === "word" ? trial.writtenColor : trial.targetType === "color" ? trial.inkColor : trial.spokenColor; }
export function summarise(results) {
  const right = results.filter((entry) => entry.correct);
  const times = right.map((entry) => entry.reactionMs);
  const points = results.reduce((sum, entry) => sum + entry.points, 0);
  return {
    trials: results.length, correct: right.length, errors: results.filter((entry) => !entry.correct && entry.reactionMs !== null).length, tooSlow: results.filter((entry) => entry.reactionMs === null).length,
    score: results.length ? clamp(Math.round((points / results.length) * 10), 0, 1000) : 0,
    accuracy: results.length ? Math.round((right.length / results.length) * 100) : 0,
    average: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null, best: times.length ? Math.min(...times) : null,
  };
}

// The response time of an answer to a spoken cue: the time until the voice started, plus the word itself, is
// taken off the elapsed time (a fixed allowance when the voice never reported when it started).
export function audioResponseTime(elapsedMs, speechDelayMs) {
  const allowance = speechDelayMs !== null ? speechDelayMs + AUDIO_WORD_MS : AUDIO_FALLBACK_MS;
  return Math.max(0, elapsedMs - allowance);
}

// A Full Clearance run: `roundCount` trials of one difficulty, from a seed.
export function buildSession({ level, roundCount }, seed) {
  return buildTrials(Array.from({ length: roundCount }, () => level), seed);
}

// The day's ten trials.
export function buildDailyTrials(seed) {
  return buildTrials(DAILY_LEVELS, deriveSeed(seed, "trials"));
}

// The daily result from the trial results ([{ level, targetType, correct, reactionMs, points }]): the score
// (mean points × 10), the metrics recorded, and the compact trial list.
export function dailyResult(results) {
  const outcome = summarise(results);
  const pointsIn = (level) => results.filter((entry) => entry.level === level).reduce((sum, entry) => sum + entry.points, 0);
  return {
    score: outcome.score,
    metrics: { correct: outcome.correct, trials: outcome.trials, errors: outcome.errors, tooSlow: outcome.tooSlow, meanRtMs: outcome.average, bestRtMs: outcome.best, easyPoints: pointsIn("easy"), mediumPoints: pointsIn("medium"), hardPoints: pointsIn("hard") },
    trials: results.map((entry) => ({ ok: entry.correct ? 1 : 0, rt: entry.reactionMs, pts: entry.points, level: entry.level, cue: entry.targetType })),
  };
}
