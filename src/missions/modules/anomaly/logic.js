// Anomaly scan: the logic. Pure JavaScript (no React): the two specs (three lanes, one lane), the streams of
// shapes drawn from the seed, and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

const base = {
  competence: "attention",
  secondary: [],
  task: "event",
  voice: false,
  family: "anomaly",
  recap: "spot the anomalies",
};

export const anomalySpec = {
  ...base,
  id: "anomaly",
  title: "Anomaly scan",
  load: 2,
  rule: "Three signal lines scroll slowly past. Tap the block as soon as you see a hexagon among the circles. Tapping when there is none counts as an error.",
  blocks: [{ key: "panel", role: "display", h: 2, w: 2 }],
  options: { laneCount: 3 },
};

// Same task on a single line, for when there is only half a block of room (or less load to spend).
export const anomalyLiteSpec = {
  ...base,
  id: "anomaly-lite",
  title: "Anomaly line",
  load: 1,
  rule: "A signal line scrolls slowly past. Tap the block as soon as you see a hexagon among the circles. Tapping when there is none counts as an error.",
  blocks: [{ key: "panel", role: "display", h: 1, w: 2 }],
  options: { laneCount: 1 },
};

// Seconds a shape takes to cross its lane, per lane (lanes run at slightly different speeds).
export const CROSS_S = [15, 13, 17];
export const FALSE_ALARM_COST = 0.08;

// Each lane is a stream of small circles entering from the right; a few are hexagons (the anomalies).
// `at` is when the shape enters the lane's right edge, in seconds from the start.
export function buildContent(spec, seed, { durationMs }) {
  const { laneCount } = spec.options;
  const rnd = randomTools(createRandom(seed));
  const seconds = durationMs / 1000;
  const lanes = Array.from({ length: laneCount }, (_, lane) => {
    const items = [];
    for (let at = -CROSS_S[lane]; at < seconds + 2; at += rnd.float(2.2, 3.4)) items.push({ at, anomaly: false, key: `${lane}:${items.length}` });
    return { cross: CROSS_S[lane], items };
  });
  for (let at = rnd.float(6, 9); at < seconds - 4; at += rnd.float(10, 16)) {
    const lane = lanes[rnd.int(0, laneCount - 1)];
    const item = lane.items.find((entry) => entry.at >= at);
    if (item) item.anomaly = true;
  }
  return lanes;
}

// The anomalies of a stream, each with the time its lane takes to cross.
export function anomaliesOf(lanes) {
  return lanes.flatMap((lane) => lane.items.filter((item) => item.anomaly).map((item) => ({ ...item, cross: lane.cross })));
}

// spotted: one entry per anomaly tapped, { delay (seconds after it entered), cross }; missed: anomalies that
// left the lane untouched; falseAlarms: taps with no anomaly on screen.
export function emptyStats() { return { spotted: [], missed: 0, falseAlarms: 0 }; }

// An anomaly tapped as it enters is worth 1, tapped as it leaves 0.5, missed 0; each false alarm costs
// FALSE_ALARM_COST. No anomaly measured yet scores 0.
export function moduleResult(spec, stats) {
  const spotted = stats.spotted.filter((entry) => entry && typeof entry === "object");
  const scores = [...spotted.map((entry) => Math.max(0, Math.min(1, 1 - 0.5 * ((entry.delay ?? 0) / (entry.cross || 1))))), ...Array(Math.max(0, stats.missed)).fill(0)];
  const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  return { performance: Math.max(0, Math.min(1, mean - FALSE_ALARM_COST * stats.falseAlarms)), detail: `${spotted.length}/${scores.length} anomalies spotted${stats.falseAlarms ? ` · ${stats.falseAlarms} false` : ""}` };
}

// The flight nobody watched: every anomaly that leaves its lane before the end is missed.
export function idleStats(spec, lanes, { durationMs }) {
  return { spotted: [], missed: anomaliesOf(lanes).filter((anomaly) => anomaly.at + anomaly.cross < durationMs / 1000).length, falseAlarms: 0 };
}
