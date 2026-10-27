// Airways (src/games/airways/logic.js): correctness of the daily version's logic.
//   node --test "scripts/games/*.test.mjs"

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { ACT_AT, advance, BOARD_ROWS, buildDailySession, buildSession, COLUMNS, DAILY_STAGES, DAILY_WEIGHTS, dailyResult, EXTRA_ACTIONS_TO_ZERO, findIncident, INCIDENT_COST, isInRiskZone, isNecessaryAction, LANES_PER_GROUP, LOOKAHEAD_TICKS, MAX_BLUE_IN_ZONE, MAX_IN_ZONE, projectedLoad, RISK_ZONES, sectorLoad, sessionSummary, stepDelay } from "../../src/games/airways/logic.js";
import { assertScore, fuzz, same, SEEDS } from "./helpers.mjs";

const TICKS = 120; // about 90 seconds of daily traffic

// Runs a session for `ticks` ticks. policy(planes) returns the planes left after the player's actions (and
// records what it did). Without a policy nobody acts; an overload empties the sector like the daily game does.
function simulate(seed, ticks, policy = null) {
  const session = buildDailySession(seed);
  let planes = session.opening();
  const log = { incidents: 0, spawns: [], actions: 0, extras: 0 };
  for (let tick = 0; tick < ticks; tick += 1) {
    planes = advance(planes);
    const spawned = session.spawn(planes);
    log.spawns.push(spawned.map((plane) => plane.columnId));
    planes.push(...spawned);
    const incident = findIncident(planes);
    if (incident) { log.incidents += 1; planes = planes.filter((plane) => plane.group !== incident.group); }
    if (policy) planes = policy(planes, log);
  }
  return { planes, log };
}
// A careful player: whenever a reroute counts as necessary, clears the lane of the aircraft nearest the zone
// (a blue one when the blue limit is the problem), and again until nothing is necessary any more.
const ticksToZone = (plane) => { let current = plane; for (let tick = 0; tick <= 12; tick += 1) { if (isInRiskZone(current)) return tick; current = { ...current, row: current.row + (current.direction === "up" ? -1 : 1) }; } return 99; };
function carefulPolicy(planes, log) {
  for (const group of ["left", "right"]) for (let round = 0; round < 6; round += 1) {
    const threatened = planes.filter((plane) => plane.group === group && isNecessaryAction(planes, [plane])).sort((a, b) => ticksToZone(a) - ticksToZone(b));
    if (!threatened.length) break;
    const blueProblem = sectorLoad(planes, group).blue >= MAX_BLUE_IN_ZONE || projectedLoad(planes, group).blue > MAX_BLUE_IN_ZONE;
    const pick = (blueProblem && threatened.find((plane) => plane.color === "blue")) || threatened[0];
    const removed = planes.filter((plane) => plane.columnId === pick.columnId);
    log.actions += 1; log.extras += isNecessaryAction(planes, removed) ? 0 : 1;
    planes = planes.filter((plane) => plane.columnId !== pick.columnId);
  }
  return planes;
}
const plane = (columnId, row, id = 0) => { const column = COLUMNS.find((entry) => entry.id === columnId); return { id, columnId, group: column.group, color: column.color, direction: column.direction, row }; };
const stats = (overrides = {}) => ({ rerouted: 0, laneActions: 0, bulkActions: 0, extraActions: 0, incidents: 0, ...overrides });

describe("Airways - board", () => {
  test("ten lanes, five per sector, alternating colours and directions", () => {
    assert.equal(COLUMNS.length, 2 * LANES_PER_GROUP);
    for (const group of ["left", "right"]) assert.equal(COLUMNS.filter((column) => column.group === group).length, LANES_PER_GROUP);
    for (const column of COLUMNS) assert.equal(column.color, column.direction === "up" ? "blue" : "violet", `${column.id}: blue aircraft climb, violet ones descend`);
  });

  test("risk zones match the cells the screen shades", () => {
    for (const group of ["left", "right"]) for (const zone of RISK_ZONES[group]) for (let row = zone.top; row < zone.top + zone.rows; row += 1) for (let lane = zone.left; lane < zone.left + zone.columns; lane += 1) {
      const column = COLUMNS.filter((entry) => entry.group === group)[lane];
      assert.ok(isInRiskZone(plane(column.id, row)), `${column.id} row ${row} should be in the ${group} zone`);
    }
    assert.ok(!isInRiskZone(plane("L1", 0)) && !isInRiskZone(plane("L1", 9)) && !isInRiskZone(plane("L1", 14)), "rows outside the left band are not in the zone");
    assert.ok(!isInRiskZone(plane("R5", 8)) && isInRiskZone(plane("R5", 11)), "the right zone is offset lane by lane");
  });

  test("advance moves every aircraft one row along its lane and drops those leaving the board", () => {
    const next = advance([plane("L1", 5, 1), plane("L2", 5, 2), plane("L1", 0, 3), plane("L2", BOARD_ROWS - 1, 4)]);
    assert.deepEqual(next.map((entry) => [entry.id, entry.row]), [[1, 4], [2, 6]]);
  });

  test("an overload is declared exactly past the limits", () => {
    const atLimit = Array.from({ length: MAX_IN_ZONE }, (_, index) => plane(index % 2 ? "L2" : "L4", 10 + index, index));
    assert.equal(findIncident(atLimit), null, `${MAX_IN_ZONE} violet aircraft in the zone is allowed`);
    assert.deepEqual(findIncident([...atLimit, plane("L2", 13, 99)]), { group: "left", reason: "total", value: MAX_IN_ZONE + 1, limit: MAX_IN_ZONE });
    const blues = Array.from({ length: MAX_BLUE_IN_ZONE + 1 }, (_, index) => plane("L1", 10 + index, index));
    assert.deepEqual(findIncident(blues), { group: "left", reason: "blue", value: MAX_BLUE_IN_ZONE + 1, limit: MAX_BLUE_IN_ZONE });
    assert.equal(findIncident(blues.slice(1)), null);
  });

  test("a reroute is necessary one aircraft below the limit, or at the blue limit", () => {
    const two = [plane("L2", 10, 1), plane("L4", 11, 2)];
    assert.equal(isNecessaryAction(two, [two[0]]), false, "two aircraft: rerouting is an extra action");
    const three = [...two, plane("L2", 12, 3)];
    assert.equal(isNecessaryAction(three, [three[0]]), true, `${ACT_AT} aircraft: rerouting is necessary`);
    const twoBlue = [plane("L1", 10, 1), plane("L3", 11, 2)];
    assert.equal(isNecessaryAction(twoBlue, [twoBlue[0]]), true, "two blue aircraft: rerouting a blue one is necessary");
    assert.equal(isNecessaryAction(twoBlue, [plane("R1", 5, 9)]), false, "rerouting an aircraft of a quiet sector is an extra action");
  });

  test("a reroute is also necessary when the aircraft already on their way would overload the zone soon", () => {
    // Two violet aircraft in the zone, three more entering it over the next ticks (two of them together).
    const incoming = [plane("L2", 10, 1), plane("L4", 11, 2), plane("L2", 9, 3), plane("L4", 9, 4), plane("L2", 8, 5)];
    assert.equal(sectorLoad(incoming, "left").total, 2);
    assert.ok(projectedLoad(incoming, "left", LOOKAHEAD_TICKS).total > MAX_IN_ZONE, "the projection sees the overload coming");
    assert.equal(isNecessaryAction(incoming, [incoming[2]]), true, "rerouting an incoming aircraft is necessary");
    const farAway = [plane("L2", 10, 1), plane("L4", 11, 2), plane("L2", 2, 3), plane("L4", 1, 4), plane("L2", 0, 5)];
    assert.equal(isNecessaryAction(farAway, [farAway[2]]), false, "the same traffic far from the zone: not yet");
  });
});

describe("Airways - daily session traffic", () => {
  test("the same seed gives the same traffic, run after run", () => {
    for (const seed of SEEDS) {
      const first = simulate(seed, TICKS).log.spawns;
      for (let run = 0; run < 3; run += 1) assert.ok(same(first, simulate(seed, TICKS).log.spawns), `seed ${seed}: run ${run + 2} differs from run 1`);
    }
  });

  test("different seeds give different traffic", () => {
    const runs = SEEDS.map((seed) => simulate(seed, TICKS).log.spawns);
    for (let a = 0; a < runs.length; a += 1) for (let b = a + 1; b < runs.length; b += 1) assert.ok(!same(runs[a], runs[b]), `seeds ${SEEDS[a]} and ${SEEDS[b]} give the same traffic`);
  });

  test("spawns: at most two per tick, never in a lane someone is entering, at the lane's entry row, unique ids", () => {
    const session = buildDailySession(11);
    let planes = session.opening();
    const ids = new Set(planes.map((plane) => plane.id));
    let counts = [0, 0, 0];
    for (let tick = 0; tick < 300; tick += 1) {
      planes = advance(planes);
      const entering = new Set(planes.filter((plane) => plane.row === 0 || plane.row === BOARD_ROWS - 1).map((plane) => plane.columnId));
      const spawned = session.spawn(planes);
      assert.ok(spawned.length <= 2, `tick ${tick}: ${spawned.length} aircraft spawned`);
      counts[spawned.length] += 1;
      for (const entry of spawned) {
        assert.ok(!entering.has(entry.columnId), `tick ${tick}: spawned in lane ${entry.columnId} while an aircraft is entering it`);
        assert.equal(entry.row, entry.direction === "up" ? BOARD_ROWS - 1 : 0, `tick ${tick}: wrong entry row`);
        assert.ok(!ids.has(entry.id), `tick ${tick}: id ${entry.id} reused`); ids.add(entry.id);
      }
      assert.equal(new Set(spawned.map((entry) => entry.columnId)).size, spawned.length, `tick ${tick}: two aircraft spawned in the same lane`);
      planes.push(...spawned);
      planes = planes.filter((entry) => !isInRiskZone(entry) || Math.random() > 0.5); // keep the board from overloading forever
    }
    assert.ok(counts.every((count) => count > 20), `spawn counts 0/1/2 per tick: ${counts}, expected all three to occur`);
  });

  test("the traffic demands action: nobody acting gets overloads, a careful player none", () => {
    for (const seed of SEEDS) {
      assert.ok(simulate(seed, TICKS).log.incidents >= 1, `seed ${seed}: no overload without any action`);
      const careful = simulate(seed, TICKS, carefulPolicy).log;
      assert.equal(careful.incidents, 0, `seed ${seed}: the careful player got ${careful.incidents} overloads`);
      assert.equal(careful.extras, 0, `seed ${seed}: the careful player's actions counted as extras`);
    }
  });
});

describe("Airways - daily progression", () => {
  test("three stages of thirty seconds, slow then medium then fast, ninety seconds in all", () => {
    const session = buildDailySession(1);
    assert.equal(session.totalSeconds, 90);
    assert.deepEqual(DAILY_STAGES.map((stage) => stage.speed), [1, 2, 3]);
    assert.deepEqual(DAILY_STAGES.map((stage) => stage.seconds), [30, 30, 30]);
    for (let second = 0; second < 90; second += 1) assert.equal(session.stageAt(second).speed, second < 30 ? 1 : second < 60 ? 2 : 3, `second ${second}`);
    assert.equal(session.stageAt(90), null);
    assert.ok(stepDelay(1) > stepDelay(2) && stepDelay(2) > stepDelay(3), "faster pace, shorter tick");
  });

  test("a Full Clearance session has one stage for the chosen duration", () => {
    const session = buildSession({ speed: 2, durationMinutes: 3 }, 5);
    assert.equal(session.totalSeconds, 180);
    assert.equal(session.stageAt(179).speed, 2);
    assert.equal(session.stageAt(180), null);
  });
});

describe("Airways - daily score", () => {
  test("the weights add up to 1000", () => {
    assert.equal(Object.values(DAILY_WEIGHTS).reduce((sum, value) => sum + value, 0), 1000);
  });

  test("a clean session scores 1000, an idle one 0", () => {
    assert.equal(dailyResult(stats({ rerouted: 20, laneActions: 9, bulkActions: 1 })).score, 1000);
    assert.equal(dailyResult(stats({ incidents: 5 })).score, 0, "no action and overloads: 0");
    assert.equal(dailyResult(stats()).score, DAILY_WEIGHTS.safety, "no action and, somehow, no overload: the safety part only (efficiency needs a necessary reroute)");
  });

  test("each overload costs its share, each extra reroute its twelfth", () => {
    const clean = dailyResult(stats({ laneActions: 10 })).score;
    assert.equal(clean - dailyResult(stats({ laneActions: 10, incidents: 1 })).score, INCIDENT_COST);
    assert.equal(dailyResult(stats({ laneActions: 10, incidents: 3 })).score, clean - DAILY_WEIGHTS.safety, "three overloads use up the safety part");
    assert.equal(dailyResult(stats({ laneActions: 10, incidents: 9 })).score, clean - DAILY_WEIGHTS.safety, "safety never goes negative");
    const oneExtra = dailyResult(stats({ laneActions: 11, extraActions: 1 })).score;
    assert.equal(clean - oneExtra, Math.round(DAILY_WEIGHTS.efficiency / EXTRA_ACTIONS_TO_ZERO));
    assert.equal(dailyResult(stats({ laneActions: 10 + EXTRA_ACTIONS_TO_ZERO, extraActions: EXTRA_ACTIONS_TO_ZERO })).score, DAILY_WEIGHTS.safety, "twelve extras use up the efficiency part");
  });

  test("the score never leaves 0-1000, whatever the stats", () => {
    for (const entry of fuzz({ rerouted: [0, 200], laneActions: [0, 100], bulkActions: [0, 50], extraActions: [0, 150], incidents: [0, 30] }, 2000)) {
      const result = dailyResult(entry);
      assertScore(result, JSON.stringify(entry));
      assert.ok(result.metrics.safetyPoints <= DAILY_WEIGHTS.safety && result.metrics.efficiencyPoints <= DAILY_WEIGHTS.efficiency);
    }
  });

  test("the Full Clearance summary: efficiency in percent, 0 after an overload", () => {
    assert.deepEqual(sessionSummary(stats({ extraActions: 2 })), { efficiency: 76 });
    assert.deepEqual(sessionSummary(stats({ incidents: 1 })), { efficiency: 0 });
    assert.deepEqual(sessionSummary(stats({ extraActions: 20 })), { efficiency: 0 });
  });
});
