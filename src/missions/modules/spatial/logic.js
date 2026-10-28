// The two small spatial modules: the logic. Pure JavaScript (no React): the specs of Rotation match and
// Opposite face, their figures and nets drawn from the seed, and the scoring. Neighbours here, not variants.

import { GLYPHS, oppositeAppearance, oppositeCells, randomShape } from "../../../games/cube-nets/logic.js";
import { createRandom, randomTools } from "../../../utils/random.js";

// ---- Rotation match --------------------------------------------------------------------------------------
// A figure is shown for 10 s, then up to three figures follow for 5 s each, every one turned by a random angle.
// Tap when it is the memorised figure (just turned); leave it when it is a different one.
export const rotationMatchSpec = {
  id: "rotation-match",
  title: "Rotation match",
  competence: "spatial",
  secondary: ["memory"],
  task: "event",
  voice: false,
  load: 2,
  rule: "A figure appears for 10 seconds (the light blinks and the phone vibrates): memorise it. Then up to three figures follow, 5 seconds each, all turned by some angle. Tap the block if it is the memorised figure, simply turned. Do nothing if it is a different one, such as its mirror image.",
  recap: "tap when the turned figure is the same",
  blocks: [{ key: "panel", role: "display", h: 2, w: 2 }],
};

export const REFERENCE_MS = 10000;
export const CANDIDATE_MS = 5000;
export const BLANK_MS = 600;
const OUTLINES = ["circle", "square", "triangle"];
export const INNER_SCALE = { circle: 1.15, square: 1, triangle: 0.68 };
const LATTICE = [-0.5, -0.25, 0, 0.25, 0.5].flatMap((x) => [-0.5, -0.25, 0, 0.25, 0.5].map((y) => [x, y])).filter(([x, y]) => Math.hypot(x, y) <= 0.62);

export const rotate = ([x, y], degrees) => { const r = (degrees * Math.PI) / 180; return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]; };
const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.07;
const mirrored = (figure) => ({ ...figure, line: figure.line.map(([x, y]) => [-x, y]), dot: [-figure.dot[0], figure.dot[1]] });
// True when `a`, turned by some angle, lands exactly on `b` (the line may be read from either end).
export function sameUpToRotation(a, b) {
  const step = a.outline === "circle" ? 1 : a.outline === "square" ? 90 : 120;
  for (let angle = 0; angle < 360; angle += step) {
    const line = a.line.map((point) => rotate(point, angle));
    const dot = rotate(a.dot, angle);
    if (!near(dot, b.dot)) continue;
    if (line.every((point, index) => near(point, b.line[index])) || line.every((point, index) => near(point, b.line[b.line.length - 1 - index]))) return true;
  }
  return false;
}
function randomFigure(rnd) {
  for (;;) {
    const points = rnd.shuffle(LATTICE).slice(0, 5);
    const line = points.slice(0, 4);
    const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(turn(line[0], line[1], line[2])) < 0.03 || Math.abs(turn(line[1], line[2], line[3])) < 0.03) continue;
    const figure = { outline: rnd.item(OUTLINES), line, dot: points[4] };
    // Its mirror image must be a genuinely different figure.
    if (!sameUpToRotation(mirrored(figure), figure)) return figure;
  }
}
// A look-alike: usually the mirror image, sometimes the same drawing with its dot or one line end moved.
function lookAlike(figure, rnd) {
  for (;;) {
    let variant;
    if (rnd.chance(0.6)) variant = mirrored(figure);
    else {
      const free = LATTICE.filter((point) => !near(point, figure.dot) && !figure.line.some((used) => near(used, point)));
      const spot = rnd.item(free);
      variant = rnd.chance(0.5) ? { ...figure, dot: spot } : { ...figure, line: [...figure.line.slice(0, 3), spot] };
    }
    if (!sameUpToRotation(variant, figure)) return variant;
  }
}
function buildRotationContent(seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const rounds = [];
  let at = rnd.int(3000, 5000);
  for (;;) {
    const count = rnd.int(2, 3);
    const length = REFERENCE_MS + count * (CANDIDATE_MS + BLANK_MS);
    if (at + length > durationMs - 1000) break;
    const figure = randomFigure(rnd);
    const candidates = Array.from({ length: count }, () => {
      const match = rnd.chance(0.5);
      return { match, angle: rnd.int(2, 22) * 15, figure: match ? figure : lookAlike(figure, rnd) };
    });
    rounds.push({ at, figure, candidates });
    at += length + rnd.int(5000, 9000);
  }
  return rounds;
}
// How many figures a flight's rounds will show, and how many of them are the memorised figure.
export const candidateCount = (rounds) => rounds.reduce((sum, round) => sum + round.candidates.length, 0);
export const matchCount = (rounds) => rounds.reduce((sum, round) => sum + round.candidates.filter((candidate) => candidate.match).length, 0);
// Matches tapped minus look-alikes tapped, over the matches the flight shows: leaving everything alone scores
// 0, tapping everything scores about 0, only telling them apart scores 1.
function rotationResult(stats) {
  const matches = Math.max(1, stats.matches);
  const performance = Math.max(0, Math.min(1, (stats.caught - stats.falseTaps) / matches));
  return { performance, detail: `${stats.caught}/${stats.matches} same figures tapped${stats.falseTaps ? ` · ${stats.falseTaps} wrong taps` : ""} · ${stats.total} judged` };
}

// ---- Opposite face ---------------------------------------------------------------------------------------
// A small cube net with one face highlighted. Two kinds of question:
// - "face": which face ends up opposite it once the cube is folded? (all characters upright, three choices)
// - "turn": the characters are turned on the net. Hold the cube with the highlighted face upright in front of
//   you, turn it around sideways: how does the opposite character look? (the right character, four orientations)
// The first puzzles are all "face"; after that the "turn" kind comes up more often than not.
export const oppositeFaceSpec = {
  id: "opposite-face",
  title: "Opposite face",
  competence: "spatial",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 2,
  rule: "A cube is shown unfolded with one face highlighted. FACE? Tap the face that ends up opposite it. TURN? The characters are turned: hold the cube with the highlighted character upright in front of you, turn the cube around sideways, and tap how the opposite character then looks. Wrong answers cost points.",
  recap: "find the opposite face",
  blocks: [{ key: "net", role: "display", h: 2, w: 2 }, { key: "answers", role: "control", h: 1, w: 4 }],
};

export const OPPOSITE_SECONDS = 15;
export const WRONG_ANSWER_COST = 0.5;
const FACE_ONLY_PUZZLES = 3;
const TURN_SHARE = 0.6;
const puzzleCount = (durationMs) => Math.ceil(durationMs / 4000) + 5;

function buildOpposite(rnd, kind) {
  const cells = randomShape(rnd.random);
  const glyphs = rnd.shuffle(Object.keys(GLYPHS)).slice(0, 6);
  const asked = rnd.int(0, 5);
  if (kind === "turn") {
    const net = { cells, faces: glyphs.map((glyph) => ({ glyph, turn: rnd.int(0, 3) })) };
    const { cell, turn } = oppositeAppearance(net, asked);
    return { kind, net, asked, answer: turn, options: rnd.shuffle([0, 1, 2, 3]).map((value) => ({ value, glyph: glyphs[cell], turn: value })) };
  }
  const answer = oppositeCells(cells)[asked];
  const others = rnd.shuffle([0, 1, 2, 3, 4, 5].filter((index) => index !== asked && index !== answer)).slice(0, 2);
  return { kind, net: { cells, faces: glyphs.map((glyph) => ({ glyph, turn: 0 })) }, asked, answer, options: rnd.shuffle([answer, ...others]).map((value) => ({ value, glyph: glyphs[value], turn: 0 })) };
}
function buildOppositeContent(seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  return Array.from({ length: puzzleCount(durationMs) }, (_, index) => buildOpposite(rnd, index >= FACE_ONLY_PUZZLES && rnd.chance(TURN_SHARE) ? "turn" : "face"));
}
function oppositeResult(stats, { durationMs }) {
  const target = Math.max(1, durationMs / 1000 / OPPOSITE_SECONDS);
  const { right, wrong } = stats;
  return { performance: Math.max(0, Math.min(1, (right - wrong * WRONG_ANSWER_COST) / target)), detail: `${right} right${wrong ? ` · ${wrong} wrong` : ""}` };
}

// ---- The shared contract ---------------------------------------------------------------------------------
const isRotation = (spec) => spec.id === rotationMatchSpec.id;
export function buildContent(spec, seed, context) {
  return isRotation(spec) ? buildRotationContent(seed, context) : buildOppositeContent(seed, context);
}
// Rotation match: memorised figures tapped, look-alikes tapped, figures judged, matches the flight shows.
// Opposite face: right and wrong answers.
export function emptyStats(spec) {
  return isRotation(spec) ? { caught: 0, falseTaps: 0, total: 0, matches: 1 } : { right: 0, wrong: 0 };
}
export function moduleResult(spec, stats, context) {
  return isRotation(spec) ? rotationResult(stats) : oppositeResult(stats, context);
}

// The flight nobody played: no figure tapped, no opposite face answered.
export function idleStats(spec, content) {
  if (!isRotation(spec)) return { right: 0, wrong: 0 };
  return { caught: 0, falseTaps: 0, total: candidateCount(content), matches: matchCount(content) };
}
