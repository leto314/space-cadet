// Target Drift (src/games/multitasking/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ALERT_KEYS, buildDailySession, buildSession, DAILY_STAGES, DAILY_WEIGHTS, dailyResult, DANGER_RADIUS, DIFFICULTY_CONFIG, driftCredit, EXPECTED_DECISIONS_PER_MINUTE, sessionSummary, TARGET_RADIUS } from "../../src/games/multitasking/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const SAMPLES = 40;
// Everything a session draws, in order, so two sessions can be compared.
function drawAll(session, count = SAMPLES) {
  const config = DIFFICULTY_CONFIG.medium;
  return {
    math: Array.from({ length: count }, () => session.nextQuestion("math")),
    letter: Array.from({ length: count }, () => session.nextQuestion("letter")),
    alerts: Array.from({ length: count }, () => session.nextAlert(config, ALERT_KEYS)),
    drift: Array.from({ length: count }, () => session.nextDrift(config)),
    jitter: Array.from({ length: count }, () => session.jitter()),
  };
}
// Stats of a full 90-second session: 1800 position samples of 50 ms.
const SAMPLES_90S = 1800;
const stats = (overrides = {}) => ({ correct: 0, decisions: 0, alertsHandled: 0, alertsMissed: 0, distanceTotal: 0, distanceSamples: SAMPLES_90S, creditTotal: 0, ...overrides });

describe("Target Drift - daily session content", () => {
  test("the same seed gives the same session, run after run", () => {
    for (const seed of SEEDS) {
      const first = drawAll(buildDailySession(seed));
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, drawAll(buildDailySession(seed))), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different sessions", () => {
    const sessions = SEEDS.map((seed) => drawAll(buildDailySession(seed)));
    for (let a = 0; a < sessions.length; a += 1) for (let b = a + 1; b < sessions.length; b += 1) {
      assert.ok(!same(sessions[a].math, sessions[b].math), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same calculations`);
      assert.ok(!same(sessions[a].alerts, sessions[b].alerts), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same alerts`);
    }
  });

  test("the streams are independent: drawing more questions does not change the alerts", () => {
    const a = buildDailySession(42); const b = buildDailySession(42);
    for (let index = 0; index < 10; index += 1) a.nextQuestion("math");
    const config = DIFFICULTY_CONFIG.easy;
    assert.ok(same(Array.from({ length: 10 }, () => a.nextAlert(config, ALERT_KEYS)), Array.from({ length: 10 }, () => b.nextAlert(config, ALERT_KEYS))));
  });

  test("calculations are right when they say they are, and wrong when they say they are", () => {
    let trueCount = 0; const total = 400;
    const session = buildDailySession(7);
    for (let index = 0; index < total; index += 1) {
      const question = session.nextQuestion("math");
      // The app writes the minus sign as U+2212 and the times sign as U+00D7 (kept as escapes so this file stays ASCII).
      const match = question.text.match(/^(\d+) ([+\u2212\u00d7]) (\d+) = (-?\d+)$/);
      assert.ok(match, `unreadable calculation: "${question.text}"`);
      const [, left, operation, right, shown] = match;
      const actual = operation === "+" ? Number(left) + Number(right) : operation === "\u2212" ? Number(left) - Number(right) : Number(left) * Number(right);
      assert.equal(question.isTrue, actual === Number(shown), `"${question.text}" is flagged ${question.isTrue} but the result is ${actual}`);
      trueCount += question.isTrue ? 1 : 0;
    }
    assert.ok(trueCount > total * 0.4 && trueCount < total * 0.6, `true calculations: ${trueCount} of ${total}, expected about half`);
  });

  test("sequences have six characters and repeat one exactly when they say so", () => {
    let trueCount = 0; const total = 400;
    const session = buildDailySession(7);
    for (let index = 0; index < total; index += 1) {
      const question = session.nextQuestion("letter");
      assert.equal(question.text.length, 6, `sequence "${question.text}" is not six characters`);
      const hasRepeat = new Set(question.text).size < 6;
      assert.equal(question.isTrue, hasRepeat, `"${question.text}" is flagged ${question.isTrue}`);
      if (hasRepeat) assert.equal(new Set(question.text).size, 5, `"${question.text}" repeats more than one character`);
      trueCount += question.isTrue ? 1 : 0;
    }
    assert.ok(trueCount > total * 0.4 && trueCount < total * 0.6, `sequences with a repeat: ${trueCount} of ${total}, expected about half`);
  });

  test("alerts respect the preset: wait within its range, key among the ones offered", () => {
    const session = buildDailySession(3);
    for (const config of Object.values(DIFFICULTY_CONFIG)) for (let index = 0; index < 100; index += 1) {
      const keys = ALERT_KEYS.slice(index % ALERT_KEYS.length || 1);
      const alert = session.nextAlert(config, keys);
      assert.ok(alert.delayMs >= config.taskDelay[0] && alert.delayMs <= config.taskDelay[1], `${config.label}: wait ${alert.delayMs} ms outside ${config.taskDelay}`);
      assert.ok(keys.includes(alert.key), `${config.label}: key ${alert.key} not among ${keys}`);
    }
  });

  test("drift and jitter stay within the preset's strength", () => {
    const session = buildDailySession(3);
    for (const config of Object.values(DIFFICULTY_CONFIG)) for (let index = 0; index < 100; index += 1) {
      const drift = session.nextDrift(config);
      assert.ok(Math.abs(drift.x) <= config.drift / 2 && Math.abs(drift.y) <= config.drift / 2, `${config.label}: drift ${JSON.stringify(drift)} stronger than ${config.drift / 2}`);
      const jitter = session.jitter();
      assert.ok(jitter >= -0.5 && jitter <= 0.5, `jitter ${jitter} outside -0.5..0.5`);
    }
  });
});

describe("Target Drift - daily progression", () => {
  test("three stages of thirty seconds, easy then medium then hard, ninety seconds in all", () => {
    const session = buildDailySession(1);
    assert.equal(session.totalSeconds, 90);
    assert.deepEqual(DAILY_STAGES.map((stage) => stage.key), ["easy", "medium", "hard"]);
    assert.deepEqual(DAILY_STAGES.map((stage) => stage.seconds), [30, 30, 30]);
    for (let second = 0; second < 90; second += 1) assert.equal(session.stageAt(second).key, second < 30 ? "easy" : second < 60 ? "medium" : "hard", `second ${second}`);
    assert.equal(session.stageAt(90), null);
  });

  test("the stages get harder: stronger drift, shorter alert deadline, target hidden last", () => {
    const [easy, medium, hard] = DAILY_STAGES.map((stage) => stage.config);
    assert.ok(easy.drift < medium.drift && medium.drift < hard.drift);
    assert.ok(easy.alertDeadline > medium.alertDeadline && medium.alertDeadline > hard.alertDeadline);
    assert.ok(easy.target && medium.target && !hard.target);
  });

  test("a Full Clearance session has one stage for the chosen duration", () => {
    const session = buildSession({ difficulty: "hard", durationMinutes: 2 }, 5);
    assert.equal(session.totalSeconds, 120);
    assert.equal(session.stageAt(119).config, DIFFICULTY_CONFIG.hard);
    assert.equal(session.stageAt(120), null);
  });
});

describe("Target Drift - daily score", () => {
  test("the weights add up to 1000", () => {
    assert.equal(Object.values(DAILY_WEIGHTS).reduce((sum, value) => sum + value, 0), 1000);
  });

  test("drift credit is full inside the target ring, nothing past the danger ring, decreasing between", () => {
    assert.equal(driftCredit(0), 1);
    assert.equal(driftCredit(TARGET_RADIUS), 1);
    assert.equal(driftCredit(DANGER_RADIUS), 0);
    assert.equal(driftCredit(1), 0);
    let previous = 1;
    for (let distance = TARGET_RADIUS; distance <= DANGER_RADIUS; distance += 0.01) { const credit = driftCredit(distance); assert.ok(credit <= previous && credit >= 0 && credit <= 1, `credit rises at ${distance.toFixed(2)}`); previous = credit; }
  });

  test("a perfect session scores 1000, an idle one 0", () => {
    const expected = EXPECTED_DECISIONS_PER_MINUTE * 1.5;
    const perfect = dailyResult(stats({ correct: expected, decisions: expected, alertsHandled: 20, creditTotal: SAMPLES_90S, distanceTotal: 0.1 * SAMPLES_90S }), 90);
    assert.equal(perfect.score, 1000);
    const idle = dailyResult(stats({ alertsMissed: 22, creditTotal: 0, distanceTotal: 0.9 * SAMPLES_90S }), 90);
    assert.equal(idle.score, 0);
  });

  test("the score never leaves 0-1000, whatever the stats", () => {
    const cases = fuzz({ correct: [0, 80], decisions: [0, 80], alertsHandled: [0, 40], alertsMissed: [0, 40], distanceSamples: [0, SAMPLES_90S], creditTotal: [0, SAMPLES_90S], distanceTotal: [0, SAMPLES_90S] }, 2000);
    for (const entry of cases) {
      const clean = { ...entry, decisions: Math.max(entry.decisions, entry.correct), creditTotal: Math.min(entry.creditTotal, entry.distanceSamples) };
      assertScore(dailyResult(clean, 90), JSON.stringify(clean));
      const parts = dailyResult(clean, 90).metrics;
      assert.ok(parts.driftPoints <= DAILY_WEIGHTS.drift && parts.decisionPoints <= DAILY_WEIGHTS.decisions && parts.alertPoints <= DAILY_WEIGHTS.alerts, `a part exceeds its weight: ${JSON.stringify(parts)}`);
    }
  });

  test("more right answers never lower the score, more missed alerts never raise it, wrong answers cost", () => {
    const base = stats({ correct: 10, decisions: 12, alertsHandled: 10, alertsMissed: 2, creditTotal: 1000, distanceTotal: 500 });
    const score = (overrides) => dailyResult(stats({ ...base, ...overrides }), 90).score;
    assert.ok(score({ correct: 14, decisions: 16 }) > score({}), "four more right answers should score more");
    assert.ok(score({ alertsMissed: 6 }) < score({}), "four more missed alerts should score less");
    assert.ok(score({ decisions: 16 }) < score({}), "four more wrong answers should score less");
    assert.ok(score({ creditTotal: 1500 }) > score({}), "better drift control should score more");
  });

  test("the Full Clearance summary reports accuracy and mean distance in percent", () => {
    assert.deepEqual(sessionSummary(stats({ correct: 3, decisions: 4, distanceTotal: 0.25 * SAMPLES_90S })), { accuracy: 75, averageDistance: 25 });
    assert.deepEqual(sessionSummary(stats({ distanceSamples: 0 })), { accuracy: 0, averageDistance: 0 });
  });
});
