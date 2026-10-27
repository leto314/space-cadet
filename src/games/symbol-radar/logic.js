// Anomaly Detection (Symbol Radar): the logic. Pure JavaScript (no React, no React Native): the board, the
// session schedule, the points of an anomaly, the daily progression and the score. Every generator takes a seed,
// so the same seed always gives the same stream of signals.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

export const TRACK_COUNT = 20;
export const COLUMN_COUNT = 16;

export function stepDelay(speed) { return speed === 1 ? 700 : speed === 2 ? 560 : 440; }

// Daily training: 90 seconds for everyone, the signals speeding up every 30 seconds.
export const DAILY_PHASES = [{ speed: 1, seconds: 30 }, { speed: 2, seconds: 30 }, { speed: 3, seconds: 30 }];
const FIRST_SPAWN_MS = 500;
const ANOMALY_EVERY_S = 6;            // one anomaly per 6 s on average: 15 in the daily's 90 s
const FIRST_ANOMALY_TICK = 8;         // a few seconds of plain signals first
const MIN_ANOMALY_GAP = 6;            // ticks between two anomaly spawns
const TAIL_TICKS = COLUMN_COUNT;      // no anomaly spawned too late to cross the screen before the end
// Points of an anomaly: 1 if caught in the first quarter of the screen, then 0.75, 0.5 and 0.25 by quarter,
// and −1 if missed. Each false alarm costs half a point, so tapping every line is never a strategy. The total
// is floored at 0 and scaled to 1000.
const QUARTER_POINTS = [1, 0.75, 0.5, 0.25];
export const MISS_COST = 1;
const FALSE_ALARM_COST = 0.5;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export function anomalyPoints(column) { return QUARTER_POINTS[clamp(Math.floor((column / COLUMN_COUNT) * QUARTER_POINTS.length), 0, QUARTER_POINTS.length - 1)]; }

// The whole session drawn from the seed before it starts: every tick (its delay and pace), what spawns at each
// tick, and when the anomalies come. Spawning is simulated on a virtual board that ignores the player's taps, so
// two players of the same seed see exactly the same stream whatever they do. An anomaly never spawns on a track
// that still carries one.
export function buildSchedule(phases, seed) {
  const rnd = randomTools(createRandom(seed));
  const ticks = [{ delayMs: FIRST_SPAWN_MS, move: false, speed: phases[0].speed }];
  const ranges = [];
  phases.forEach((phase) => {
    const count = Math.round((phase.seconds * 1000) / stepDelay(phase.speed));
    ranges.push({ from: ticks.length, to: ticks.length + count - 1, anomalies: Math.round(phase.seconds / ANOMALY_EVERY_S) });
    for (let index = 0; index < count; index += 1) ticks.push({ delayMs: stepDelay(phase.speed), move: true, speed: phase.speed });
  });
  const anomalyTicks = [];
  ranges.forEach((range) => {
    const from = Math.max(range.from, FIRST_ANOMALY_TICK);
    const to = Math.min(range.to, ticks.length - 1 - TAIL_TICKS);
    let placed = 0;
    for (let attempt = 0; attempt < 500 && placed < range.anomalies && from <= to; attempt += 1) {
      const tick = rnd.int(from, to);
      if (anomalyTicks.every((other) => Math.abs(other - tick) >= MIN_ANOMALY_GAP)) { anomalyTicks.push(tick); placed += 1; }
    }
  });
  let board = [];
  const spawns = ticks.map((tick, index) => {
    if (tick.move) board = board.filter((target) => target.column < COLUMN_COUNT - 1).map((target) => ({ ...target, column: target.column + 1 }));
    const occupied = board.filter((target) => target.column === 0).map((target) => target.track);
    const available = Array.from({ length: TRACK_COUNT }, (_, track) => track).filter((track) => !occupied.includes(track));
    const minimum = board.length < 6 ? 2 : 0;
    const selected = rnd.shuffle(available).slice(0, Math.min(rnd.int(minimum, 5), available.length));
    const entries = selected.map((track) => ({ track, isAnomaly: false }));
    if (anomalyTicks.includes(index)) {
      const clear = (track) => !board.some((target) => target.track === track && target.isAnomaly);
      const slot = entries.find((entry) => clear(entry.track));
      if (slot) slot.isAnomaly = true;
      else { const free = available.filter((track) => !selected.includes(track) && clear(track)); if (free.length) entries.push({ track: rnd.item(free), isAnomaly: true }); }
    }
    board.push(...entries.map((entry) => ({ ...entry, column: 0 })));
    return entries;
  });
  return { ticks, spawns, anomalies: spawns.flat().filter((entry) => entry.isAnomaly).length, totalMs: ticks.reduce((sum, tick) => sum + tick.delayMs, 0) };
}

// Score out of 1000 from the anomaly outcomes and the false alarms.
export function radarScore(outcomes, falseAlarms, anomalies) {
  if (!anomalies) return 0;
  const points = outcomes.reduce((sum, outcome) => sum + outcome.points, 0) - falseAlarms * FALSE_ALARM_COST;
  return clamp(Math.round(clamp(points / anomalies, 0, 1) * 1000), 0, 1000);
}

// A Full Clearance session: one pace for `durationMinutes`, from a seed.
export function buildSession({ speed, durationMinutes }, seed) {
  return buildSchedule([{ speed, seconds: durationMinutes * 60 }], seed);
}

// The day's 90-second stream.
export function buildDailySchedule(seed) {
  return buildSchedule(DAILY_PHASES, deriveSeed(seed, "radar"));
}

// The session's result from the anomaly outcomes ([{ points, outcome: "fast" | "late" | "missed", reactionMs,
// speed }]), the false alarms and the number of anomalies in the schedule.
export function sessionSummary(outcomes, falseAlarms, anomalies) {
  const times = outcomes.map((outcome) => outcome.reactionMs).filter((value) => value !== null);
  return {
    score: radarScore(outcomes, falseAlarms, anomalies), anomalies,
    fast: outcomes.filter((outcome) => outcome.outcome === "fast").length, late: outcomes.filter((outcome) => outcome.outcome === "late").length, missed: outcomes.filter((outcome) => outcome.outcome === "missed").length,
    falseAlarms, meanReactionMs: times.length ? Math.round(times.reduce((sum, value) => sum + value, 0) / times.length) : null,
  };
}

// The daily result: the score, the metrics recorded, and the compact trial list.
export function dailyResult(outcomes, falseAlarms, anomalies) {
  const result = sessionSummary(outcomes, falseAlarms, anomalies);
  return {
    score: result.score,
    metrics: { detected: result.fast + result.late, anomalies, fast: result.fast, late: result.late, missed: result.missed, falseAlarms, meanReactionMs: result.meanReactionMs },
    trials: outcomes.map((outcome) => ({ ok: outcome.points > 0 ? 1 : 0, pts: outcome.points, ms: outcome.reactionMs, speed: outcome.speed })),
  };
}
