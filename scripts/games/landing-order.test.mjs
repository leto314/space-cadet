// Landing Order (src/games/landing-order/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createRandom } from "../../src/utils/random.js";
import { buildDailySession, buildScenario, buildSession, DAILY_POINTS_PER_SCENARIO, DAILY_SCENARIOS, dailyResult, isNumericQuestion } from "../../src/games/landing-order/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

// Scenarios carry closures (each clue's `test`), so they are compared through what is shown and asked.
const shape = (scenario) => ({ names: scenario.names, pos: scenario.pos, answer: scenario.answer, question: { type: scenario.question.type, template: scenario.question.template, actors: scenario.question.actors, options: scenario.question.options }, clues: scenario.clues.map((clue) => ({ key: clue.key, template: clue.template, actors: clue.actors })) });
const shapes = (scenarios) => scenarios.map(shape);

// Every landing order of `count` aircraft, as position arrays.
function allOrders(count) {
  const orders = [];
  const walk = (prefix, rest) => { if (!rest.length) { orders.push(prefix); return; } rest.forEach((value, index) => walk([...prefix, value], [...rest.slice(0, index), ...rest.slice(index + 1)])); };
  walk([], Array.from({ length: count }, (_, index) => index));
  return orders.map((order) => { const pos = []; order.forEach((aircraft, slot) => { pos[aircraft] = slot; }); return pos; });
}
const played = (scenarios, correct) => scenarios.map((scenario, index) => ({ correct: correct[index], timeMs: 5000, clues: scenario.clues.length, questionType: scenario.question.type, aircraftCount: scenario.aircraftCount, memorise: scenario.memorise }));

describe("Landing Order - daily scenarios", () => {
  test("the same seed gives the same scenarios, run after run", () => {
    for (const seed of SEEDS) {
      const first = shapes(buildDailySession(seed));
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, shapes(buildDailySession(seed))), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different scenarios", () => {
    const runs = SEEDS.map((seed) => shapes(buildDailySession(seed)));
    for (let a = 0; a < runs.length; a += 1) for (let b = a + 1; b < runs.length; b += 1) assert.ok(!same(runs[a], runs[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same scenarios`);
  });

  test("eight scenarios, 3 to 6 aircraft, the briefing visible first and memorised last, each worth 125", () => {
    assert.equal(DAILY_SCENARIOS.length, 8);
    assert.equal(DAILY_POINTS_PER_SCENARIO, 125);
    const visible = DAILY_SCENARIOS.filter((stage) => !stage.memorise);
    const memorised = DAILY_SCENARIOS.filter((stage) => stage.memorise);
    assert.ok(visible.length && memorised.length, "both briefing modes are played");
    assert.ok(DAILY_SCENARIOS.slice(0, visible.length).every((stage) => !stage.memorise), "the visible briefings come first");
    for (let index = 1; index < visible.length; index += 1) assert.ok(visible[index].aircraftCount >= visible[index - 1].aircraftCount, "the visible scenarios never lose aircraft");
    for (let index = 1; index < memorised.length; index += 1) assert.ok(memorised[index].aircraftCount >= memorised[index - 1].aircraftCount, "the memorised scenarios never lose aircraft");
    assert.equal(Math.min(...DAILY_SCENARIOS.map((stage) => stage.aircraftCount)), 3);
    assert.equal(Math.max(...DAILY_SCENARIOS.map((stage) => stage.aircraftCount)), 6);
    for (const seed of [1, 42, 4242]) {
      const scenarios = buildDailySession(seed);
      assert.equal(scenarios.length, DAILY_SCENARIOS.length, `seed ${seed}: a scenario is missing`);
      scenarios.forEach((scenario, index) => {
        assert.equal(scenario.aircraftCount, DAILY_SCENARIOS[index].aircraftCount);
        assert.equal(scenario.memorise, DAILY_SCENARIOS[index].memorise);
        assert.equal(scenario.names.length, scenario.aircraftCount);
      });
    }
  });

  test("every clue is true, the clues pin the answer down to exactly one, and no clue can be spared", () => {
    for (const seed of [1, 2, 3, 42, 1234]) for (const scenario of buildDailySession(seed)) {
      const label = `seed ${seed}, ${scenario.aircraftCount} aircraft`;
      for (const clue of scenario.clues) assert.ok(clue.test(scenario.pos), `${label}: clue "${clue.template}" is false for the real order`);
      const orders = allOrders(scenario.aircraftCount);
      const fits = (clues) => orders.filter((pos) => clues.every((clue) => clue.test(pos)));
      const answers = (clues) => new Set(fits(clues).map(scenario.question.answerOf));
      assert.equal(answers(scenario.clues).size, 1, `${label}: the clues leave ${answers(scenario.clues).size} possible answers`);
      assert.equal([...answers(scenario.clues)][0], scenario.answer, `${label}: the recorded answer is not the one the clues give`);
      for (const clue of scenario.clues) assert.ok(answers(scenario.clues.filter((other) => other !== clue)).size > 1, `${label}: clue "${clue.template}" is not needed`);
      assert.ok(scenario.question.options.some((option) => option.value === scenario.answer), `${label}: the answer is not among the options`);
      assert.equal(new Set(scenario.clues.map((clue) => clue.key)).size, scenario.clues.length, `${label}: a clue is given twice`);
    }
  });

  test("every sentence names real aircraft, and numeric questions are told apart from aircraft ones", () => {
    for (const seed of [1, 2, 3]) for (const scenario of buildDailySession(seed)) {
      const check = (template, actors) => {
        for (const slot of template.match(/\{[ABC]\}/g) ?? []) assert.ok(scenario.names[actors[slot[1]]], `seed ${seed}: "${template}" names an unknown aircraft`);
      };
      scenario.clues.forEach((clue) => check(clue.template, clue.actors));
      check(scenario.question.template, scenario.question.actors);
      const numeric = isNumericQuestion(scenario.question);
      assert.ok(scenario.question.options.every((option) => numeric ? !scenario.names.includes(option.label) : scenario.names.includes(option.label)), `seed ${seed}: the options do not match the question kind`);
    }
  });

  test("every kind of question comes up over the days", () => {
    const kinds = new Set();
    for (let seed = 1; seed <= 40; seed += 1) for (const scenario of buildDailySession(seed)) kinds.add(scenario.question.type);
    assert.deepEqual([...kinds].sort(), ["aircraft-at", "gap-count", "next-after", "position-of"]);
  });

  test("scenarios are drawn afresh from day to day", () => {
    const signatures = new Set();
    for (let seed = 1; seed <= 20; seed += 1) signatures.add(JSON.stringify(shape(buildDailySession(seed)[3])));
    assert.ok(signatures.size >= 19, `only ${signatures.size} different scenarios over 20 days`);
  });
});

describe("Landing Order - Full Clearance session", () => {
  test("the requested number of scenarios with the chosen aircraft, the same for the same seed", () => {
    for (const settings of [{ aircraftCount: 3, scenarioCount: 3, memorise: false }, { aircraftCount: 6, scenarioCount: 5, memorise: true }]) {
      const scenarios = buildSession(settings, 42);
      assert.equal(scenarios.length, settings.scenarioCount);
      for (const scenario of scenarios) { assert.equal(scenario.aircraftCount, settings.aircraftCount); assert.equal(scenario.memorise, settings.memorise); }
      assert.ok(same(shapes(scenarios), shapes(buildSession(settings, 42))));
      assert.ok(!same(shapes(scenarios), shapes(buildSession(settings, 43))));
    }
  });

  test("buildScenario draws only from the generator it is given (the mission module shares one stream)", () => {
    const random = createRandom(5);
    const a = buildScenario(3, random);
    const b = buildScenario(3, random);
    assert.ok(!same(shape(a), shape(b)), "two scenarios from one stream should differ");
    assert.ok(same(shape(a), shape(buildScenario(3, createRandom(5)))));
  });
});

describe("Landing Order - daily score", () => {
  test("all right -> 1000, none -> 0, 125 per right answer", () => {
    for (const seed of SEEDS) {
      const scenarios = buildDailySession(seed);
      assert.equal(dailyResult(played(scenarios, scenarios.map(() => true))).score, 1000);
      assert.equal(dailyResult(played(scenarios, scenarios.map(() => false))).score, 0);
      assert.equal(dailyResult(played(scenarios, scenarios.map((_, index) => index < 3))).score, 375);
    }
  });

  test("the score never leaves 0-1000, and the metrics report every scenario", () => {
    const scenarios = buildDailySession(11);
    for (const draw of fuzz({ mask: [0, 255] }, 300)) {
      const result = dailyResult(played(scenarios, scenarios.map((_, index) => Boolean((draw.mask >> index) & 1))));
      assertScore(result, JSON.stringify(draw));
      assert.equal(result.metrics.scenarios, 8);
      assert.equal(result.trials.length, 8);
      assert.equal(result.metrics.visibleCorrect + result.metrics.memorisedCorrect, result.metrics.correct);
    }
  });

  test("one more right answer never lowers the score", () => {
    const scenarios = buildDailySession(21);
    let previous = -1;
    for (let right = 0; right <= scenarios.length; right += 1) {
      const score = dailyResult(played(scenarios, scenarios.map((_, index) => index < right))).score;
      assert.ok(score > previous, `${right} right answers do not score more than ${right - 1}`);
      previous = score;
    }
  });
});
