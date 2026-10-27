// Target Drift: the logic. Pure JavaScript (no React, no React Native): the difficulty presets, the two decision
// tasks, the session's seeded draws (questions, alert timing, drift), the daily progression and the scores. A
// session is built from a seed, so the same seed always gives the same questions, alerts and drift.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

// The presets: whether the target ring is shown, how strong the drift is, how long an alert stays up before it
// counts as missed, and the wait before the next alert.
export const DIFFICULTY_CONFIG = {
  easy: { label: "EASY", target: true, drift: 0.18, alertDeadline: 6, taskDelay: [2800, 4300], description: "Visible target, gentle drift, six seconds per alert." },
  medium: { label: "MEDIUM", target: true, drift: 0.29, alertDeadline: 4.5, taskDelay: [2100, 3400], description: "Visible target, faster drift, shorter alert timing." },
  hard: { label: "HARD", target: false, drift: 0.4, alertDeadline: 3, taskDelay: [1500, 2600], description: "No target, rapid drift, and three seconds per alert." },
};
export const ALERT_KEYS = ["A1", "A2", "A3", "B1", "B2", "B3"];
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ".split("");

// The marker: distance from the centre, 0 to 1. Inside TARGET_RADIUS it is in the target ring; past DANGER_RADIUS
// it is drifting away (the game buzzes).
export const TARGET_RADIUS = 0.32;
export const DANGER_RADIUS = 0.66;

// "Calculation": is this equation right? "Sequence": does a character appear twice?
export function buildMathQuestion(rnd) {
  const operation = rnd.item(["+", "−", "×"]);
  const left = operation === "×" ? rnd.int(2, 20) : rnd.int(operation === "−" ? 35 : 12, operation === "−" ? 150 : 99);
  const right = operation === "×" ? rnd.int(2, 12) : rnd.int(4, operation === "−" ? left - 2 : 79);
  const result = operation === "+" ? left + right : operation === "−" ? left - right : left * right;
  const isTrue = rnd.chance(0.5);
  return { text: `${left} ${operation} ${right} = ${isTrue ? result : result + rnd.item([-9, -7, -5, -4, -3, -2, 2, 3, 4, 5, 7, 9])}`, isTrue };
}
export function buildLetterQuestion(rnd) {
  const shouldMatch = rnd.chance(0.5);
  const characters = shouldMatch ? [rnd.item(LETTERS)] : [];
  if (shouldMatch) characters.push(characters[0]);
  const available = LETTERS.filter((letter) => !characters.includes(letter));
  while (characters.length < 6) { const letter = rnd.item(available); characters.push(letter); available.splice(available.indexOf(letter), 1); }
  return { text: rnd.shuffle(characters).join(""), isTrue: shouldMatch };
}

// A session: its stages (a preset and a duration each) and independent seeded streams for everything the game
// draws while it runs. The screen asks the session for the next question, the next alert, the next drift…
//   stageAt(elapsedSeconds)  the stage in progress (null once the session is over)
//   nextQuestion(kind)       kind "math" or "letter"
//   nextAlert(config, keys)  the wait before the next alert (within the preset's range) and which key lights up
//   nextDrift(config)        a new drift direction, scaled by the preset
//   jitter()                 a small random nudge, −0.5 to 0.5
export function createSession(stages, seed) {
  const streams = Object.fromEntries(["math", "letter", "alerts", "drift", "jitter"].map((name) => [name, randomTools(createRandom(deriveSeed(seed, name)))]));
  const totalSeconds = stages.reduce((sum, stage) => sum + stage.seconds, 0);
  return {
    stages, totalSeconds,
    stageAt(elapsedSeconds) {
      let start = 0;
      for (let index = 0; index < stages.length; index += 1) { start += stages[index].seconds; if (elapsedSeconds < start) return { index, ...stages[index] }; }
      return null;
    },
    nextQuestion: (kind) => (kind === "math" ? buildMathQuestion(streams.math) : buildLetterQuestion(streams.letter)),
    nextAlert: (config, keys) => ({ delayMs: streams.alerts.int(config.taskDelay[0], config.taskDelay[1]), key: keys[streams.alerts.int(0, ALERT_KEYS.length - 1) % keys.length] }),
    nextDrift: (config) => ({ x: (streams.drift.random() - 0.5) * config.drift, y: (streams.drift.random() - 0.5) * config.drift }),
    jitter: () => streams.jitter.random() - 0.5,
  };
}

// A Full Clearance session: one preset for `durationMinutes`.
export function buildSession({ difficulty, durationMinutes }, seed) {
  return createSession([{ config: DIFFICULTY_CONFIG[difficulty], seconds: durationMinutes * 60 }], seed);
}

// Daily training: 90 seconds for everyone, easy for 30 seconds, then medium, then hard.
export const DAILY_STAGES = [
  { key: "easy", config: DIFFICULTY_CONFIG.easy, seconds: 30 },
  { key: "medium", config: DIFFICULTY_CONFIG.medium, seconds: 30 },
  { key: "hard", config: DIFFICULTY_CONFIG.hard, seconds: 30 },
];
export function buildDailySession(seed) {
  return createSession(DAILY_STAGES, seed);
}

// The daily score, out of 1000, in three parts:
//   drift      400  each position sample earns full credit inside the target ring, none past the danger ring,
//                   in between in proportion; the part is the mean credit
//   decisions  350  net right answers (right minus wrong) against the pace expected over the session
//   alerts     250  the share of alerts handled before their deadline
export const DAILY_WEIGHTS = { drift: 400, decisions: 350, alerts: 250 };
export const EXPECTED_DECISIONS_PER_MINUTE = 16;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function driftCredit(distance) { return clamp(1 - (distance - TARGET_RADIUS) / (DANGER_RADIUS - TARGET_RADIUS), 0, 1); }

// From the session stats: { correct, decisions, alertsHandled, alertsMissed, distanceTotal, distanceSamples,
// creditTotal } (creditTotal is the sum of driftCredit over the samples) and the session length.
export function dailyResult(stats, totalSeconds) {
  const driftShare = stats.distanceSamples ? stats.creditTotal / stats.distanceSamples : 0;
  const expected = EXPECTED_DECISIONS_PER_MINUTE * (totalSeconds / 60);
  const decisionShare = clamp((stats.correct - (stats.decisions - stats.correct)) / expected, 0, 1);
  const alerts = stats.alertsHandled + stats.alertsMissed;
  const alertShare = alerts ? stats.alertsHandled / alerts : 0;
  const parts = { drift: Math.round(driftShare * DAILY_WEIGHTS.drift), decisions: Math.round(decisionShare * DAILY_WEIGHTS.decisions), alerts: Math.round(alertShare * DAILY_WEIGHTS.alerts) };
  return {
    score: clamp(parts.drift + parts.decisions + parts.alerts, 0, 1000),
    metrics: { driftPoints: parts.drift, decisionPoints: parts.decisions, alertPoints: parts.alerts, correct: stats.correct, decisions: stats.decisions, alertsHandled: stats.alertsHandled, alertsMissed: stats.alertsMissed, meanDistance: stats.distanceSamples ? Math.round((stats.distanceTotal / stats.distanceSamples) * 100) : 0, inTargetShare: Math.round(driftShare * 100) },
    trials: null,
  };
}

// The Full Clearance summary: decision accuracy and mean distance from the centre, in percent.
export function sessionSummary(stats) {
  return { accuracy: stats.decisions ? Math.round((stats.correct / stats.decisions) * 100) : 0, averageDistance: stats.distanceSamples ? Math.round((stats.distanceTotal / stats.distanceSamples) * 100) : 0 };
}
