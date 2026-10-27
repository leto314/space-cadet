// Turn Count: the logic. Pure JavaScript (no React, no React Native): routes, the daily progression and the
// daily score. Every generator takes `random` (a Math.random-like function, see utils/random.js) so the same
// seed always gives the same routes.

import { createRandom } from "../../utils/random.js";

export const CANVAS_WIDTH = 320;
export const CANVAS_HEIGHT = 330;
export const TURN_COUNT = 8;

function randomInt(random, min, max) { return Math.floor(random() * (max - min + 1)) + min; }
function normalizeAngle(angle) { return ((angle % 360) + 360) % 360; }
function getPoint(point, angle, length) { const radians = (angle * Math.PI) / 180; return { x: point.x + Math.cos(radians) * length, y: point.y + Math.sin(radians) * length }; }
function isOnCanvas(point) { const margin = 18; return point.x >= margin && point.x <= CANVAS_WIDTH - margin && point.y >= margin && point.y <= CANVAS_HEIGHT - margin; }
function segmentsCross(a, b, c, d) {
  const orientation = (first, second, third) => (second.x - first.x) * (third.y - first.y) - (second.y - first.y) * (third.x - first.x);
  const first = orientation(a, b, c); const second = orientation(a, b, d); const third = orientation(c, d, a); const fourth = orientation(c, d, b);
  return first * second < 0 && third * fourth < 0;
}
export function hasCrossing(points) { for (let index = 0; index < points.length - 1; index += 1) for (let otherIndex = index + 2; otherIndex < points.length - 1; otherIndex += 1) if (segmentsCross(points[index], points[index + 1], points[otherIndex], points[otherIndex + 1])) return true; return false; }
function fitTrajectoryToCanvas(points) {
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const width = Math.max(1, maxX - minX); const height = Math.max(1, maxY - minY);
  const scale = Math.min((CANVAS_WIDTH - 36) / width, (CANVAS_HEIGHT - 36) / height);
  const offsetX = (CANVAS_WIDTH - width * scale) / 2 - minX * scale; const offsetY = (CANVAS_HEIGHT - height * scale) / 2 - minY * scale;
  return points.map((point) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY }));
}

// A route of TURN_COUNT turns that fits the canvas: { points, turns } where turns are +1 (right) or -1 (left).
// About two thirds of the routes are required to cross themselves.
export function buildTrajectory(random) {
  for (;;) {
    const requireCrossing = random() < 0.65;
    for (let attempt = 0; attempt < 160; attempt += 1) {
      let heading = randomInt(random, 0, 359); const points = [{ x: 0, y: 0 }]; const turns = [];
      points.push(getPoint(points[0], heading, randomInt(random, 95, 150)));
      for (let turnIndex = 0; turnIndex < TURN_COUNT; turnIndex += 1) { const sign = random() < 0.5 ? -1 : 1; heading = normalizeAngle(heading + sign * randomInt(random, 15, 150)); points.push(getPoint(points[points.length - 1], heading, randomInt(random, 85, 155))); turns.push(sign); }
      if (!requireCrossing || hasCrossing(points)) { const fitted = fitTrajectoryToCanvas(points); if (fitted.every(isOnCanvas)) return { points: fitted, turns }; }
    }
  }
}

// The ready screen's illustration: one route from a seed.
export function sampleTrajectory(seed) { return buildTrajectory(createRandom(seed)); }

// One round: a direction to count ("L" or "R"), its route and the right count.
export function buildRound(random) {
  const direction = random() < 0.5 ? "L" : "R";
  const trajectory = buildTrajectory(random);
  return { direction, trajectory, correctAnswer: trajectory.turns.filter((turn) => turn === (direction === "R" ? 1 : -1)).length };
}

// A Full Clearance session: `roundCount` routes from a seed, all at the chosen pace (seconds between turns).
export function buildSession({ roundCount, turnInterval }, seed) {
  const random = createRandom(seed);
  return Array.from({ length: roundCount }, () => ({ ...buildRound(random), pace: { seconds: turnInterval, label: null } }));
}

// Daily training: five routes for everyone, one slow, two at medium pace, two fast (seconds between turns).
export const DAILY_PACES = [{ seconds: 2, label: "SLOW" }, { seconds: 1.5, label: "MEDIUM" }, { seconds: 1.5, label: "MEDIUM" }, { seconds: 0.9, label: "FAST" }, { seconds: 0.9, label: "FAST" }];
export const DAILY_POINTS_PER_ROUTE = 1000 / DAILY_PACES.length;

export function buildDailyRounds(seed) {
  const random = createRandom(seed);
  return DAILY_PACES.map((pace) => ({ ...buildRound(random), pace }));
}

// The daily result from the answers ([{ correct, answer, expected, responseTime, pace }]): a score out of
// 1000 (200 per right count), the metrics recorded, and the compact trial list.
export function dailyResult(results) {
  const correct = results.filter((result) => result.correct).length;
  const times = results.map((result) => result.responseTime);
  return {
    score: Math.round((correct / results.length) * 1000),
    metrics: { correct, routes: results.length, turnsPerRoute: TURN_COUNT, meanAnswerMs: Math.round(times.reduce((sum, value) => sum + value, 0) / times.length), offByOne: results.filter((result) => Math.abs(result.answer - result.expected) === 1).length },
    trials: results.map((result) => ({ ok: result.correct ? 1 : 0, ms: result.responseTime, answer: result.answer, expected: result.expected, pace: result.pace })),
  };
}

// The Full Clearance summary: how many right counts, as a percentage.
export function sessionSummary(results) {
  const correct = results.filter((result) => result.correct);
  return { correctCount: correct.length, accuracy: results.length ? Math.round((correct.length / results.length) * 100) : 0 };
}
