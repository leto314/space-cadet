// Heading: the logic. Pure JavaScript (no React): the module's spec, the orders drawn from the seed, how an
// order resolves against the current heading, and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const headingSpec = {
  id: "heading",
  title: "Heading",
  competence: "spatial",
  secondary: [],
  task: "event",
  voice: false,
  load: 2,
  rule: "Follow the orders by turning left or right, then let go: your heading is locked after a second without touching the controls, and scored on how close it is. The dot on the compass is the beacon: some orders are given relative to it, others relative to where you are pointing.",
  recap: "follow the heading orders",
  blocks: [{ key: "compass", role: "display", h: 2, w: 2 }, { key: "control", role: "control", h: 2, w: 2, use: "frequent" }],
};

export const TURN_RATE = 70;
export const SETTLE_MS = 1100;
export const ZERO_SCORE_ERROR = 45;
export const WINDOW_MS = 18000;
export const CARDINALS = [["NORTH", 0], ["EAST", 90], ["SOUTH", 180], ["WEST", 270]];
// Orders in the stream: more than a flight can issue (one every 20 s at the slowest).
const ORDER_COUNT = 40;

export const wrap = (degrees) => ((degrees % 360) + 360) % 360;
export const gap = (a, b) => { const difference = Math.abs(wrap(a) - wrap(b)); return Math.min(difference, 360 - difference); };
export const pad = (degrees) => String(Math.round(wrap(degrees)) % 360).padStart(3, "0");

// The sequence of orders (and where the beacon sits for each) comes from the seed; only "turn X° left/right"
// depends on where the player is pointing when the order is given.
export function buildContent(spec, seed) {
  const rnd = randomTools(createRandom(seed));
  return Array.from({ length: ORDER_COUNT }, () => ({
    kind: rnd.item(["heading", "cardinal", "beacon", "offset", "offset", "turn", "turn"]),
    heading: rnd.int(1, 35) * 10,
    cardinal: rnd.item(CARDINALS),
    beacon: rnd.int(0, 71) * 5,
    offset: rnd.item([30, 60, 90, 120, 150]) * (rnd.chance(0.5) ? 1 : -1),
    turn: rnd.item([45, 90, 90, 135, 180]) * (rnd.chance(0.5) ? 1 : -1),
    pause: rnd.int(2500, 4500),
  }));
}

export function resolveOrder(order, current) {
  const side = (value) => (value > 0 ? "RIGHT" : "LEFT");
  let result;
  if (order.kind === "heading") result = { text: `FLY HEADING ${pad(order.heading)}`, target: order.heading };
  else if (order.kind === "cardinal") result = { text: `FLY ${order.cardinal[0]}`, target: order.cardinal[1] };
  else if (order.kind === "beacon") result = { text: "FLY TO THE BEACON", target: order.beacon };
  else if (order.kind === "offset") result = { text: `${Math.abs(order.offset)}° ${side(order.offset)} OF THE BEACON`, target: wrap(order.beacon + order.offset) };
  else result = { text: `TURN ${Math.abs(order.turn)}° ${side(order.turn)}`, target: wrap(current + order.turn) };
  // An order that is already (almost) satisfied is swapped for a relative turn, which never is.
  if (gap(result.target, current) < 40) result = { text: `TURN ${Math.abs(order.turn)}° ${side(order.turn)}`, target: wrap(current + order.turn) };
  return { ...result, beacon: order.beacon };
}

// outcomes: one entry per order, { error (degrees off the target when locked), timeMs }.
export function emptyStats() { return { outcomes: [] }; }

// Each order is scored on how far off the final heading is: dead on = 1, 45° or more off = 0.
export function moduleResult(spec, stats) {
  const outcomes = stats.outcomes.filter((outcome) => outcome && typeof outcome === "object");
  const count = outcomes.length;
  const mean = count ? outcomes.reduce((sum, outcome) => sum + Math.max(0, 1 - Math.abs(outcome.error ?? ZERO_SCORE_ERROR) / ZERO_SCORE_ERROR), 0) / count : 0;
  const averageError = count ? Math.round(outcomes.reduce((sum, outcome) => sum + Math.abs(outcome.error ?? 0), 0) / count) : null;
  return { performance: Math.max(0, Math.min(1, mean)), detail: `${count} orders${averageError !== null ? ` · ${averageError}° average error` : ""}` };
}

// The flight nobody steered: the heading stays at 000, every order times out and is scored on how far 000 is
// from its target, orders following one another at the real pace.
export function idleStats(spec, orders, { durationMs }) {
  const stats = emptyStats();
  let now = 3000;
  for (const order of orders) {
    if (now >= durationMs) break;
    const resolved = resolveOrder(order, 0);
    stats.outcomes.push({ error: gap(0, resolved.target), timeMs: WINDOW_MS });
    now += WINDOW_MS + order.pause;
  }
  return stats;
}
