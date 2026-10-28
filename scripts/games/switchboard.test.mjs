// Switchboard (src/games/switchboard/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { createRandom } from "../../src/utils/random.js";
import { applyAction, buildDailySession, buildPanel, buildSession, DAILY_PANELS, DAILY_POINTS_PER_PANEL, dailyResult, MAX_TARGET_DEPTH, maskToLights, moveBudget, panelEntry, panelPoints, REVEAL_FACTOR, SOLVED_FLOOR, wiringVisible } from "../../src/games/switchboard/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const play = (panel, moves) => moves.reduce((mask, index) => applyAction(mask, panel.switches[index], panel.lightCount), 0);
const perfect = (panels) => panels.map((panel) => panelEntry(panel, { solved: true, moves: panel.optimal, resets: 0, timeMs: 4000 }));
const failed = (panels) => panels.map((panel) => panelEntry(panel, { solved: false, moves: moveBudget(panel).cap, resets: 2, timeMs: 30000 }));

describe("Switchboard - daily panels", () => {
  test("the same seed gives the same panels, run after run", () => {
    for (const seed of SEEDS) {
      const first = buildDailySession(seed);
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, buildDailySession(seed)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different panels", () => {
    const runs = SEEDS.map((seed) => buildDailySession(seed));
    for (let a = 0; a < runs.length; a += 1) for (let b = a + 1; b < runs.length; b += 1) assert.ok(!same(runs[a], runs[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same panels`);
  });

  test("five panels: the wiring shown then hidden, never fewer lights or switches than the panel before", () => {
    assert.equal(DAILY_PANELS.length, 5);
    const shown = DAILY_PANELS.filter((panel) => panel.showWiring).length;
    assert.ok(shown >= 1 && shown < DAILY_PANELS.length, "both wiring visibilities are played");
    for (let index = 1; index < DAILY_PANELS.length; index += 1) {
      assert.ok(!DAILY_PANELS[index].showWiring || DAILY_PANELS[index - 1].showWiring, `panel ${index + 1}: the wiring is shown again after being hidden`);
      assert.ok(DAILY_PANELS[index].lightCount >= DAILY_PANELS[index - 1].lightCount, `panel ${index + 1} has fewer lights than panel ${index}`);
    }
    for (const panel of DAILY_PANELS) assert.ok(panel.lightCount <= 5 && panel.switchCount <= 4, `${panel.lightCount} lights and ${panel.switchCount} switches: past that a hidden panel is guesswork`);
    assert.ok(DAILY_PANELS.at(-1).lightCount === 5 && DAILY_PANELS.at(-1).switchCount === 4, "the last panel uses the full 5 lights and 4 switches");
    for (const seed of [1, 42, 4242]) {
      const panels = buildDailySession(seed);
      assert.equal(panels.length, DAILY_PANELS.length, `seed ${seed}: a panel is missing`);
      panels.forEach((panel, index) => {
        assert.equal(panel.lightCount, DAILY_PANELS[index].lightCount);
        assert.equal(panel.switches.length, DAILY_PANELS[index].switchCount);
        assert.equal(panel.showWiring, DAILY_PANELS[index].showWiring);
      });
    }
  });

  test("every panel is solvable: its shortest route really lights the target, in `optimal` moves, and no shorter route exists", () => {
    for (const seed of [1, 2, 3, 42, 1234]) for (const panel of buildDailySession(seed)) {
      assert.equal(panel.solution.length, panel.optimal, `seed ${seed}: the route is not ${panel.optimal} moves long`);
      assert.equal(play(panel, panel.solution), panel.target, `seed ${seed}: the shortest route does not reach the target`);
      assert.ok(panel.optimal >= 2 && panel.optimal <= MAX_TARGET_DEPTH, `seed ${seed}: depth ${panel.optimal} is out of range`);
      assert.notEqual(panel.target, 0, `seed ${seed}: the target is the dark panel`);
      // Breadth-first over every route shorter than `optimal`: none of them may reach the target.
      let frontier = new Set([0]);
      for (let depth = 1; depth < panel.optimal; depth += 1) {
        const next = new Set();
        for (const mask of frontier) for (const action of panel.switches) next.add(applyAction(mask, action, panel.lightCount));
        assert.ok(!next.has(panel.target), `seed ${seed}: the target is reachable in ${depth} moves, not ${panel.optimal}`);
        frontier = next;
      }
    }
  });

  test("every switch does something distinct, at least one is a toggle, and every wiring stays inside the panel", () => {
    for (const seed of [1, 2, 3, 42, 1234]) for (const panel of buildDailySession(seed)) {
      assert.ok(panel.switches.some((action) => action.type === "toggle"), `seed ${seed}: no toggle switch, the panel can never light up`);
      const signatures = new Set(panel.switches.map((action) => JSON.stringify(action)));
      assert.equal(signatures.size, panel.switches.length, `seed ${seed}: two switches share a wiring`);
      for (const action of panel.switches) {
        assert.ok(["toggle", "swap", "shift", "copy"].includes(action.type), `seed ${seed}: unknown action ${action.type}`);
        for (const cell of action.cells ?? []) assert.ok(cell >= 0 && cell < panel.lightCount, `seed ${seed}: light ${cell} is off the panel`);
      }
      assert.equal(maskToLights(panel.target, panel.lightCount).length, panel.lightCount);
    }
  });

  test("the move budget: a hidden wiring is revealed after twice the shortest route, par leaves the shortest route after the reveal, the cap is past par", () => {
    for (const seed of [7, 42, 1234]) for (const panel of buildDailySession(seed)) {
      const { revealAt, par, cap } = moveBudget(panel);
      if (panel.showWiring) { assert.equal(revealAt, null); assert.equal(par, panel.optimal); assert.ok(wiringVisible(panel, 0)); }
      else {
        assert.equal(revealAt, REVEAL_FACTOR * panel.optimal);
        assert.equal(par, revealAt + panel.optimal, "reading the revealed wiring then playing the shortest route stays on budget");
        assert.ok(!wiringVisible(panel, revealAt - 1) && wiringVisible(panel, revealAt), "the wiring appears exactly at revealAt");
        assert.ok(revealAt >= panel.switches.length, "the reveal leaves at least one press per switch");
      }
      assert.ok(cap > par, "the limit leaves room beyond par");
    }
  });

  test("panels are drawn afresh from day to day", () => {
    const targets = new Set();
    for (let seed = 1; seed <= 20; seed += 1) targets.add(JSON.stringify(buildDailySession(seed)[4].switches));
    assert.ok(targets.size >= 18, `only ${targets.size} different wirings over 20 days`);
  });
});

describe("Switchboard - Full Clearance session", () => {
  test("one panel with the chosen settings, the same for the same seed", () => {
    for (const settings of [{ lightCount: 3, switchCount: 3, showWiring: true }, { lightCount: 6, switchCount: 5, showWiring: false }]) {
      const [panel] = buildSession(settings, 42);
      assert.equal(panel.lightCount, settings.lightCount);
      assert.equal(panel.switches.length, settings.switchCount);
      assert.equal(panel.showWiring, settings.showWiring);
      assert.ok(same(buildSession(settings, 42), buildSession(settings, 42)));
      assert.ok(!same(buildSession(settings, 42), buildSession(settings, 43)));
    }
  });

  test("buildPanel draws only from the generator it is given (the mission module shares one stream)", () => {
    const random = createRandom(5);
    const a = buildPanel({ lightCount: 3, switchCount: 3 }, random);
    const b = buildPanel({ lightCount: 3, switchCount: 3 }, random);
    assert.ok(!same(a, b), "two panels from one stream should differ");
    assert.ok(same(a, buildPanel({ lightCount: 3, switchCount: 3 }, createRandom(5))));
  });
});

describe("Switchboard - daily score", () => {
  test("a panel is worth 100 within par, a quarter at the cap, nothing unsolved, and never more for more moves", () => {
    for (const panel of buildDailySession(3)) {
      const { par, cap } = moveBudget(panel);
      assert.equal(panelPoints(panel, panel.optimal, true), 100);
      assert.equal(panelPoints(panel, par, true), 100);
      assert.equal(panelPoints(panel, cap, true), SOLVED_FLOOR);
      assert.equal(panelPoints(panel, cap, false), 0);
      assert.equal(panelPoints(panel, par, false), 0);
      let previous = 101;
      for (let moves = 1; moves <= cap + 5; moves += 1) { const points = panelPoints(panel, moves, true); assert.ok(points <= previous, `${moves} moves score more than ${moves - 1}`); assert.ok(points >= 0 && points <= 100); previous = points; }
    }
  });

  test("the five panels add up to 1000: every panel at par -> 1000, nothing solved -> 0", () => {
    assert.equal(Math.round(DAILY_POINTS_PER_PANEL * DAILY_PANELS.length), 1000);
    for (const seed of SEEDS) {
      const panels = buildDailySession(seed);
      assert.equal(dailyResult(perfect(panels)).score, 1000, `seed ${seed}: perfect play does not score 1000`);
      assert.equal(dailyResult(failed(panels)).score, 0, `seed ${seed}: failing everything does not score 0`);
    }
  });

  test("the score never leaves 0-1000, and the metrics report every panel", () => {
    const panels = buildDailySession(11);
    for (const draw of fuzz({ m0: [0, 40], m1: [0, 40], m2: [0, 40], m3: [0, 40], m4: [0, 40], solvedMask: [0, 31] }, 800)) {
      const entries = panels.map((panel, index) => panelEntry(panel, { solved: Boolean((draw.solvedMask >> index) & 1), moves: draw[`m${index}`], resets: index, timeMs: 1000 * (index + 1) }));
      const result = dailyResult(entries);
      assertScore(result, JSON.stringify(draw));
      assert.equal(result.metrics.panels, 5);
      assert.equal(result.trials.length, 5);
      assert.equal(result.metrics.solved, entries.filter((entry) => entry.solved).length);
      assert.equal(result.metrics.wiringsRevealed, entries.filter((entry) => !entry.showWiring && entry.moves >= entry.revealAt).length);
      assert.equal(result.metrics.shownPoints + result.metrics.hiddenPoints, entries.reduce((sum, entry) => sum + entry.points, 0));
    }
  });

  test("solving one more panel never lowers the score; extra moves never raise it", () => {
    const panels = buildDailySession(21);
    const entries = failed(panels);
    let previous = dailyResult(entries).score;
    panels.forEach((panel, index) => {
      entries[index] = panelEntry(panel, { solved: true, moves: moveBudget(panel).cap - 1, resets: 0, timeMs: 1000 });
      const score = dailyResult(entries).score;
      assert.ok(score > previous, `solving panel ${index + 1} did not raise the score`);
      previous = score;
    });
    const tight = dailyResult(perfect(panels)).score;
    const loose = dailyResult(panels.map((panel) => panelEntry(panel, { solved: true, moves: moveBudget(panel).par + 3, resets: 0, timeMs: 1000 }))).score;
    assert.ok(loose < tight, "extra moves beyond par should cost points");
  });
});
