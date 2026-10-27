// Visual Memory (src/games/visual-grid-memory/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildDailyLadder, buildDailyLadders, buildDistractionFrames, buildRound, buildTargets, DAILY_LADDER_STAGES, DAILY_LADDERS, DAILY_MAX_TARGETS, DAILY_START_TARGETS, dailyResult, DISTRACTION_FRAMES, ladderPoints, maxTargetsForGrid, pickDailyLadders } from "../../src/games/visual-grid-memory/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const played = (ladders, spans) => ladders.map((ladder, index) => ({ ladder, span: spans[index] }));

describe("Visual Memory - daily ladders", () => {
  test("the same seed gives the same ladders and patterns, run after run", () => {
    for (const seed of SEEDS) {
      const first = buildDailyLadders(seed);
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, buildDailyLadders(seed)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different patterns", () => {
    const runs = SEEDS.map((seed) => buildDailyLadders(seed));
    for (let a = 0; a < runs.length; a += 1) for (let b = a + 1; b < runs.length; b += 1) assert.ok(!same(runs[a], runs[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same patterns`);
  });

  test("three stages: a plain 4 x 4, then order or decoys, then the grid turning or a 6 x 6 in order", () => {
    assert.equal(DAILY_LADDER_STAGES.length, 3);
    assert.deepEqual(DAILY_LADDER_STAGES.map((choices) => choices.map((ladder) => ladder.key)), [["plain"], ["order", "distraction"], ["rotation", "order6"]]);
    const [plain] = DAILY_LADDER_STAGES[0];
    assert.ok(plain.gridSize === 4 && !plain.rotateBeforeRecall && !plain.orderedRecall && !plain.distraction, "the first ladder is a plain 4 x 4");
    for (const ladder of DAILY_LADDER_STAGES[1]) assert.ok(ladder.gridSize === 5 && !ladder.rotateBeforeRecall, `${ladder.key}: the second stage is 5 x 5 and never turns`);
    for (const ladder of DAILY_LADDERS) {
      assert.ok(ladder.fullSpan <= DAILY_MAX_TARGETS, `${ladder.key}: its full span is out of reach`);
      assert.ok(ladder.fullSpan <= plain.fullSpan, `${ladder.key}: a harder ladder should not ask for a longer span than the plain one`);
    }
    assert.ok(DAILY_LADDERS.filter((ladder) => ladder.rotateBeforeRecall).every((ladder) => DAILY_LADDER_STAGES[2].includes(ladder)), "the grid only turns in the last stage");
  });

  test("the day's pick: every combination comes up, and each pick's weights add up to 1000", () => {
    const seen = new Set();
    for (let seed = 1; seed <= 80; seed += 1) {
      const ladders = pickDailyLadders(seed);
      assert.equal(ladders.length, 3);
      ladders.forEach((ladder, index) => assert.ok(DAILY_LADDER_STAGES[index].includes(ladder), `day ${seed}: stage ${index + 1} got "${ladder.key}"`));
      assert.equal(ladders.reduce((sum, ladder) => sum + ladder.weight, 0), 1000, `day ${seed}: weights do not add up`);
      seen.add(ladders.map((ladder) => ladder.key).join("+"));
    }
    assert.equal(seen.size, 4, `only ${[...seen].join(", ")} came up in 80 days`);
  });

  test("each ladder climbs one cell at a time from three, and every pattern fits its grid", () => {
    for (const seed of [1, 42, 4242]) buildDailyLadders(seed).forEach((ladder) => {
      assert.equal(ladder.rounds.length, DAILY_MAX_TARGETS - DAILY_START_TARGETS + 1);
      ladder.rounds.forEach((round, step) => {
        const cells = ladder.gridSize ** 2;
        assert.equal(round.targetCount, DAILY_START_TARGETS + step, `${ladder.key}: round ${step + 1} asks for the wrong number of cells`);
        assert.equal(round.targets.length, round.targetCount);
        assert.equal(new Set(round.targets).size, round.targets.length, `${ladder.key}: a cell is repeated in the pattern`);
        for (const cell of round.targets) assert.ok(Number.isInteger(cell) && cell >= 0 && cell < cells, `${ladder.key}: cell ${cell} is outside a ${ladder.gridSize} x ${ladder.gridSize} grid`);
        assert.ok(ladder.rotateBeforeRecall ? [-90, 90].includes(round.rotation) : round.rotation === 0, `${ladder.key}: rotation ${round.rotation}`);
        if (ladder.distraction) {
          assert.equal(round.frames.length, DISTRACTION_FRAMES, `${ladder.key}: decoy frames missing`);
          for (const frame of round.frames) { assert.equal(frame.length, round.targetCount); assert.notEqual(frame.join(","), round.targets.join(","), `${ladder.key}: a decoy repeats the pattern`); }
        } else assert.equal(round.frames, null, `${ladder.key}: decoy frames built although the ladder has none`);
      });
    });
  });

  test("the turning ladder turns both ways over the days", () => {
    const rotation = DAILY_LADDER_STAGES[2].find((ladder) => ladder.rotateBeforeRecall);
    const rotations = new Set();
    for (let seed = 1; seed <= 30; seed += 1) for (const round of buildDailyLadder(seed, rotation, 2)) rotations.add(round.rotation);
    assert.deepEqual([...rotations].sort((a, b) => a - b), [-90, 90]);
  });

  test("patterns are drawn afresh: the same ladder step differs from one day to the next", () => {
    const signatures = new Set();
    for (let seed = 1; seed <= 20; seed += 1) signatures.add(buildDailyLadders(seed)[0].rounds[3].targets.join(","));
    assert.ok(signatures.size >= 18, `only ${signatures.size} different patterns over 20 days`);
  });

  test("a Full Clearance round and the distraction frames follow their settings", () => {
    const round = buildRound({ gridSize: 6, targetCount: 5, rotateBeforeRecall: true, distraction: true }, 9);
    assert.equal(round.targets.length, 5);
    assert.ok(round.targets.every((cell) => cell < 36));
    assert.equal(round.frames.length, DISTRACTION_FRAMES);
    assert.ok(same(round, buildRound({ gridSize: 6, targetCount: 5, rotateBeforeRecall: true, distraction: true }, 9)));
    assert.equal(buildRound({ gridSize: 4, targetCount: 2 }, 9).frames, null);
    const frames = buildDistractionFrames(16, 4, 3, "0,1,2,3");
    assert.equal(frames.length, DISTRACTION_FRAMES);
    for (const frame of frames) { assert.equal(frame.length, 4); assert.notEqual(frame.join(","), "0,1,2,3", "a decoy repeats the pattern"); }
    assert.equal(buildTargets(16, 16, () => 0.5).length, 16, "a pattern may fill the grid");
    assert.equal(maxTargetsForGrid(4), 10);
  });
});

describe("Visual Memory - daily score", () => {
  test("a ladder pays from its starting span up to its full span", () => {
    for (const ladder of DAILY_LADDERS) {
      assert.equal(ladderPoints(ladder, DAILY_START_TARGETS - 1), 0, `${ladder.key}: failing the first pattern should score 0`);
      assert.equal(ladderPoints(ladder, 0), 0);
      assert.equal(ladderPoints(ladder, ladder.fullSpan), ladder.weight, `${ladder.key}: its full span should pay its whole weight`);
      assert.equal(ladderPoints(ladder, ladder.fullSpan + 3), ladder.weight, `${ladder.key}: beyond the full span, still its weight`);
      for (let span = DAILY_START_TARGETS; span < ladder.fullSpan; span += 1) assert.ok(ladderPoints(ladder, span) > ladderPoints(ladder, span - 1), `${ladder.key}: one more cell should pay more`);
    }
  });

  test("the full spans score 1000, failing every first pattern scores 0, whatever the day's pick", () => {
    for (let seed = 1; seed <= 12; seed += 1) {
      const ladders = pickDailyLadders(seed);
      assert.equal(dailyResult(played(ladders, ladders.map((ladder) => ladder.fullSpan))).score, 1000, `day ${seed}`);
      assert.equal(dailyResult(played(ladders, [0, 0, 0])).score, 0);
      assert.equal(dailyResult(played(ladders, [2, 2, 2])).score, 0, "a span below the starting pattern scores 0");
      assert.equal(dailyResult(played(ladders, [DAILY_MAX_TARGETS, DAILY_MAX_TARGETS, DAILY_MAX_TARGETS])).score, 1000);
    }
  });

  test("a ladder not played at all simply scores nothing", () => {
    const [plain] = pickDailyLadders(1);
    const partial = dailyResult([{ ladder: plain, span: plain.fullSpan }]);
    assert.equal(partial.score, plain.weight);
    assert.equal(partial.metrics.ladder2Span, undefined);
  });

  test("the score never leaves 0-1000, whatever the spans", () => {
    const ladders = pickDailyLadders(3);
    for (const entry of fuzz({ first: [0, 20], second: [0, 20], third: [0, 20] }, 1000)) {
      const result = dailyResult(played(ladders, [entry.first, entry.second, entry.third]));
      assertScore(result, JSON.stringify(entry));
      assert.equal(result.metrics.bestSpan, Math.max(entry.first, entry.second, entry.third));
    }
  });

  test("a longer span never lowers the score, and the metrics report every ladder", () => {
    const ladders = pickDailyLadders(3);
    const base = dailyResult(played(ladders, [4, 4, 4])).score;
    assert.ok(dailyResult(played(ladders, [5, 4, 4])).score > base);
    assert.ok(dailyResult(played(ladders, [4, 5, 4])).score > base);
    assert.ok(dailyResult(played(ladders, [3, 4, 4])).score < base);
    const metrics = dailyResult(played(ladders, [5, 4, 3])).metrics;
    for (let index = 1; index <= 3; index += 1) { assert.ok(`ladder${index}Span` in metrics); assert.ok(`ladder${index}Points` in metrics); }
    assert.equal(metrics.ladders, ladders.map((ladder) => ladder.key).join("+"));
    assert.equal(metrics.totalCells, 12);
  });
});
