// Pattern Matrix (src/games/pattern-matrix/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildDailySession, buildSession, DAILY_MATRICES, DAILY_POINTS_PER_MATRIX, dailyResult, FILLS, LAYOUTS, levelForIndex, SHAPES, SIZE_SCALES } from "../../src/games/pattern-matrix/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const played = (puzzles, correct) => puzzles.map((puzzle, index) => ({ correct: correct[index], timeMs: 8000, level: puzzle.level, layout: puzzle.layoutKey, optionCount: puzzle.options.length }));
const signature = (panel) => JSON.stringify(panel.components.map((component) => [component.shape, component.size, component.fill, component.mask ?? null]));

describe("Pattern Matrix - daily matrices", () => {
  test("the same seed gives the same matrices, run after run", () => {
    for (const seed of SEEDS) {
      const first = buildDailySession(seed);
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, buildDailySession(seed)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different matrices", () => {
    const runs = SEEDS.map((seed) => buildDailySession(seed));
    for (let a = 0; a < runs.length; a += 1) for (let b = a + 1; b < runs.length; b += 1) assert.ok(!same(runs[a], runs[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same matrices`);
  });

  test("eight matrices, easy to hard, four options then six, each worth 125", () => {
    assert.equal(DAILY_MATRICES.length, 8);
    assert.equal(DAILY_POINTS_PER_MATRIX, 125);
    const rank = { easy: 0, medium: 1, hard: 2 };
    for (let index = 1; index < DAILY_MATRICES.length; index += 1) {
      assert.ok(rank[DAILY_MATRICES[index].level] >= rank[DAILY_MATRICES[index - 1].level], `matrix ${index + 1} is easier than matrix ${index}`);
      assert.ok(DAILY_MATRICES[index].optionCount >= DAILY_MATRICES[index - 1].optionCount, `matrix ${index + 1} has fewer options than matrix ${index}`);
    }
    assert.deepEqual([...new Set(DAILY_MATRICES.map((stage) => stage.level))], ["easy", "medium", "hard"]);
    assert.deepEqual([...new Set(DAILY_MATRICES.map((stage) => stage.optionCount))], [4, 6]);
    for (const seed of [1, 42, 4242]) {
      const puzzles = buildDailySession(seed);
      assert.equal(puzzles.length, DAILY_MATRICES.length, `seed ${seed}: a matrix is missing`);
      puzzles.forEach((puzzle, index) => {
        assert.equal(puzzle.level, DAILY_MATRICES[index].level);
        assert.equal(puzzle.options.length, DAILY_MATRICES[index].optionCount);
      });
    }
  });

  test("every matrix is well formed: eight panels, the answer among distinct options, every entity inside its layout and domains", () => {
    for (const seed of [1, 2, 3, 42, 1234]) buildDailySession(seed).forEach((puzzle, index) => {
      const label = `seed ${seed}, matrix ${index + 1} (${puzzle.level}, ${puzzle.layoutKey})`;
      const specs = LAYOUTS[puzzle.layoutKey];
      assert.ok(specs, `${label}: unknown layout`);
      assert.equal(puzzle.panels.length, 8, `${label}: a 3 x 3 matrix shows eight panels`);
      assert.ok(puzzle.answerIndex >= 0 && puzzle.answerIndex < puzzle.options.length, `${label}: the answer index is out of range`);
      assert.ok(same(puzzle.options[puzzle.answerIndex], puzzle.answer), `${label}: the option at answerIndex is not the answer`);
      assert.equal(new Set(puzzle.options.map(signature)).size, puzzle.options.length, `${label}: two options look the same`);
      for (const panel of [...puzzle.panels, ...puzzle.options]) {
        assert.equal(panel.components.length, specs.length, `${label}: a panel has the wrong number of components`);
        panel.components.forEach((component, ci) => {
          assert.ok(component.shape >= 0 && component.shape < SHAPES.length, `${label}: shape ${component.shape}`);
          assert.ok(component.size >= 0 && component.size < SIZE_SCALES.length, `${label}: size ${component.size}`);
          assert.ok(component.fill >= 0 && component.fill < FILLS.length, `${label}: fill ${component.fill}`);
          if (specs[ci].kind === "grid") {
            assert.ok(component.mask > 0 && component.mask < 2 ** specs[ci].slots.length, `${label}: mask ${component.mask} does not fit the grid`);
            let bits = 0; for (let value = component.mask; value; value >>= 1) bits += value & 1;
            assert.equal(component.count, bits, `${label}: count and mask disagree`);
          }
        });
      }
    });
  });

  test("no attribute gives the answer away: where the options differ, the answer's value is never held by more than half of them (I-RAVEN)", () => {
    for (const seed of [1, 2, 3, 42, 1234]) buildDailySession(seed).forEach((puzzle, index) => {
      const label = `seed ${seed}, matrix ${index + 1}`;
      let differing = 0;
      puzzle.answer.components.forEach((component, ci) => {
        for (const key of ["shape", "size", "fill", "count", "mask"]) {
          if (component[key] === undefined) continue;
          const sharing = puzzle.options.filter((option) => option.components[ci][key] === component[key]).length;
          if (sharing === puzzle.options.length) continue; // the same on every option: nothing to read there
          differing += 1;
          assert.ok(sharing <= puzzle.options.length / 2, `${label}: ${sharing} of ${puzzle.options.length} options share the answer's ${key}`);
        }
      });
      assert.ok(differing >= 2, `${label}: the options differ on ${differing} attribute, so one change tells the answer`);
    });
  });

  test("easy matrices use simple layouts, the nested and 3 x 3 layouts wait for medium and hard", () => {
    const layoutsAt = { easy: new Set(), medium: new Set(), hard: new Set() };
    for (let seed = 1; seed <= 40; seed += 1) for (const puzzle of buildDailySession(seed)) layoutsAt[puzzle.level].add(puzzle.layoutKey);
    assert.ok(!layoutsAt.easy.has("outIn") && !layoutsAt.easy.has("upDown") && !layoutsAt.easy.has("grid3"), `easy layouts: ${[...layoutsAt.easy].join(", ")}`);
    assert.ok(!layoutsAt.medium.has("grid3"), `medium layouts: ${[...layoutsAt.medium].join(", ")}`);
    assert.ok(layoutsAt.easy.size >= 2 && layoutsAt.hard.size >= 3, "the layouts vary over the days");
  });

  test("matrices are drawn afresh from day to day", () => {
    const signatures = new Set();
    for (let seed = 1; seed <= 20; seed += 1) signatures.add(JSON.stringify(buildDailySession(seed)[6].panels.map(signature)));
    assert.ok(signatures.size >= 19, `only ${signatures.size} different matrices over 20 days`);
  });
});

describe("Pattern Matrix - Full Clearance session", () => {
  test("the requested matrices at the chosen difficulty, the same for the same seed", () => {
    for (const settings of [{ puzzleCount: 3, optionCount: 4, difficulty: "easy" }, { puzzleCount: 8, optionCount: 6, difficulty: "progressive" }]) {
      const puzzles = buildSession(settings, 42);
      assert.equal(puzzles.length, settings.puzzleCount);
      puzzles.forEach((puzzle, index) => { assert.equal(puzzle.level, levelForIndex(settings.difficulty, index, settings.puzzleCount)); assert.equal(puzzle.options.length, settings.optionCount); });
      assert.ok(same(puzzles, buildSession(settings, 42)));
      assert.ok(!same(puzzles, buildSession(settings, 43)));
    }
    assert.deepEqual(Array.from({ length: 6 }, (_, index) => levelForIndex("progressive", index, 6)), ["easy", "easy", "medium", "medium", "hard", "hard"]);
  });
});

describe("Pattern Matrix - daily score", () => {
  test("all right -> 1000, none -> 0, 125 per right answer", () => {
    for (const seed of SEEDS) {
      const puzzles = buildDailySession(seed);
      assert.equal(dailyResult(played(puzzles, puzzles.map(() => true))).score, 1000);
      assert.equal(dailyResult(played(puzzles, puzzles.map(() => false))).score, 0);
      assert.equal(dailyResult(played(puzzles, puzzles.map((_, index) => index % 2 === 0))).score, 500);
    }
  });

  test("the score never leaves 0-1000, and the metrics report every matrix by level", () => {
    const puzzles = buildDailySession(11);
    for (const draw of fuzz({ mask: [0, 255] }, 300)) {
      const result = dailyResult(played(puzzles, puzzles.map((_, index) => Boolean((draw.mask >> index) & 1))));
      assertScore(result, JSON.stringify(draw));
      assert.equal(result.metrics.matrices, 8);
      assert.equal(result.trials.length, 8);
      assert.equal(result.metrics.easyCorrect + result.metrics.mediumCorrect + result.metrics.hardCorrect, result.metrics.correct);
    }
  });

  test("one more right answer never lowers the score", () => {
    const puzzles = buildDailySession(21);
    let previous = -1;
    for (let right = 0; right <= puzzles.length; right += 1) {
      const score = dailyResult(played(puzzles, puzzles.map((_, index) => index < right))).score;
      assert.ok(score > previous, `${right} right answers do not score more than ${right - 1}`);
      previous = score;
    }
  });
});
