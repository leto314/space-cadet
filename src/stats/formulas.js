// Statistics formulas (see STATS.md). Pure functions only: no storage, no React. Every number marked
// "TO VALIDATE" is a proposal still open for discussion.

export const MAX_SCORE = 1000;
export const BASE_ALPHA = 0.1;

// Tier weights for the competence update. `up` scales the step when today's result is above the current score,
// `down` when it is below. Simple is low stakes both ways (small gains, small losses), experienced high stakes
// both ways. Losses weigh half as much as gains: a score near the top has far more room to fall than to climb,
// so with equal weights one bad day would undo several good ones. Adaptive games (no tier choice) use
// "standard". TO VALIDATE.
export const TIERS = {
  simple: { up: 0.5, down: 0.25 },
  standard: { up: 1, down: 0.5 },
  experienced: { up: 1.5, down: 0.75 },
};

// Weight of a game's 0–1000 result in the day's cadet points, by tier. TO VALIDATE.
export const TIER_POINTS = { simple: 0.7, standard: 1, experienced: 1.2 };
// Weight of a mission's 0–1000 result in the day's cadet points, by format. TO VALIDATE.
export const MISSION_FORMAT_POINTS = { short: 0.7, regular: 1 };
export const COMPETENCES = ["spatial", "attention", "memory", "mentalMath", "logic", "multitasking"];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Moving average with a step that depends on experience and tier.
//   S_new = S_old + a · (S_today − S_old),   a = min(1, max(BASE_ALPHA, 1/n) · w)
// n = number of days this competence has been trained, today included; w = TIERS[tier].up or .down.
// A result above the current score always raises it, whatever the tier (only by less in easy); the score
// always stays within 0–1000. `state` is { score, days } (days = 0 for a competence never trained).
export function updateCompetence(state, todayScore, tier = "standard") {
  const days = state.days + 1;
  const today = clamp(todayScore, 0, MAX_SCORE);
  if (state.days === 0) return { score: today, days };
  const weights = TIERS[tier] ?? TIERS.standard;
  const step = Math.min(1, Math.max(BASE_ALPHA, 1 / days) * (today >= state.score ? weights.up : weights.down));
  return { score: clamp(state.score + step * (today - state.score), 0, MAX_SCORE), days };
}

// Rescales a success rate so that answering at random scores 0 (e.g. 1 in 6 on a six-choice question).
// Optional, decided game by game.
export function chanceCorrected(successRate, chanceRate) {
  if (chanceRate >= 1) return successRate;
  return clamp((successRate - chanceRate) / (1 - chanceRate), 0, 1);
}

// Cadet points earned by the day's training: the mean of the games played (6 on a full day), each weighted by
// its tier. A partial day earns its share. Max 1000 in standard, 1200 all in experienced.
export function trainingPoints(games) {
  const total = games.reduce((sum, game) => sum + clamp(game.score, 0, MAX_SCORE) * (TIER_POINTS[game.tier] ?? 1), 0);
  return Math.round(total / COMPETENCES.length);
}

// Cadet points earned by the day's mission: its 0–1000 result weighted by the format.
export function missionPoints(score, format = "regular") {
  return Math.round(clamp(score, 0, MAX_SCORE) * (MISSION_FORMAT_POINTS[format] ?? 1));
}
