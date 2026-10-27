// Memory Sequences (src/games/memory-span/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildDailyLadder, buildRound, buildSequence, computeResult, DAILY_LADDER, DIGIT_WORDS, difficultyOf, DIFFICULTY_OPTIONS, dailyResult, directionLabel, NATO_WORDS, PARTIAL_CREDIT, POINTS_PER_SEQUENCE, sequencePoints, targetSequence } from "../../src/games/memory-span/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const results = (build) => buildDailyLadder(1).map((round, index) => build(round, index));
const allExact = () => results((round) => ({ exact: true, wrongDirection: false, correctPositions: round.length, total: round.length, length: round.length, difficulty: round.difficulty, ms: 4000 }));
const allWrong = () => results((round) => ({ exact: false, wrongDirection: false, correctPositions: 0, total: round.length, length: round.length, difficulty: round.difficulty, ms: 4000 }));

describe("Memory Sequences - daily ladder", () => {
  test("the same seed gives the same ladder, run after run", () => {
    for (const seed of SEEDS) {
      const first = buildDailyLadder(seed);
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, buildDailyLadder(seed)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different ladders", () => {
    const ladders = SEEDS.map((seed) => buildDailyLadder(seed));
    for (let a = 0; a < ladders.length; a += 1) for (let b = a + 1; b < ladders.length; b += 1) assert.ok(!same(ladders[a], ladders[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same sequences`);
  });

  test("nine sequences, growing, easy then medium then hard, the hard ones 6 to 9 long", () => {
    assert.equal(DAILY_LADDER.length, 9);
    assert.deepEqual(DAILY_LADDER.map((step) => step.difficulty), ["easy", "easy", "medium", "medium", "medium", "hard", "hard", "hard", "hard"]);
    assert.deepEqual(DAILY_LADDER.filter((step) => step.difficulty === "hard").map((step) => step.length), [6, 7, 8, 9]);
    for (const group of ["easy", "medium", "hard"]) {
      const lengths = DAILY_LADDER.filter((step) => step.difficulty === group).map((step) => step.length);
      assert.deepEqual(lengths, [...lengths].sort((a, b) => a - b), `${group}: the sequences do not get longer`);
    }
    assert.ok(Math.abs(POINTS_PER_SEQUENCE * DAILY_LADDER.length - 1000) < 1e-9);
  });

  test("every sequence matches its step: right length, its preset, a direction, speakable characters", () => {
    for (const seed of SEEDS) buildDailyLadder(seed).forEach((round, index) => {
      const step = DAILY_LADDER[index];
      assert.equal(round.sequence.length, step.length, `seed ${seed}, sequence ${index + 1}: wrong length`);
      assert.equal(round.config, difficultyOf(step.difficulty));
      assert.ok(["forward", "reverse"].includes(round.direction));
      for (const item of round.sequence) {
        const spoken = NATO_WORDS[item.symbol] ?? DIGIT_WORDS[item.symbol];
        assert.equal(item.spoken, spoken, `"${item.symbol}" is spoken "${item.spoken}"`);
        if (!round.config.allowLetters) assert.ok(/^[0-9]$/.test(item.symbol), `${step.difficulty}: letter "${item.symbol}" in a digits-only sequence`);
      }
    });
  });

  test("letters only appear in the hard sequences, and stay a minority", () => {
    let letters = 0; let characters = 0;
    for (let seed = 1; seed <= 60; seed += 1) for (const round of buildDailyLadder(seed)) {
      if (!round.config.allowLetters) continue;
      characters += round.sequence.length;
      letters += round.sequence.filter((item) => /[A-Z]/.test(item.symbol)).length;
    }
    const share = letters / characters;
    assert.ok(share > 0.2 && share < 0.45, `letters make up ${Math.round(share * 100)}% of the hard sequences`);
  });

  test("both recall directions come up, and the easy preset announces its direction", () => {
    const directions = new Set();
    for (let seed = 1; seed <= 40; seed += 1) for (const round of buildDailyLadder(seed)) directions.add(round.direction);
    assert.deepEqual([...directions].sort(), ["forward", "reverse"]);
    assert.equal(difficultyOf("easy").revealDirectionEarly, true);
    assert.equal(difficultyOf("medium").revealDirectionEarly, false);
    assert.equal(difficultyOf("hard").revealDirectionEarly, false);
    assert.equal(directionLabel("reverse"), "REVERSE");
  });

  test("a Full Clearance round follows the chosen settings and is reproducible", () => {
    const round = buildRound({ difficulty: "hard", length: 9 }, 77);
    assert.equal(round.sequence.length, 9);
    assert.ok(same(round, buildRound({ difficulty: "hard", length: 9 }, 77)));
    assert.ok(!same(round, buildRound({ difficulty: "hard", length: 9 }, 78)));
    for (const option of DIFFICULTY_OPTIONS) assert.ok(buildSequence(4, option.allowLetters, () => 0.5).length === 4);
  });
});

describe("Memory Sequences - judging an answer", () => {
  const sequence = [1, 2, 3, 4].map((digit) => ({ symbol: String(digit), spoken: DIGIT_WORDS[digit] }));

  test("forward and reverse ask for the sequence the right way round", () => {
    assert.deepEqual(targetSequence(sequence, "forward").map((item) => item.symbol), ["1", "2", "3", "4"]);
    assert.deepEqual(targetSequence(sequence, "reverse").map((item) => item.symbol), ["4", "3", "2", "1"]);
  });

  test("an exact answer, a partly right one, a reversed one", () => {
    const exact = computeResult(sequence, "1234", "forward");
    assert.deepEqual([exact.exact, exact.correctPositions, exact.accuracy, exact.wrongDirection], [true, 4, 100, false]);
    const partial = computeResult(sequence, "1294", "forward");
    assert.deepEqual([partial.exact, partial.correctPositions, partial.accuracy], [false, 3, 75]);
    const reversed = computeResult(sequence, "4321", "forward");
    assert.equal(reversed.wrongDirection, true);
    assert.equal(reversed.exact, false);
    assert.equal(computeResult(sequence, "4321", "reverse").exact, true);
    const empty = computeResult(sequence, "", "forward");
    assert.deepEqual([empty.exact, empty.correctPositions, empty.accuracy], [false, 0, 0]);
  });
});

describe("Memory Sequences - daily score", () => {
  test("a sequence is worth its full share exactly right, half credit per right position otherwise", () => {
    assert.equal(sequencePoints({ exact: true, correctPositions: 5, total: 5 }), POINTS_PER_SEQUENCE);
    assert.equal(sequencePoints({ exact: false, correctPositions: 5, total: 5 }), POINTS_PER_SEQUENCE * PARTIAL_CREDIT);
    assert.equal(sequencePoints({ exact: false, correctPositions: 0, total: 5 }), 0);
    assert.ok(sequencePoints({ exact: false, correctPositions: 4, total: 5 }) < sequencePoints({ exact: true, correctPositions: 5, total: 5 }), "a near miss is worth less than an exact answer");
  });

  test("every sequence right scores 1000, nothing right scores 0", () => {
    const perfect = dailyResult(allExact());
    assert.equal(perfect.score, 1000);
    assert.equal(perfect.metrics.exact, DAILY_LADDER.length);
    assert.equal(perfect.metrics.longestExact, Math.max(...DAILY_LADDER.map((step) => step.length)));
    assert.equal(dailyResult(allWrong()).score, 0);
  });

  test("the score never leaves 0-1000, whatever the answers", () => {
    for (const entry of fuzz({ exact: [0, 1], correct: [0, 9], extra: [0, 3] }, 800)) {
      const cases = buildDailyLadder(5).map((round) => ({ exact: Boolean(entry.exact), wrongDirection: false, correctPositions: Math.min(entry.correct, round.length), total: round.length, length: round.length, difficulty: round.difficulty, ms: 1000 * entry.extra }));
      assertScore(dailyResult(cases), JSON.stringify(entry));
    }
  });

  test("more right positions never lower the score, and the trials record every sequence", () => {
    const base = dailyResult(allWrong()).score;
    const better = dailyResult(results((round) => ({ exact: false, wrongDirection: false, correctPositions: Math.min(2, round.length), total: round.length, length: round.length, difficulty: round.difficulty, ms: 4000 }))).score;
    assert.ok(better > base);
    assert.ok(dailyResult(allExact()).score > better);
    const trials = dailyResult(allExact()).trials;
    assert.equal(trials.length, DAILY_LADDER.length);
    assert.deepEqual(trials.map((trial) => trial.length), DAILY_LADDER.map((step) => step.length));
  });
});
