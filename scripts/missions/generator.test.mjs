// Mission generator (src/missions/generator.js + src/missions/modules/specs.js): correctness of the mission of
// the day — the same for everyone, obeying the cockpit rules, and rotating the systems over the days.
//   npm run test:missions
// The generator and the catalogue of module specs must load in plain Node: the mission of the day is decided by
// logic, not by a screen, so it is read here without React.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { planLayout } from "../../src/missions/layout.js";
import { dailySeed } from "../../src/utils/random.js";
import { assertExports, loadPure, same, SEEDS } from "./helpers.mjs";

const CORE = "src/missions/generator.js";
const CATALOGUE = "src/missions/modules/specs.js";
const TASKS = ["continuous", "event", "opportunistic"];
const COMPETENCES = ["spatial", "attention", "memory", "mentalMath", "logic", "multitasking"];
const DAY_MS = 86400000;
// A year of missions from the anchor day, as the test's sample of "what players will actually get". Built once:
// every day remembers the days of its block before it, so this is what the app computes day after day.
const dayKeys = (count, from) => Array.from({ length: count }, (_, index) => new Date(from + index * DAY_MS).toISOString().slice(0, 10));
let yearCache = null;
async function yearOfMissions() {
  if (yearCache) return yearCache;
  const { missionForDay, ROTATION } = await core();
  const from = Date.parse(`${ROTATION.anchorDay}T00:00:00Z`);
  yearCache = dayKeys(365, from).map((key) => missionForDay(key));
  return yearCache;
}

async function core() {
  const generator = await loadPure(CORE);
  assertExports(generator, ["generateMission", "missionForDay", "missionHistory", "missionProblem", "rotationProblem", "competenceShares", "briefingOrder", "missionDurations", "MISSION_LIMITS", "ROTATION", "FORMATS", "SIZE_WEIGHTS"], CORE);
  return generator;
}
async function catalogue() {
  const specs = await loadPure(CATALOGUE);
  assertExports(specs, ["SPECS"], CATALOGUE);
  return specs.SPECS;
}
const loadOf = (specs, ids) => ids.reduce((sum, id) => sum + specs[id].load, 0);
const cellsOf = (specs, ids) => ids.reduce((sum, id) => sum + specs[id].blocks.reduce((area, block) => area + block.h * block.w, 0), 0);

describe("Mission generator - the mission of the day", () => {
  test("the same day gives the same mission, run after run", async () => {
    const { generateMission, missionForDay } = await core();
    for (const seed of SEEDS) {
      const first = generateMission(seed);
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, generateMission(seed)), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
    for (const key of ["2026-10-04", "2026-10-19", "2026-11-01"]) assert.ok(same(missionForDay(key), missionForDay(key)), `${key}: the mission of the day differs from one computation to the next`);
  });

  test("different days give different missions", async () => {
    const missions = (await yearOfMissions()).slice(0, 30).map((mission) => mission.moduleIds.join("+"));
    const repeats = missions.filter((mission, index) => index > 0 && mission === missions[index - 1]);
    assert.equal(repeats.length, 0, `the same mission came two days in a row: ${repeats[0]}`);
    assert.ok(new Set(missions).size >= 25, `only ${new Set(missions).size} different missions over 30 days`);
  });

  test("every mission obeys the cockpit rules, whatever the day", async () => {
    const { missionProblem, MISSION_LIMITS } = await core();
    const specs = await catalogue();
    for (const { dayKey, moduleIds } of (await yearOfMissions()).slice(0, 120)) {
      const label = `${dayKey} (${moduleIds.join(", ")})`;
      assert.equal(missionProblem(moduleIds), null, `${label}: ${missionProblem(moduleIds)}`);
      assert.ok(moduleIds.length >= MISSION_LIMITS.minModules && moduleIds.length <= MISSION_LIMITS.maxModules, `${label}: ${moduleIds.length} modules`);
      assert.equal(new Set(moduleIds).size, moduleIds.length, `${label}: a module flies twice`);
      for (const id of moduleIds) assert.ok(specs[id], `${label}: unknown module ${id}`);
      assert.ok(loadOf(specs, moduleIds) <= MISSION_LIMITS.maxLoad, `${label}: load ${loadOf(specs, moduleIds)} is over the budget`);
      assert.ok(moduleIds.filter((id) => specs[id].voice).length <= MISSION_LIMITS.maxVoice, `${label}: too many talking modules`);
      assert.ok(moduleIds.filter((id) => specs[id].task === "continuous").length <= MISSION_LIMITS.maxContinuous, `${label}: too many continuous modules`);
      assert.ok(planLayout(moduleIds.map((id) => specs[id])), `${label}: the blocks do not fit on one board`);
    }
  });

  test("a mission is varied and well filled: as many competences as modules, few holes in the rows it uses", async () => {
    const specs = await catalogue();
    let filled = 0;
    const missions = await yearOfMissions();
    for (const { dayKey, moduleIds } of missions) {
      const competences = new Set(moduleIds.map((id) => specs[id].competence));
      assert.ok(competences.size >= Math.min(3, moduleIds.length), `${dayKey}: only ${competences.size} competences for ${moduleIds.length} modules`);
      const layout = planLayout(moduleIds.map((id) => specs[id]));
      filled += cellsOf(specs, moduleIds) / (layout.rows * 4);
    }
    assert.ok(filled / missions.length >= 0.9, `the rows a mission uses are only ${Math.round((filled / missions.length) * 100)}% filled on average`);
  });

  test("all three sizes happen: missions of 3, 4 and 5 systems, each often enough", async () => {
    const { SIZE_WEIGHTS } = await core();
    const missions = await yearOfMissions();
    const counts = {};
    for (const { moduleIds } of missions) counts[moduleIds.length] = (counts[moduleIds.length] ?? 0) + 1;
    for (const size of Object.keys(SIZE_WEIGHTS)) assert.ok((counts[size] ?? 0) >= missions.length * SIZE_WEIGHTS[size] * 0.5, `missions of ${size} systems: ${counts[size] ?? 0} days in a year, for a weight of ${SIZE_WEIGHTS[size]}`);
  });

  test("the briefing goes continuous first, then events, then the 'when you have time' systems", async () => {
    const { briefingOrder } = await core();
    const specs = await catalogue();
    for (const { dayKey, moduleIds } of (await yearOfMissions()).slice(0, 30)) {
      const ranks = moduleIds.map((id) => TASKS.indexOf(specs[id].task));
      for (let index = 1; index < ranks.length; index += 1) assert.ok(ranks[index] >= ranks[index - 1], `${dayKey}: ${moduleIds.join(", ")} is not in briefing order`);
      assert.ok(same(briefingOrder(moduleIds), moduleIds), `${dayKey}: the generated order is not the briefing order`);
    }
  });
});

describe("Mission generator - the rotation over the days", () => {
  test("a day remembers the days of its block before it, rebuilt the same way every time, and nothing earlier", async () => {
    const { missionHistory, missionForDay, ROTATION } = await core();
    assert.equal(missionHistory(ROTATION.anchorDay).length, 0, "the anchor day starts afresh");
    const anchor = Date.parse(`${ROTATION.anchorDay}T00:00:00Z`);
    const tenth = new Date(anchor + 10 * DAY_MS).toISOString().slice(0, 10);
    const history = missionHistory(tenth);
    assert.equal(history.length, 10, "ten days after the anchor, ten days are remembered");
    history.forEach((entry, index) => assert.ok(same(entry.moduleIds, missionForDay(new Date(anchor + index * DAY_MS).toISOString().slice(0, 10)).moduleIds), `the memory of day ${index} is not what that day really got`));
    const nextBlock = new Date(anchor + ROTATION.blockDays * DAY_MS).toISOString().slice(0, 10);
    assert.equal(missionHistory(nextBlock).length, 0, "the first day of a block starts afresh");
    assert.ok(missionHistory(new Date(anchor + (ROTATION.blockDays - 1) * DAY_MS).toISOString().slice(0, 10)).length === ROTATION.blockDays - 1, "the last day of a block remembers the whole block");
  });

  test("no module flies more days in a row than allowed, and never two modules together on their third day", async () => {
    const { ROTATION } = await core();
    const missions = await yearOfMissions();
    const streaks = {};
    missions.forEach(({ dayKey, moduleIds }, index) => {
      for (const id of Object.keys(streaks)) if (!moduleIds.includes(id)) streaks[id] = 0;
      for (const id of moduleIds) streaks[id] = (streaks[id] ?? 0) + 1;
      for (const id of moduleIds) assert.ok(streaks[id] <= ROTATION.maxStreak, `${dayKey}: ${id} flies for the ${streaks[id]}th day in a row`);
      if (index >= 2) {
        const third = moduleIds.filter((id) => missions[index - 1].moduleIds.includes(id) && missions[index - 2].moduleIds.includes(id));
        assert.ok(third.length <= ROTATION.maxThirdDayModules, `${dayKey}: ${third.join(" and ")} repeat together for the third day`);
      }
    });
  });

  test("every competence comes back within a few days", async () => {
    const { ROTATION } = await core();
    const specs = await catalogue();
    const missions = await yearOfMissions();
    const absent = {};
    for (const { dayKey, moduleIds } of missions) {
      const present = new Set(moduleIds.map((id) => specs[id].competence));
      for (const competence of COMPETENCES) {
        absent[competence] = present.has(competence) ? 0 : (absent[competence] ?? 0) + 1;
        assert.ok(absent[competence] <= ROTATION.competenceGapDays + 1, `${dayKey}: ${competence} has been absent for ${absent[competence]} days`);
      }
    }
  });

  test("every module flies now and then: none is forgotten over a year, none is in more than 40% of the missions", async () => {
    const specs = await catalogue();
    const missions = await yearOfMissions();
    const counts = Object.fromEntries(Object.keys(specs).map((id) => [id, 0]));
    for (const { moduleIds } of missions) for (const id of moduleIds) counts[id] += 1;
    const never = Object.entries(counts).filter(([, count]) => count < 6).map(([id, count]) => `${id} (${count})`);
    assert.equal(never.length, 0, `flown fewer than six times in a year: ${never.join(", ")}`);
    const always = Object.entries(counts).filter(([, count]) => count > missions.length * 0.4).map(([id, count]) => `${id} (${count}/${missions.length})`);
    assert.equal(always.length, 0, `flown in more than 40% of the missions: ${always.join(", ")}`);
  });

  test("the rotation rules refuse a fourth day in a row, two systems repeating together, and a forgotten competence", async () => {
    const { rotationProblem, ROTATION } = await core();
    const specs = await catalogue();
    // Histories where every competence flew (so only the rule under test can complain).
    const [a, b, c] = ["math-check", "heading", "mini-memory"];
    const everything = ["altitude", "math-check", "system-lights", "codes", "logic-gates", "heading"];
    const day = (...ids) => ({ dayKey: "x", moduleIds: ids });
    const streak = Array.from({ length: ROTATION.maxStreak }, () => day(...everything));
    assert.ok(rotationProblem([a, c], streak), `${a} should not fly a ${ROTATION.maxStreak + 1}th day in a row`);
    const twoDays = Array.from({ length: ROTATION.maxStreak - 1 }, () => day(...everything));
    assert.ok(rotationProblem([a, b], twoDays), `${a} and ${b} should not both repeat for a third day`);
    assert.equal(rotationProblem([a, c], twoDays), null, "one system on its third day is fine");
    const noLogic = Array.from({ length: ROTATION.competenceGapDays }, () => day(...everything.filter((id) => specs[id].competence !== "logic")));
    assert.ok(rotationProblem([c, "tanks"], noLogic), "logic has been absent long enough to be due");
    assert.equal(rotationProblem(["mini-switchboard", c, "tanks"], noLogic), null, "a mission that brings logic back is fine");
    assert.equal(rotationProblem([a, b, c], []), null, "the first day has no rules to break");
  });
});

describe("Mission generator - the rules it must refuse", () => {
  test("an empty mission, a module twice, two variants of the same system", async () => {
    const { missionProblem } = await core();
    const specs = await catalogue();
    assert.ok(missionProblem([]), "an empty mission should be refused");
    const [first] = Object.keys(specs);
    assert.ok(missionProblem([first, first]), "the same module twice should be refused");
    const families = {};
    for (const [id, spec] of Object.entries(specs)) { const family = spec.family ?? id; families[family] = [...(families[family] ?? []), id]; }
    const variants = Object.values(families).find((ids) => ids.length > 1);
    assert.ok(variants, "no module declares a family, so variants cannot be kept apart");
    assert.ok(missionProblem(variants.slice(0, 2)), `${variants.slice(0, 2).join(" + ")}: two variants of the same system should be refused`);
  });

  test("two talking modules, three continuous ones, a load over the budget, blocks that do not fit", async () => {
    const { missionProblem, MISSION_LIMITS } = await core();
    const specs = await catalogue();
    const pick = (test, count) => { const seen = new Set(); return Object.keys(specs).filter((id) => test(specs[id]) && !seen.has(specs[id].family ?? id) && seen.add(specs[id].family ?? id)).slice(0, count); };
    const voices = pick((spec) => spec.voice, MISSION_LIMITS.maxVoice + 1);
    assert.equal(voices.length, MISSION_LIMITS.maxVoice + 1, "not enough talking modules to test the rule");
    assert.ok(missionProblem(voices), `${voices.join(" + ")}: too many talking modules should be refused`);
    const continuous = pick((spec) => spec.task === "continuous", MISSION_LIMITS.maxContinuous + 1);
    assert.equal(continuous.length, MISSION_LIMITS.maxContinuous + 1, "not enough continuous modules to test the rule");
    assert.ok(missionProblem(continuous), `${continuous.join(" + ")}: too many continuous modules should be refused`);
    const heaviest = Object.keys(specs).sort((a, b) => specs[b].load - specs[a].load);
    const heavy = [];
    for (const id of heaviest) { if (loadOf(specs, [...heavy, id]) > MISSION_LIMITS.maxLoad) { heavy.push(id); break; } heavy.push(id); }
    assert.ok(loadOf(specs, heavy) > MISSION_LIMITS.maxLoad, "could not build a mission over the load budget");
    assert.ok(missionProblem(heavy), `${heavy.join(" + ")}: a load of ${loadOf(specs, heavy)} should be refused`);
    const biggest = Object.keys(specs).sort((a, b) => cellsOf(specs, [b]) - cellsOf(specs, [a]));
    const big = [];
    for (const id of biggest) { big.push(id); if (cellsOf(specs, big) > 32) break; }
    assert.ok(missionProblem(big), `${big.join(" + ")}: ${cellsOf(specs, big)} cells should not fit on 32`);
  });
});

describe("Mission generator - what a mission trains", () => {
  test("the competence shares add up to 1 and are sorted, the main competence of a module weighing most", async () => {
    const { competenceShares } = await core();
    const specs = await catalogue();
    for (const { dayKey, moduleIds } of (await yearOfMissions()).slice(0, 30)) {
      const shares = competenceShares(moduleIds);
      const total = shares.reduce((sum, entry) => sum + entry.share, 0);
      assert.ok(Math.abs(total - 1) < 1e-9, `${dayKey}: the shares add up to ${total}`);
      for (const { competence, share } of shares) {
        assert.ok(COMPETENCES.includes(competence), `${dayKey}: unknown competence ${competence}`);
        assert.ok(share > 0 && share <= 1, `${dayKey}: share ${share}`);
      }
      for (let index = 1; index < shares.length; index += 1) assert.ok(shares[index - 1].share >= shares[index].share, `${dayKey}: the shares are not sorted`);
      const primaries = new Set(moduleIds.map((id) => specs[id].competence));
      for (const competence of primaries) assert.ok(shares.some((entry) => entry.competence === competence), `${dayKey}: ${competence} is trained but missing from the shares`);
    }
  });

  test("a single module trains its own competence most", async () => {
    const { competenceShares } = await core();
    const specs = await catalogue();
    for (const [id, spec] of Object.entries(specs)) {
      const shares = competenceShares([id]);
      assert.equal(shares[0].competence, spec.competence, `${id}: its first share is ${shares[0].competence}, not ${spec.competence}`);
      assert.equal(shares.length, 1 + spec.secondary.length, `${id}: ${shares.length} competences for 1 + ${spec.secondary.length}`);
    }
  });
});

describe("Mission generator - the length of the flight", () => {
  test("a mission lasts longer with more systems, inside each format's range, the regular one at most six minutes", async () => {
    const { missionDurations, FORMATS, MISSION_LIMITS } = await core();
    assert.ok(FORMATS.find((format) => format.key === "regular").maxSeconds <= 360, "a regular mission should not exceed six minutes");
    for (const seed of SEEDS) {
      let previous = null;
      for (let count = MISSION_LIMITS.minModules; count <= MISSION_LIMITS.maxModules; count += 1) {
        const durations = missionDurations(seed, count);
        for (const format of FORMATS) {
          const seconds = durations[format.key] / 1000;
          assert.ok(seconds >= format.minSeconds && seconds <= format.maxSeconds, `seed ${seed}, ${count} systems: ${format.key} lasts ${seconds} s`);
          assert.equal(seconds % 5, 0, `seed ${seed}: ${seconds} s is not a round number of seconds`);
          if (previous) assert.ok(seconds >= previous[format.key] - 15, `seed ${seed}: ${count} systems get a shorter ${format.key} flight (${seconds} s) than ${count - 1} (${previous[format.key]} s)`);
        }
        previous = { short: durations.short / 1000, regular: durations.regular / 1000 };
      }
    }
    const missions = await yearOfMissions();
    const shortBySize = {};
    for (const { moduleIds, durations } of missions) { const size = moduleIds.length; shortBySize[size] = [...(shortBySize[size] ?? []), durations.short / 1000]; }
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    assert.ok(mean(shortBySize[5]) > mean(shortBySize[3]), "five systems should get a longer short flight than three, on average");
  });
});

describe("Mission generator - the archive (Mission Mode)", () => {
  test("an archive mission comes from a seed, stays in the archive range, and really is that day's mission", async () => {
    const generator = await core();
    assertExports(generator, ["archiveMission", "ARCHIVE_RANGE"], CORE);
    const { archiveMission, ARCHIVE_RANGE, missionForDay } = generator;
    const first = archiveMission(7);
    assert.ok(same(first, archiveMission(7)), "the same seed should give the same archive mission");
    const days = new Set();
    for (const seed of SEEDS) {
      const mission = archiveMission(seed);
      const time = Date.parse(`${mission.dayKey}T00:00:00Z`);
      assert.ok(time >= Date.parse(`${ARCHIVE_RANGE.from}T00:00:00Z`) && time <= Date.parse(`${ARCHIVE_RANGE.to}T00:00:00Z`), `seed ${seed}: ${mission.dayKey} is outside the archive`);
      assert.ok(time < Date.now(), `seed ${seed}: ${mission.dayKey} is in the future`);
      assert.ok(same(mission.moduleIds, missionForDay(mission.dayKey).moduleIds), `seed ${seed}: the archive mission is not that day's mission`);
      days.add(mission.dayKey);
    }
    assert.ok(days.size >= SEEDS.length - 1, `only ${days.size} different days out of ${SEEDS.length} seeds`);
  });
});
