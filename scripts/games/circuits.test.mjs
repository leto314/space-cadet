// Circuits (src/games/circuits/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildDailySession, buildSession, bulbsOf, circuitEntry, circuitPoints, DAILY_CIRCUITS, DAILY_POINTS_PER_CIRCUIT, dailyResult, evaluate, flipBudget, FLIPS_PER_SWITCH, gateSetFor, MODE_CYCLE, sameBits, SOLVED_FLOOR } from "../../src/games/circuits/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const ALL_GATES = gateSetFor({ withXor: true, withNegated: true });
const combosOf = (count) => Array.from({ length: 2 ** count }, (_, mask) => Array.from({ length: count }, (_, index) => (mask >> index) & 1));
const bitSum = (bits) => bits.reduce((sum, bit) => sum + bit, 0);
const perfect = (circuits) => circuits.map((circuit) => circuitEntry(circuit, { correct: true, timeMs: 6000, flips: circuit.mode === "inputs" ? circuit.minFlips : null }));
const nothing = (circuits) => circuits.map((circuit) => circuitEntry(circuit, { correct: false, timeMs: 6000, flips: circuit.mode === "inputs" ? flipBudget(circuit).cap : null }));

describe("Circuits - daily circuits", () => {
  test("the same seed gives the same circuits, run after run", () => {
    for (const seed of SEEDS) {
      const first = buildDailySession(seed);
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, buildDailySession(seed)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different circuits", () => {
    const runs = SEEDS.map((seed) => buildDailySession(seed));
    for (let a = 0; a < runs.length; a += 1) for (let b = a + 1; b < runs.length; b += 1) assert.ok(!same(runs[a], runs[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same circuits`);
  });

  test("six circuits, every mode played, boards and gate sets that never shrink, the switch-setting ones last", () => {
    assert.equal(DAILY_CIRCUITS.length, 6);
    assert.deepEqual([...new Set(DAILY_CIRCUITS.map((stage) => stage.mode))].sort(), [...MODE_CYCLE].sort());
    const firstInputs = DAILY_CIRCUITS.findIndex((stage) => stage.mode === "inputs");
    assert.ok(DAILY_CIRCUITS.slice(firstInputs).every((stage) => stage.mode === "inputs"), "setting the switches comes last");
    for (let index = 1; index < DAILY_CIRCUITS.length; index += 1) {
      const previous = DAILY_CIRCUITS[index - 1]; const stage = DAILY_CIRCUITS[index];
      assert.ok(stage.inputCount >= previous.inputCount || stage.mode !== previous.mode, `circuit ${index + 1} has a smaller board than circuit ${index}`);
      for (const gate of previous.gateSet) if (stage.mode === previous.mode) assert.ok(stage.gateSet.includes(gate), `circuit ${index + 1} drops ${gate}`);
      for (const gate of stage.gateSet) assert.ok(ALL_GATES.includes(gate), `unknown gate ${gate}`);
    }
    assert.deepEqual(DAILY_CIRCUITS[0].gateSet, ["AND", "OR", "NOT"], "the first circuit uses the basic gates only");
    assert.deepEqual(DAILY_CIRCUITS.at(-1).gateSet, ALL_GATES, "the last circuit uses all seven gates");
    for (const seed of [1, 42, 4242]) {
      const circuits = buildDailySession(seed);
      assert.equal(circuits.length, DAILY_CIRCUITS.length, `seed ${seed}: a circuit is missing`);
      circuits.forEach((circuit, index) => {
        assert.equal(circuit.mode, DAILY_CIRCUITS[index].mode);
        assert.equal(circuit.inputCount, DAILY_CIRCUITS[index].inputCount, `seed ${seed}: circuit ${index + 1} has ${circuit.inputCount} switches`);
        assert.deepEqual(circuit.gateSet, DAILY_CIRCUITS[index].gateSet);
        for (const layer of circuit.layers) for (const gate of layer) assert.ok(circuit.gateSet.includes(gate.type), `seed ${seed}: circuit ${index + 1} uses ${gate.type}, not in its set`);
      });
    }
  });

  test("every circuit is wired soundly: sources below, NOT with one input, no dead bulb, every node feeding something", () => {
    for (const seed of [1, 2, 3, 42, 1234]) buildDailySession(seed).forEach((circuit, index) => {
      const label = `seed ${seed}, circuit ${index + 1} (${circuit.mode})`;
      let below = circuit.inputCount;
      for (const layer of circuit.layers) {
        const fed = new Set();
        for (const gate of layer) {
          assert.equal(gate.sources.length, gate.type === "NOT" ? 1 : 2, `${label}: ${gate.type} has ${gate.sources.length} inputs`);
          for (const source of gate.sources) { assert.ok(source >= 0 && source < below, `${label}: a gate reads node ${source} of ${below}`); fed.add(source); }
        }
        assert.equal(fed.size, below, `${label}: a switch or gate feeds nothing`);
        below = layer.length;
      }
      const table = combosOf(circuit.inputCount).map((inputs) => bulbsOf(circuit, inputs));
      for (let bulb = 0; bulb < table[0].length; bulb += 1) assert.ok(table.some((row) => row[bulb] !== table[0][bulb]), `${label}: bulb ${bulb + 1} never changes`);
      assert.equal(circuit.target.length, circuit.layers.at(-1).length, `${label}: one target per bulb`);
      assert.equal(evaluate(circuit, circuit.inputs).length, circuit.layers.length + 1);
    });
  });

  test("predict: the target is what the switches really produce", () => {
    for (const seed of [1, 2, 3, 42, 1234]) for (const circuit of buildDailySession(seed).filter((entry) => entry.mode === "outputs")) {
      assert.ok(sameBits(bulbsOf(circuit, circuit.inputs), circuit.target), `seed ${seed}: the target does not match the circuit`);
      assert.ok(bitSum(circuit.inputs) > 0, `seed ${seed}: every switch is off`);
    }
  });

  test("missing gate: exactly one offered gate lights the target, and it is the real one", () => {
    for (const seed of [1, 2, 3, 42, 1234]) for (const circuit of buildDailySession(seed).filter((entry) => entry.mode === "gate")) {
      const { layer, index } = circuit.missing;
      assert.equal(circuit.layers[layer][index].type, circuit.answerType, `seed ${seed}: answerType is not the gate in the slot`);
      assert.notEqual(circuit.answerType, "NOT", `seed ${seed}: a NOT gate cannot go missing`);
      assert.ok(circuit.options.includes(circuit.answerType), `seed ${seed}: the answer is not offered`);
      assert.ok(circuit.options.length >= 2 && circuit.options.length <= 4, `seed ${seed}: ${circuit.options.length} options`);
      assert.equal(new Set(circuit.options).size, circuit.options.length, `seed ${seed}: an option is offered twice`);
      const working = circuit.options.filter((type) => sameBits(bulbsOf(circuit, circuit.inputs, { layer, index, type }), circuit.target));
      assert.deepEqual(working, [circuit.answerType], `seed ${seed}: ${working.length} options light the target`);
    }
  });

  test("set the switches: few solutions, none with every switch off, minFlips really is the fewest, and the budget follows", () => {
    for (const seed of [1, 2, 3, 42, 1234]) for (const circuit of buildDailySession(seed).filter((entry) => entry.mode === "inputs")) {
      const combos = combosOf(circuit.inputCount);
      const solutions = combos.filter((inputs) => sameBits(bulbsOf(circuit, inputs), circuit.target));
      assert.ok(solutions.length >= 1 && solutions.length <= Math.max(1, Math.floor(combos.length / 16)), `seed ${seed}: ${solutions.length} switch combinations work`);
      assert.ok(!solutions.some((inputs) => bitSum(inputs) === 0), `seed ${seed}: the target is already lit`);
      assert.equal(circuit.minFlips, Math.min(...solutions.map(bitSum)), `seed ${seed}: minFlips is wrong`);
      assert.equal(circuit.solutionCount, solutions.length);
      const { par, cap } = flipBudget(circuit);
      assert.equal(par, circuit.minFlips + 1);
      assert.equal(cap, circuit.minFlips + FLIPS_PER_SWITCH * circuit.inputCount);
      assert.ok(cap > par);
    }
  });

  test("circuits are drawn afresh from day to day", () => {
    const signatures = new Set();
    for (let seed = 1; seed <= 20; seed += 1) signatures.add(JSON.stringify(buildDailySession(seed)[5].layers));
    assert.ok(signatures.size >= 19, `only ${signatures.size} different circuits over 20 days`);
  });
});

describe("Circuits - Full Clearance session", () => {
  test("the requested circuits in the chosen mode and gate set, the same for the same seed; mixed draws its modes from the seed", () => {
    for (const settings of [{ mode: "outputs", circuitCount: 3, gateSet: gateSetFor({ withXor: false, withNegated: false }) }, { mode: "inputs", circuitCount: 5, gateSet: ALL_GATES }]) {
      const circuits = buildSession(settings, 42);
      assert.equal(circuits.length, settings.circuitCount);
      for (const circuit of circuits) { assert.equal(circuit.mode, settings.mode); for (const layer of circuit.layers) for (const gate of layer) assert.ok(settings.gateSet.includes(gate.type)); }
      assert.ok(same(circuits, buildSession(settings, 42)));
      assert.ok(!same(circuits, buildSession(settings, 43)));
    }
    const modes = new Set();
    for (let seed = 1; seed <= 10; seed += 1) for (const circuit of buildSession({ mode: "mixed", circuitCount: 6, gateSet: ALL_GATES }, seed)) modes.add(circuit.mode);
    assert.deepEqual([...modes].sort(), [...MODE_CYCLE].sort());
    const switches = new Set();
    for (let seed = 1; seed <= 12; seed += 1) for (const circuit of buildSession({ mode: "inputs", circuitCount: 4, gateSet: ALL_GATES }, seed)) switches.add(circuit.inputCount);
    assert.deepEqual([...switches].sort(), [3, 4, 5, 6], "free sessions draw every board size");
  });
});

describe("Circuits - daily score", () => {
  test("predicting and the missing gate are all or nothing; setting the switches pays 100 within par, a quarter at the cap, nothing unsolved", () => {
    for (const circuit of buildDailySession(3)) {
      if (circuit.mode !== "inputs") { assert.equal(circuitPoints(circuit, { correct: true }), 100); assert.equal(circuitPoints(circuit, { correct: false }), 0); continue; }
      const { par, cap } = flipBudget(circuit);
      assert.equal(circuitPoints(circuit, { correct: true, flips: circuit.minFlips }), 100);
      assert.equal(circuitPoints(circuit, { correct: true, flips: par }), 100);
      assert.equal(circuitPoints(circuit, { correct: true, flips: cap }), SOLVED_FLOOR);
      assert.equal(circuitPoints(circuit, { correct: false, flips: cap }), 0);
      let previous = 101;
      for (let flips = 1; flips <= cap + 5; flips += 1) { const points = circuitPoints(circuit, { correct: true, flips }); assert.ok(points <= previous, `${flips} flips score more than ${flips - 1}`); assert.ok(points >= 0 && points <= 100); previous = points; }
    }
  });

  test("the six circuits add up to 1000: perfect -> 1000, nothing -> 0", () => {
    assert.equal(Math.round(DAILY_POINTS_PER_CIRCUIT * DAILY_CIRCUITS.length), 1000);
    for (const seed of SEEDS) {
      const circuits = buildDailySession(seed);
      assert.equal(dailyResult(perfect(circuits)).score, 1000, `seed ${seed}: perfect play does not score 1000`);
      assert.equal(dailyResult(nothing(circuits)).score, 0, `seed ${seed}: failing everything does not score 0`);
    }
  });

  test("the score never leaves 0-1000, and the metrics report every circuit by mode", () => {
    const circuits = buildDailySession(11);
    for (const draw of fuzz({ mask: [0, 63], f4: [0, 30], f5: [0, 30] }, 600)) {
      const entries = circuits.map((circuit, index) => circuitEntry(circuit, { correct: Boolean((draw.mask >> index) & 1), timeMs: 1000 * (index + 1), flips: circuit.mode === "inputs" ? draw[`f${index}`] : null }));
      const result = dailyResult(entries);
      assertScore(result, JSON.stringify(draw));
      assert.equal(result.metrics.circuits, 6);
      assert.equal(result.trials.length, 6);
      assert.equal(result.metrics.predictPoints + result.metrics.gatePoints + result.metrics.switchPoints, entries.reduce((sum, entry) => sum + entry.points, 0));
    }
  });

  test("one more solved circuit never lowers the score; extra flips never raise it", () => {
    const circuits = buildDailySession(21);
    const entries = nothing(circuits);
    let previous = dailyResult(entries).score;
    circuits.forEach((circuit, index) => {
      entries[index] = circuitEntry(circuit, { correct: true, timeMs: 1000, flips: circuit.mode === "inputs" ? flipBudget(circuit).cap - 1 : null });
      const score = dailyResult(entries).score;
      assert.ok(score > previous, `solving circuit ${index + 1} did not raise the score`);
      previous = score;
    });
    const tight = dailyResult(perfect(circuits)).score;
    const loose = dailyResult(circuits.map((circuit) => circuitEntry(circuit, { correct: true, timeMs: 1000, flips: circuit.mode === "inputs" ? flipBudget(circuit).par + 3 : null }))).score;
    assert.ok(loose < tight, "extra flips beyond par should cost points");
  });
});
