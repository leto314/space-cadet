// Memory Sequences: the logic. Pure JavaScript (no React, no React Native): the sequences, how an answer is
// judged, the daily ladder and its score. Every generator takes a seed, so the same seed always gives the same
// sequences.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

export const NATO_WORDS = { A: "alpha", B: "bravo", C: "charlie", D: "delta", E: "echo", F: "foxtrot", G: "golf", H: "hotel", I: "india", J: "juliett", K: "kilo", L: "lima", M: "mike", N: "november", O: "oscar", P: "papa", Q: "quebec", R: "romeo", S: "sierra", T: "tango", U: "uniform", V: "victor", W: "whiskey", X: "x-ray", Y: "yankee", Z: "zulu" };
export const DIGIT_WORDS = { 0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine" };

// The presets: whether the recall direction is known before the sequence, whether the characters are shown (or
// only spoken), and whether letters join the digits.
export const DIFFICULTY_OPTIONS = [
  { key: "easy", label: "EASY", revealDirectionEarly: true, showCharacters: true, allowLetters: false, recommendedLength: 5 },
  { key: "medium", label: "MEDIUM", revealDirectionEarly: false, showCharacters: true, allowLetters: false, recommendedLength: 6 },
  { key: "hard", label: "HARD", revealDirectionEarly: false, showCharacters: false, allowLetters: true, recommendedLength: 7 },
];
export const difficultyOf = (key) => DIFFICULTY_OPTIONS.find((option) => option.key === key);
export const LETTER_CHANCE = 0.32;

export function directionLabel(direction) { return direction === "reverse" ? "REVERSE" : "FORWARD"; }

// One sequence: `length` items, each a character and the word that is spoken for it.
export function buildSequence(length, allowLetters, random) {
  const rnd = randomTools(random);
  const digits = Object.keys(DIGIT_WORDS);
  const letters = Object.keys(NATO_WORDS);
  return Array.from({ length }, () => {
    const useLetter = allowLetters && rnd.chance(LETTER_CHANCE);
    const symbol = useLetter ? rnd.item(letters) : rnd.item(digits);
    return { symbol, spoken: useLetter ? NATO_WORDS[symbol] : DIGIT_WORDS[symbol] };
  });
}

export function targetSequence(sequence, direction) {
  return direction === "reverse" ? [...sequence].reverse() : [...sequence];
}

// What the player typed against what was asked.
export function computeResult(sequence, entered, direction) {
  const target = targetSequence(sequence, direction).map((item) => item.symbol);
  const attempt = entered.split("");
  const correctPositions = target.filter((symbol, index) => attempt[index] === symbol).length;
  const wrongDirection = !target.every((symbol, index) => attempt[index] === symbol) && [...target].reverse().join("") === entered;
  return { exact: target.join("") === entered, wrongDirection, correctPositions, total: target.length, targetSymbols: target, enteredSymbols: attempt, targetDisplay: target.join(" "), enteredDisplay: attempt.join(" "), accuracy: Math.round((correctPositions / target.length) * 100) };
}

// A Full Clearance round: one sequence and its recall direction, from a seed.
export function buildRound({ difficulty, length }, seed) {
  const random = createRandom(seed);
  return { config: difficultyOf(difficulty), length, direction: random() > 0.5 ? "forward" : "reverse", sequence: buildSequence(length, difficultyOf(difficulty).allowLetters, random) };
}

// Daily training: nine sequences for everyone, longer and harder as they go.
//   easy    digits shown, direction known before the sequence
//   medium  digits shown, direction revealed only at recall
//   hard    nothing shown: NATO letters and digits, spoken, direction at recall
export const DAILY_LADDER = [
  { difficulty: "easy", length: 4 }, { difficulty: "easy", length: 5 },
  { difficulty: "medium", length: 5 }, { difficulty: "medium", length: 6 }, { difficulty: "medium", length: 7 },
  { difficulty: "hard", length: 6 }, { difficulty: "hard", length: 7 }, { difficulty: "hard", length: 8 }, { difficulty: "hard", length: 9 },
];
export const POINTS_PER_SEQUENCE = 1000 / DAILY_LADDER.length;
// A sequence that is not exactly right still earns half credit for the characters in the right place.
export const PARTIAL_CREDIT = 0.5;

export function buildDailyLadder(seed) {
  return DAILY_LADDER.map((step, index) => ({ index, ...buildRound(step, deriveSeed(seed, `sequence-${index}`)), difficulty: step.difficulty }));
}

// Points of one sequence (0 to POINTS_PER_SEQUENCE, an equal share of the 1000).
export function sequencePoints(result) {
  if (result.exact) return POINTS_PER_SEQUENCE;
  return POINTS_PER_SEQUENCE * PARTIAL_CREDIT * (result.correctPositions / result.total);
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// The daily result from the eight results ([{ exact, correctPositions, total, difficulty, length, ms }]).
export function dailyResult(results) {
  const points = results.reduce((sum, result) => sum + sequencePoints(result), 0);
  const exact = results.filter((result) => result.exact).length;
  const positions = results.reduce((sum, result) => sum + result.correctPositions, 0);
  const characters = results.reduce((sum, result) => sum + result.total, 0);
  const longestExact = results.filter((result) => result.exact).reduce((best, result) => Math.max(best, result.length), 0);
  return {
    score: clamp(Math.round(points), 0, 1000),
    metrics: { exact, sequences: results.length, longestExact, positionAccuracy: characters ? Math.round((positions / characters) * 100) : 0, wrongDirection: results.filter((result) => result.wrongDirection).length, meanAnswerMs: results.length ? Math.round(results.reduce((sum, result) => sum + (result.ms ?? 0), 0) / results.length) : null },
    trials: results.map((result) => ({ ok: result.exact ? 1 : 0, ms: result.ms ?? null, pts: Math.round(sequencePoints(result)), length: result.length, level: result.difficulty, positions: result.correctPositions })),
  };
}
