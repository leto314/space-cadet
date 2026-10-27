// Airways: the logic. Pure JavaScript (no React, no React Native): the board, the lanes, the risk zones and their
// limits, the traffic a session spawns (from a seed), the daily progression and the scores.

import { createRandom, deriveSeed, randomTools } from "../../utils/random.js";

export const BOARD_ROWS = 24;
export const LANES_PER_GROUP = 5;
// Ten lanes in two sectors. "up" lanes enter at the bottom, "down" lanes at the top.
export const COLUMNS = [
  { id: "L1", group: "left", direction: "up", color: "blue" }, { id: "L2", group: "left", direction: "down", color: "violet" }, { id: "L3", group: "left", direction: "up", color: "blue" }, { id: "L4", group: "left", direction: "down", color: "violet" }, { id: "L5", group: "left", direction: "up", color: "blue" },
  { id: "R1", group: "right", direction: "down", color: "violet" }, { id: "R2", group: "right", direction: "up", color: "blue" }, { id: "R3", group: "right", direction: "down", color: "violet" }, { id: "R4", group: "right", direction: "up", color: "blue" }, { id: "R5", group: "right", direction: "down", color: "violet" },
];
// A sector's risk zone may hold at most MAX_IN_ZONE aircraft, of which at most MAX_BLUE_IN_ZONE blue ones.
export const MAX_IN_ZONE = 4;
export const MAX_BLUE_IN_ZONE = 2;
// The risk zones, as rectangles of cells: the left sector's is one band, the right sector's is two offset bands.
export const RISK_ZONES = { left: [{ top: 10, rows: 4, left: 0, columns: 5 }], right: [{ top: 8, rows: 3, left: 0, columns: 3 }, { top: 11, rows: 4, left: 2, columns: 3 }] };

export function stepDelay(speed) { return speed === 1 ? 900 : speed === 2 ? 720 : 570; }
export const laneIndexOf = (plane) => COLUMNS.filter((column) => column.group === plane.group).findIndex((column) => column.id === plane.columnId);

export function isInRiskZone(plane) {
  const lane = laneIndexOf(plane);
  return RISK_ZONES[plane.group].some((zone) => plane.row >= zone.top && plane.row < zone.top + zone.rows && lane >= zone.left && lane < zone.left + zone.columns);
}
// How many aircraft, and how many blue ones, sit in a sector's risk zone.
export function sectorLoad(planes, group) {
  const zonePlanes = planes.filter((plane) => plane.group === group && isInRiskZone(plane));
  return { total: zonePlanes.length, blue: zonePlanes.filter((plane) => plane.color === "blue").length };
}
// The first overloaded sector, or null.
export function findIncident(planes) {
  for (const group of ["left", "right"]) {
    const sector = sectorLoad(planes, group);
    if (sector.total > MAX_IN_ZONE) return { group, reason: "total", value: sector.total, limit: MAX_IN_ZONE };
    if (sector.blue > MAX_BLUE_IN_ZONE) return { group, reason: "blue", value: sector.blue, limit: MAX_BLUE_IN_ZONE };
  }
  return null;
}
// Every aircraft one row further along its lane; those that leave the board are gone.
export function advance(planes) {
  return planes.map((plane) => ({ ...plane, row: plane.row + (plane.direction === "up" ? -1 : 1) })).filter((plane) => plane.row >= 0 && plane.row < BOARD_ROWS);
}
// The heaviest load a sector's zone reaches over the next `ticks` ticks if nobody acts (no new traffic counted).
export const LOOKAHEAD_TICKS = 3;
export function projectedLoad(planes, group, ticks = LOOKAHEAD_TICKS) {
  let current = planes;
  let worst = sectorLoad(planes, group);
  for (let tick = 0; tick < ticks; tick += 1) { current = advance(current); const load = sectorLoad(current, group); worst = { total: Math.max(worst.total, load.total), blue: Math.max(worst.blue, load.blue) }; }
  return worst;
}
// A reroute is necessary when one of the removed aircraft's sector is within one aircraft of its limit (two
// aircraft can enter a zone on the same tick, so waiting for the limit itself is too late), at its blue limit,
// or about to be over a limit within LOOKAHEAD_TICKS (the aircraft already on their way); anything else is an
// extra action.
export const ACT_AT = MAX_IN_ZONE - 1;
export function isNecessaryAction(planes, removed) {
  return removed.some((plane) => {
    const now = sectorLoad(planes, plane.group);
    const soon = projectedLoad(planes, plane.group);
    return now.total >= ACT_AT || soon.total > MAX_IN_ZONE || (plane.color === "blue" && (now.blue >= MAX_BLUE_IN_ZONE || soon.blue > MAX_BLUE_IN_ZONE));
  });
}

// A session: its stages (a traffic pace and a duration each) and the seeded traffic. Each tick the screen calls
// spawn(planes): up to two new aircraft in lanes nobody is entering, drawn from the seed (the same draws, so
// two players of the same seed who act the same see the same traffic).
export function createSession(stages, seed) {
  const rnd = randomTools(createRandom(deriveSeed(seed, "traffic")));
  const totalSeconds = stages.reduce((sum, stage) => sum + stage.seconds, 0);
  let nextId = 1;
  const newPlane = (column) => ({ id: nextId++, columnId: column.id, group: column.group, color: column.color, direction: column.direction, row: column.direction === "up" ? BOARD_ROWS - 1 : 0 });
  return {
    stages, totalSeconds,
    stageAt(elapsedSeconds) {
      let start = 0;
      for (let index = 0; index < stages.length; index += 1) { start += stages[index].seconds; if (elapsedSeconds < start) return { index, ...stages[index] }; }
      return null;
    },
    // The opening traffic: one aircraft in three lanes.
    opening: () => [newPlane(COLUMNS[0]), newPlane(COLUMNS[3]), newPlane(COLUMNS[6])],
    spawn(planes) {
      const entering = new Set(planes.filter((plane) => plane.row === 0 || plane.row === BOARD_ROWS - 1).map((plane) => plane.columnId));
      const freeLanes = COLUMNS.filter((column) => !entering.has(column.id));
      const count = rnd.int(0, 2);
      const spawned = [];
      for (let index = 0; index < count && freeLanes.length; index += 1) { const lane = freeLanes.splice(rnd.int(0, freeLanes.length - 1), 1)[0]; spawned.push(newPlane(lane)); }
      return spawned;
    },
  };
}

// A Full Clearance session: one pace for `durationMinutes`.
export function buildSession({ speed, durationMinutes }, seed) {
  return createSession([{ speed, seconds: durationMinutes * 60 }], seed);
}

// Daily training: 90 seconds for everyone, the traffic speeding up every 30 seconds. An overload does not end the
// session: the sector is emptied, the overload counts, and the traffic resumes.
export const DAILY_STAGES = [{ speed: 1, label: "SLOW", seconds: 30 }, { speed: 2, label: "MEDIUM", seconds: 30 }, { speed: 3, label: "FAST", seconds: 30 }];
export function buildDailySession(seed) {
  return createSession(DAILY_STAGES, seed);
}

// The daily score, out of 1000: safety (600, minus 200 per overload) and efficiency (400, minus a share per
// unnecessary reroute, nothing left after EXTRA_ACTIONS_TO_ZERO of them). Efficiency only counts once at least
// one necessary reroute has been made: doing nothing is not efficient.
export const DAILY_WEIGHTS = { safety: 600, efficiency: 400 };
export const INCIDENT_COST = 200;
export const EXTRA_ACTIONS_TO_ZERO = 12;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// From the session stats: { rerouted, laneActions, bulkActions, extraActions, incidents }.
export function dailyResult(stats) {
  const safety = clamp(DAILY_WEIGHTS.safety - stats.incidents * INCIDENT_COST, 0, DAILY_WEIGHTS.safety);
  const necessaryActions = stats.laneActions + stats.bulkActions - stats.extraActions;
  const efficiency = necessaryActions > 0 ? Math.round(DAILY_WEIGHTS.efficiency * clamp(1 - stats.extraActions / EXTRA_ACTIONS_TO_ZERO, 0, 1)) : 0;
  return {
    score: clamp(safety + efficiency, 0, 1000),
    metrics: { safetyPoints: safety, efficiencyPoints: efficiency, incidents: stats.incidents, rerouted: stats.rerouted, laneActions: stats.laneActions, bulkActions: stats.bulkActions, extraActions: stats.extraActions },
    trials: null,
  };
}

// The Full Clearance summary: traffic efficiency in percent, 0 after an overload.
export function sessionSummary(stats) {
  return { efficiency: stats.incidents ? 0 : Math.max(0, 100 - stats.extraActions * 12) };
}
