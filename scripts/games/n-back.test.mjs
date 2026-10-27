// N-back (src/games/n-back/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ALPHANUMERIC_POOL, buildBlock, buildDailyBlocks, buildSequence, channelShare, countTargets, DAILY_BLOCKS, DAILY_HARD_VARIANTS, dailyMinimumTargets, dailyResult, difficultyOf, getChannelSummary, GRID_POSITIONS, TOTAL_TRIALS } from "../../src/games/n-back/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const evaluatedOf = (block) => block.trials - block.nValue;
const targetsOf = (block, channel) => countTargets(channel === "audio" ? block.audio : block.visual, block.nValue);
// Stats for the three blocks from a player who catches `hitShare` of the matches and taps `falseShare` of the rest.
function play(seed, hitShare, falseShare = 0) {
  return buildDailyBlocks(seed).map((block) => {
    const channels = {};
    for (const channel of block.config.channels) {
      const targets = targetsOf(block, channel);
      channels[channel] = { hits: Math.round(targets * hitShare), falseAlarms: Math.round((evaluatedOf(block) - targets) * falseShare), targets };
    }
    return { key: block.key, weight: block.weight, channels, evaluatedTrials: evaluatedOf(block) };
  });
}

describe("N-back - daily blocks", () => {
  test("the same seed gives the same blocks, run after run", () => {
    for (const seed of SEEDS) {
      const first = buildDailyBlocks(seed);
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, buildDailyBlocks(seed)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different blocks", () => {
    const runs = SEEDS.map((seed) => buildDailyBlocks(seed));
    for (let a = 0; a < runs.length; a += 1) for (let b = a + 1; b < runs.length; b += 1) assert.ok(!same(runs[a], runs[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same blocks`);
  });

  test("three blocks: characters 2-back (20), positions 2-back (25), then the day's hard block (25) - weights adding to 1000", () => {
    assert.deepEqual(DAILY_BLOCKS.map((block) => block.key), ["audio", "visual", "hard"]);
    assert.equal(DAILY_BLOCKS.reduce((sum, block) => sum + block.weight, 0), 1000);
    const blocks = buildDailyBlocks(1);
    assert.deepEqual(blocks.slice(0, 2).map((block) => [block.config.channels, block.nValue, block.trials]), [[["audio"], 2, 20], [["visual"], 2, 25]]);
    assert.equal(blocks[2].trials, 25);
    assert.equal(blocks[2].weight, 400);
    for (const block of blocks) {
      for (const channel of block.config.channels) assert.equal((channel === "audio" ? block.audio : block.visual).length, block.trials, `${block.key}: ${channel} stream of the wrong length`);
      for (const channel of ["audio", "visual"]) if (!block.config.channels.includes(channel)) assert.equal((channel === "audio" ? block.audio : block.visual).length, 0, `${block.key}: ${channel} stream built although the block does not play it`);
    }
  });

  test("the hard block is one of three variants, and all three come up over the days", () => {
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed += 1) {
      const hard = buildDailyBlocks(seed)[2];
      const variant = DAILY_HARD_VARIANTS.find((entry) => entry.key === hard.key);
      assert.ok(variant, `day ${seed}: unknown hard block "${hard.key}"`);
      assert.equal(hard.nValue, variant.nValue);
      assert.ok(hard.nValue === 3 || hard.config.channels.length === 2, `day ${seed}: the hard block is neither 3-back nor two streams`);
      seen.add(hard.key);
    }
    assert.equal(seen.size, DAILY_HARD_VARIANTS.length, `only ${[...seen]} came up in 60 days`);
  });

  test("the pace: two streams at once leave more time between items than one", () => {
    const blocks = buildDailyBlocks(1);
    assert.equal(blocks[0].intervalMs, difficultyOf("easy").trialIntervalMs);
    assert.ok(difficultyOf("hard").trialIntervalMs > difficultyOf("medium").trialIntervalMs, "the hard preset should be slower");
    for (let seed = 1; seed <= 30; seed += 1) { const hard = buildDailyBlocks(seed)[2]; assert.ok(hard.intervalMs > blocks[0].intervalMs, `day ${seed}: the hard block (${hard.key}) is not slower than the first`); }
  });

  test("every stream plants its matches: the block's minimum to two more, about a third of the trials", () => {
    for (const seed of SEEDS) for (const block of buildDailyBlocks(seed)) for (const channel of block.config.channels) {
      const targets = targetsOf(block, channel);
      const minimum = dailyMinimumTargets(block.trials, block.nValue);
      assert.ok(targets >= minimum && targets <= minimum + 2, `seed ${seed}, ${block.key}/${channel}: ${targets} matches, expected ${minimum} to ${minimum + 2}`);
      assert.ok(targets / evaluatedOf(block) < 0.5, `seed ${seed}, ${block.key}/${channel}: more than half the trials are matches`);
      assert.ok(targets / evaluatedOf(block) > 0.2, `seed ${seed}, ${block.key}/${channel}: fewer than a fifth of the trials are matches`);
    }
  });

  test("items come from the right pool and a non-match never repeats the item N steps back", () => {
    for (const block of buildDailyBlocks(3)) {
      for (const item of block.audio) assert.ok(ALPHANUMERIC_POOL.includes(item), "an audio item is not from the pool");
      for (const position of block.visual) assert.ok(GRID_POSITIONS.includes(position), "a position is not on the grid");
      // Every repeat at distance N is a planted match; countTargets is therefore the only definition of a match.
      for (const channel of block.config.channels) {
        const stream = channel === "audio" ? block.audio : block.visual;
        const repeats = stream.filter((item, index) => index >= block.nValue && item === stream[index - block.nValue]).length;
        assert.equal(repeats, countTargets(stream, block.nValue), `${block.key}/${channel}: countTargets disagrees with the stream`);
      }
    }
  });

  test("a Full Clearance block follows its settings and is reproducible", () => {
    const block = buildBlock({ difficulty: "hard", nValue: 3 }, 11);
    assert.equal(block.audio.length, TOTAL_TRIALS);
    assert.equal(block.visual.length, TOTAL_TRIALS);
    assert.equal(block.nValue, 3);
    assert.ok(same(block, buildBlock({ difficulty: "hard", nValue: 3 }, 11)));
    assert.ok(!same(block, buildBlock({ difficulty: "hard", nValue: 3 }, 12)));
    assert.equal(buildBlock({ difficulty: "easy", nValue: 1 }, 11).visual.length, 0, "the easy preset has no position stream");
    assert.ok(countTargets(buildSequence(GRID_POSITIONS, 30, 2, 10, () => 0.5), 2) >= 10);
    assert.equal(difficultyOf("medium").channels[0], "visual");
  });
});

describe("N-back - daily score", () => {
  test("a channel's share is corrected for guessing: tapping everything, or nothing, earns nothing", () => {
    assert.equal(channelShare({ hits: 8, falseAlarms: 0, targets: 8, evaluatedTrials: 18 }), 1);
    assert.equal(channelShare({ hits: 0, falseAlarms: 0, targets: 8, evaluatedTrials: 18 }), 0);
    assert.equal(channelShare({ hits: 8, falseAlarms: 10, targets: 8, evaluatedTrials: 18 }), 0, "tapping every trial: every match caught, every non-match a false alarm");
    assert.equal(channelShare({ hits: 4, falseAlarms: 0, targets: 8, evaluatedTrials: 18 }), 0.5);
    assert.ok(channelShare({ hits: 8, falseAlarms: 2, targets: 8, evaluatedTrials: 18 }) < 1, "false alarms cost");
  });

  test("everything caught scores 1000, nothing scores 0, tapping every trial scores 0", () => {
    assert.equal(dailyResult(play(1, 1)).score, 1000);
    assert.equal(dailyResult(play(1, 0)).score, 0);
    assert.equal(dailyResult(play(1, 1, 1)).score, 0);
    const half = dailyResult(play(1, 0.5));
    assert.ok(half.score > 400 && half.score < 600, `half the matches caught scores ${half.score}`);
  });

  test("each block is worth its weight, a two-stream block averages its two channels", () => {
    const onlyFirst = dailyResult([{ key: "audio", weight: 300, channels: { audio: { hits: 8, falseAlarms: 0, targets: 8 } }, evaluatedTrials: 18 }]);
    assert.equal(onlyFirst.score, 300);
    const dualHalf = dailyResult([{ key: "dual", weight: 400, channels: { audio: { hits: 8, falseAlarms: 0, targets: 8 }, visual: { hits: 0, falseAlarms: 0, targets: 8 } }, evaluatedTrials: 23 }]);
    assert.equal(dualHalf.score, 200, "one channel perfect, the other blank: half the block");
  });

  test("the score never leaves 0-1000, whatever the play", () => {
    for (const entry of fuzz({ hits: [0, 25], falseAlarms: [0, 25], targets: [0, 23] }, 1500)) {
      const blocks = buildDailyBlocks(1).map((block) => ({ key: block.key, weight: block.weight, channels: Object.fromEntries(block.config.channels.map((channel) => [channel, { hits: Math.min(entry.hits, entry.targets), falseAlarms: entry.falseAlarms, targets: entry.targets }])), evaluatedTrials: evaluatedOf(block) }));
      assertScore(dailyResult(blocks), JSON.stringify(entry));
    }
  });

  test("catching more matches never lowers the score, more false alarms never raise it", () => {
    const base = dailyResult(play(2, 0.6)).score;
    assert.ok(dailyResult(play(2, 0.8)).score > base, "more matches caught should score more");
    assert.ok(dailyResult(play(2, 0.6, 0.2)).score < base, "false alarms should cost");
  });

  test("the Full Clearance channel summary counts correct rejections", () => {
    const summary = getChannelSummary({ hits: 8, misses: 2, falseAlarms: 1, targets: 10, reactionTimes: [500, 700], evaluatedTrials: 28 });
    assert.equal(summary.accuracy, Math.round(((8 + (28 - 10 - 1)) / 28) * 100));
    assert.equal(summary.average, 600);
    assert.equal(getChannelSummary({ hits: 0, misses: 0, falseAlarms: 0, targets: 0, reactionTimes: [], evaluatedTrials: 0 }).average, null);
  });
});
