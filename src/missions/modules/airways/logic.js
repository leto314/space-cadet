// Airways (mission module): the logic. Pure JavaScript (no React): the module's spec, the traffic drawn from
// the seed, the board simulation (also used to judge whether a clear was needed), and the scoring.

import { createRandom } from "../../../utils/random.js";

export const airwaysSpec = {
  id: "airways",
  title: "Airways",
  competence: "multitasking",
  secondary: ["attention"],
  task: "event",
  voice: false,
  load: 3,
  rule: "Blue aircraft climb, violet ones descend, one cell at a time. Each side has a grey zone: it may never hold more than 2 aircraft, nor more than 1 blue. Each button clears every aircraft of its colour, on both sides. Clear only when a zone is about to break a rule.",
  recap: "keep the grey zones within limits",
  blocks: [{ key: "board", role: "display", h: 4, w: 2 }, { key: "controls", role: "control", h: 1, w: 2 }],
};

// Four lanes, two per side: blue aircraft climb (bottom → top), violet ones descend. Everything advances one cell
// per step. Each side has a grey zone three cells tall: the left one near the middle, the right one higher.
export const ROWS = 12;
export const STEP_MS = 1600;
export const LANES = [
  { side: 0, color: "blue" }, { side: 0, color: "violet" },
  { side: 1, color: "blue" }, { side: 1, color: "violet" },
];
export const ZONES = [{ from: 5, to: 7 }, { from: 2, to: 4 }];
// Inside one zone: at most 2 aircraft, and at most 1 blue.
export const ZONE_LIMIT = 2;
export const BLUE_LIMIT = 1;
const LOOKAHEAD_STEPS = 2;
// Left alone, the traffic breaches a zone about 4–5 times a minute: 3 breaches per minute already scores 0.
export const BREACHES_PER_MINUTE_TO_ZERO = 3;
export const NEEDLESS_CLEAR_COST = 0.04;

export const onBoard = (plane) => plane.row >= 0 && plane.row < ROWS;
export function move(planes) {
  return planes.map((plane) => ({ ...plane, row: plane.row + (plane.color === "blue" ? -1 : 1), entering: false }));
}
export function advance(planes) { return move(planes).filter(onBoard); }
export function inZone(plane, zoneIndex) {
  const zone = ZONES[zoneIndex];
  return LANES[plane.lane].side === zoneIndex && plane.row >= zone.from && plane.row <= zone.to;
}
export function zoneBreaches(planes) {
  return ZONES.map((_, index) => {
    const inside = planes.filter((plane) => inZone(plane, index));
    const blue = inside.filter((plane) => plane.color === "blue").length;
    return inside.length > ZONE_LIMIT || blue > BLUE_LIMIT;
  });
}
// A clear was needed if, without it (and without new arrivals), a zone would break the rules within the next two
// steps, and removing that colour prevents it.
export function clearWasNeeded(planes, color) {
  let without = planes;
  let withClear = planes.filter((plane) => plane.color !== color);
  for (let step = 0; step < LOOKAHEAD_STEPS; step += 1) {
    without = advance(without);
    withClear = advance(withClear);
    const before = zoneBreaches(without);
    const after = zoneBreaches(withClear);
    if (before.some((breach, index) => breach && !after[index])) return true;
  }
  return false;
}

// The traffic of the whole flight: for every step, the lanes a new aircraft enters from (at most two a step).
// Traffic gets a little denser as the mission goes on.
export function buildContent(spec, seed, { durationMs }) {
  const random = createRandom(seed);
  const steps = Math.ceil(durationMs / STEP_MS) + 2;
  return Array.from({ length: steps }, (_, step) => {
    const chance = 0.15 + Math.min(1, (step * STEP_MS) / durationMs) * 0.08;
    const lanes = [];
    LANES.forEach((_, index) => { if (lanes.length < 2 && random() < chance) lanes.push(index); });
    return lanes;
  });
}

// The aircraft entering at a step, ready to join the board.
export function arrivals(content, step, nextId) {
  return (content[step] ?? []).map((lane, offset) => ({ id: nextId + offset, lane, color: LANES[lane].color, row: LANES[lane].color === "blue" ? ROWS - 1 : 0, entering: true }));
}

export function emptyStats() { return { incidents: 0, clears: 0, needless: 0 }; }

// Starts at 1; each breach costs its share of the budget (BREACHES_PER_MINUTE_TO_ZERO per minute of flight),
// each clear that was not needed costs NEEDLESS_CLEAR_COST.
export function moduleResult(spec, stats, { durationMs }) {
  const { incidents, clears, needless } = stats;
  const breachBudget = Math.max(1, (durationMs / 60000) * BREACHES_PER_MINUTE_TO_ZERO);
  return { performance: Math.max(0, Math.min(1, 1 - incidents / breachBudget - needless * NEEDLESS_CLEAR_COST)), detail: `${incidents} zone breach${incidents === 1 ? "" : "es"} · ${clears} clears${needless ? ` (${needless} not needed)` : ""}` };
}

// The flight nobody controlled: the traffic runs on its own, every breach diverts the zone (as on screen) and
// counts as an incident.
export function idleStats(spec, traffic, { durationMs }) {
  const stats = emptyStats();
  let planes = [];
  let nextId = 1;
  const steps = Math.floor(durationMs / STEP_MS);
  for (let step = 1; step <= steps; step += 1) {
    planes = [...advance(planes), ...arrivals(traffic, step, nextId)];
    nextId += 4;
    zoneBreaches(planes).forEach((breach, index) => {
      if (!breach) return;
      stats.incidents += 1;
      planes = planes.filter((plane) => !inZone(plane, index));
    });
  }
  return stats;
}
