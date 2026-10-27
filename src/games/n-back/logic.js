// N-back: the logic. Pure JavaScript (no React, no React Native): the stimulus streams, the per-channel
// results, the daily progression and its score. Every generator takes a seed, so the same seed always gives the
// same streams.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

export const TOTAL_TRIALS = 30;
export const START_DELAY_MS = 1100;
export const STIMULUS_VISIBLE_MS = 760;

const DIGIT_WORDS = { 0: "zero", 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine" };
const LETTER_POOL = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R"];
export const ALPHANUMERIC_POOL = [..."0123456789", ...LETTER_POOL].map((symbol) => ({ symbol, spoken: DIGIT_WORDS[symbol] ?? symbol.toLowerCase() }));
export const GRID_POSITIONS = Array.from({ length: 9 }, (_, index) => index);

// The presets: which channels are played, what is shown on screen, how many matches are planted, and the time
// from one item to the next (longer with two streams to follow).
export const DIFFICULTY_OPTIONS = [
  { key: "easy", label: "EASY", recommendedN: 1, channels: ["audio"], showCharacter: true, showGrid: false, minimumTargets: 10, trialIntervalMs: 1700, ready: "Listen to each character. Tap when it repeats N steps back." },
  { key: "medium", label: "MEDIUM", recommendedN: 2, channels: ["visual"], showCharacter: false, showGrid: true, minimumTargets: 10, trialIntervalMs: 1700, ready: "Watch the lit square. Tap when its position repeats N steps back." },
  { key: "hard", label: "HARD", recommendedN: 2, channels: ["audio", "visual"], showCharacter: false, showGrid: true, minimumTargets: 12, trialIntervalMs: 2400, ready: "Monitor both streams. Use the left control for audio and right for position." },
];
export const difficultyOf = (key) => DIFFICULTY_OPTIONS.find((option) => option.key === key);

// One stream of `length` items with at least `minimumTargets` planted matches (a few more at random). An item
// that is not a planted match is always made different from the one N steps back, so the matches are exactly the
// planted ones.
export function buildSequence(pool, length, nValue, minimumTargets, random) {
  const rnd = randomTools(random);
  const targetIndices = new Set(rnd.shuffle(Array.from({ length: Math.max(0, length - nValue) }, (_, index) => index + nValue)).slice(0, minimumTargets + rnd.int(0, 2)));
  const sequence = [];
  for (let index = 0; index < length; index += 1) sequence.push(index < nValue ? rnd.item(pool) : targetIndices.has(index) ? sequence[index - nValue] : rnd.item(pool.filter((item) => item !== sequence[index - nValue])));
  return sequence;
}
export function countTargets(sequence, nValue) {
  return sequence.reduce((count, item, index) => count + Number(index >= nValue && item === sequence[index - nValue]), 0);
}

// A block's streams: one per channel the preset plays. `minimumTargets` and `intervalMs` default to the preset's
// (its match count is tuned for a 30-trial run; a shorter block asks for fewer).
export function buildBlock({ difficulty, nValue, trials = TOTAL_TRIALS, minimumTargets, intervalMs }, seed) {
  const config = difficultyOf(difficulty);
  const planted = minimumTargets ?? config.minimumTargets;
  return {
    config, nValue, trials, intervalMs: intervalMs ?? config.trialIntervalMs,
    audio: config.channels.includes("audio") ? buildSequence(ALPHANUMERIC_POOL, trials, nValue, planted, createRandom(deriveSeed(seed, "audio"))) : [],
    visual: config.channels.includes("visual") ? buildSequence(GRID_POSITIONS, trials, nValue, planted, createRandom(deriveSeed(seed, "visual"))) : [],
  };
}

// What the screen shows at the end of a Full Clearance run, per channel.
export function getChannelSummary({ hits, misses, falseAlarms, targets, reactionTimes, evaluatedTrials }) {
  const nonTargets = Math.max(evaluatedTrials - targets, 0);
  const correctRejections = Math.max(nonTargets - falseAlarms, 0);
  return { accuracy: evaluatedTrials ? Math.round(((hits + correctRejections) / evaluatedTrials) * 100) : 0, hits, misses, falseAlarms, targets, average: reactionTimes.length ? Math.round(reactionTimes.reduce((sum, value) => sum + value, 0) / reactionTimes.length) : null };
}

// Daily training: three blocks for everyone, one harder than the last.
//   1  characters (spoken), 2-back, 20 trials
//   2  positions (the lit square), 2-back, 25 trials
//   3  the day's hard block, 25 trials: both streams at once in 2-back, or a single stream in 3-back
// About a third of the scorable trials are matches.
export const DAILY_BLOCKS = [
  { key: "audio", difficulty: "easy", label: "CHARACTERS", nValue: 2, trials: 20, weight: 300 },
  { key: "visual", difficulty: "medium", label: "POSITIONS", nValue: 2, trials: 25, weight: 300 },
  { key: "hard", weight: 400 },
];
export const DAILY_HARD_VARIANTS = [
  { key: "dual", difficulty: "hard", label: "BOTH AT ONCE, 2-BACK", nValue: 2, trials: 25 },
  { key: "visual3", difficulty: "medium", label: "POSITIONS, 3-BACK", nValue: 3, trials: 25, intervalMs: 1900 },
  { key: "audio3", difficulty: "easy", label: "CHARACTERS, 3-BACK", nValue: 3, trials: 25, intervalMs: 1900 },
];
export const DAILY_TARGET_SHARE = 1 / 3;
export const dailyMinimumTargets = (trials, nValue) => Math.floor((trials - nValue) * DAILY_TARGET_SHARE);

// The day's three blocks: the hard one is drawn from the seed among DAILY_HARD_VARIANTS.
export function buildDailyBlocks(seed) {
  const hard = randomTools(createRandom(deriveSeed(seed, "hard-variant"))).item(DAILY_HARD_VARIANTS);
  return DAILY_BLOCKS.map((block, index) => {
    const plan = block.key === "hard" ? { ...hard, weight: block.weight } : block;
    return { index, ...plan, ...buildBlock({ difficulty: plan.difficulty, nValue: plan.nValue, trials: plan.trials, minimumTargets: dailyMinimumTargets(plan.trials, plan.nValue), intervalMs: plan.intervalMs }, deriveSeed(seed, `block-${index}`)) };
  });
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// A channel's share of its block, corrected for guessing: the share of matches caught, minus the share of
// non-matches wrongly tapped. Tapping everything, or nothing, earns nothing.
export function channelShare({ hits, falseAlarms, targets, evaluatedTrials }) {
  const nonTargets = Math.max(evaluatedTrials - targets, 0);
  const hitRate = targets ? hits / targets : 0;
  const falseRate = nonTargets ? falseAlarms / nonTargets : 0;
  return clamp(hitRate - falseRate, 0, 1);
}

// The daily result from the three blocks' stats. Each block entry: { key, weight, channels: { audio?: { hits,
// falseAlarms, targets }, visual?: {...} }, evaluatedTrials }. A block with two channels is the mean of the two.
export function dailyResult(blocks) {
  const parts = blocks.map((block) => {
    const shares = Object.values(block.channels).map((channel) => channelShare({ ...channel, evaluatedTrials: block.evaluatedTrials }));
    const share = shares.length ? shares.reduce((sum, value) => sum + value, 0) / shares.length : 0;
    return { key: block.key, points: Math.round(block.weight * share), share };
  });
  const totals = blocks.flatMap((block) => Object.entries(block.channels).map(([channel, stats]) => ({ block: block.key, channel, ...stats })));
  const sum = (field) => totals.reduce((value, entry) => value + entry[field], 0);
  return {
    score: clamp(parts.reduce((value, part) => value + part.points, 0), 0, 1000),
    metrics: {
      ...Object.fromEntries(parts.map((part) => [`${part.key}Points`, part.points])),
      hits: sum("hits"), targets: sum("targets"), falseAlarms: sum("falseAlarms"),
      misses: sum("targets") - sum("hits"), trials: blocks.reduce((value, block) => value + block.evaluatedTrials, 0),
    },
    trials: totals.map((entry) => ({ ok: entry.targets ? Math.round((entry.hits / entry.targets) * 100) : 0, block: entry.block, channel: entry.channel, hits: entry.hits, targets: entry.targets, fa: entry.falseAlarms })),
  };
}
