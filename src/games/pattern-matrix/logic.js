// Pattern Matrix: the logic. Pure JavaScript (no React, no React Native): the matrices and their answer
// options, the daily progression and the results. Every generator takes `random` (a Math.random-like function,
// see utils/random.js) so the same seed always gives the same matrices.

import { createRandom, deriveSeed } from "../../utils/random.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Adapted from the RAVEN grammar (Zhang et al., CVPR 2019): each panel is a layout of entities whose shape,
// size and fill (and, in grids, count or positions) follow one rule per attribute along every row: constant,
// progression, distribute-three or arithmetic. Answer sets follow I-RAVEN (Hu et al., AAAI 2021): options are
// the cross product of a few single-attribute changes, so every attribute value appears equally often and
// "pick the most common option" never works.
export const SHAPES = ["triangle", "square", "pentagon", "hexagon", "circle"];
export const FILLS = ["outline", "dots", "hatch", "crosshatch", "solid"];
export const SIZE_SCALES = [0.42, 0.6, 0.78, 0.96];
const GRID2_RING = [0, 1, 3, 2];
const VARYING_COUNT = { easy: 1, medium: 2, hard: 3 };
const GENERATION_ATTEMPTS = 400;
export const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

const grid3Slots = [18, 50, 82].flatMap((y) => [18, 50, 82].map((x) => [x, y, 13]));
export const LAYOUTS = {
  center: [{ kind: "single", slots: [[50, 50, 40]] }],
  leftRight: [{ kind: "single", slots: [[27, 50, 21]] }, { kind: "single", slots: [[73, 50, 21]] }],
  upDown: [{ kind: "single", slots: [[50, 27, 21]] }, { kind: "single", slots: [[50, 73, 21]] }],
  outIn: [{ kind: "single", role: "outer", slots: [[50, 50, 44]] }, { kind: "single", role: "inner", slots: [[50, 50, 17]] }],
  grid2: [{ kind: "grid", slots: [[27, 27, 19], [73, 27, 19], [27, 73, 19], [73, 73, 19]] }],
  grid3: [{ kind: "grid", slots: grid3Slots }],
};
const LAYOUTS_BY_LEVEL = {
  easy: ["center", "center", "leftRight", "grid2"],
  medium: ["center", "leftRight", "upDown", "outIn", "grid2"],
  hard: ["center", "leftRight", "upDown", "outIn", "grid2", "grid3"],
};

function domainsFor(layoutKey, spec) {
  if (spec.role === "outer") return { shape: [1, 2, 3, 4], size: [3], fill: [0] };
  if (layoutKey === "grid3") return { shape: range(0, 4), size: [2, 3], fill: [0, 2, 4] };
  if (layoutKey === "grid2") return { shape: range(0, 4), size: [1, 2, 3], fill: range(0, 4) };
  return { shape: range(0, 4), size: range(0, 3), fill: range(0, 4) };
}

function makeRandomTools(random) {
  const int = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const item = (items) => items[Math.floor(random() * items.length)];
  const shuffle = (items) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) { const swapIndex = Math.floor(random() * (index + 1)); [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]; }
    return copy;
  };
  const weighted = (entries) => {
    let roll = random() * entries.reduce((sum, entry) => sum + entry.weight, 0);
    for (const entry of entries) { roll -= entry.weight; if (roll < 0) return entry; }
    return entries.at(-1);
  };
  return { int, item, shuffle, weighted };
}

const bitCount = (mask) => { let count = 0; for (let value = mask; value; value >>= 1) count += value & 1; return count; };
function randomMask(size, slotCount, rnd) { return rnd.shuffle(range(0, slotCount - 1)).slice(0, size).reduce((mask, slot) => mask | (1 << slot), 0); }
function ringShift(mask, direction) {
  let next = 0;
  GRID2_RING.forEach((slot, index) => { if (mask & (1 << slot)) next |= 1 << GRID2_RING[(index + direction + 4) % 4]; });
  return next;
}

// 3×3 table of values for one attribute. `domain` lists the allowed values in order.
function scalarRows(rule, domain, level, rnd) {
  const size = domain.length;
  if (rule === "constant") {
    const whole = level === "easy" ? rnd.item(domain) : null;
    return range(0, 2).map(() => { const value = whole ?? rnd.item(domain); return [value, value, value]; });
  }
  if (rule === "progression") {
    const steps = [1, -1, ...(level === "hard" ? [2, -2] : [])].filter((step) => Math.abs(step) * 2 <= size - 1);
    if (!steps.length) return null;
    const step = rnd.item(steps);
    return range(0, 2).map(() => {
      const start = step > 0 ? rnd.int(0, size - 1 - 2 * step) : rnd.int(-2 * step, size - 1);
      return [0, 1, 2].map((column) => domain[start + column * step]);
    });
  }
  if (size < 3) return null;
  const values = rnd.shuffle(domain).slice(0, 3);
  const direction = rnd.item([1, 2]);
  return range(0, 2).map((row) => [0, 1, 2].map((column) => values[(column + row * direction) % 3]));
}

// Grid layouts carry a count rule (entity positions are then free) or a position rule (exact slots matter).
function layoutRows(varying, level, layoutKey, slotCount, rnd) {
  const counts = range(1, slotCount);
  let modes = ["count-constant", "pos-constant"];
  if (varying) {
    modes = level === "easy" ? ["count-progression"] : ["count-progression", "count-distribute", "pos-distribute"];
    if (level !== "easy" && layoutKey === "grid2") modes.push("pos-progression");
    if (level === "hard") modes.push("count-arithmetic", "pos-union", "pos-xor");
  }
  const mode = rnd.item(modes);
  const maxSubset = layoutKey === "grid3" ? 5 : 2;
  const cell = (mask) => ({ mask, count: bitCount(mask) });
  if (mode.startsWith("count")) {
    let values;
    if (mode === "count-arithmetic") {
      const plus = rnd.int(0, 1) === 1;
      values = range(0, 2).map(() => {
        if (plus) { const a = rnd.int(1, slotCount - 2); const b = rnd.int(1, slotCount - 1 - a); return [a, b, a + b]; }
        const a = rnd.int(3, slotCount); const b = rnd.int(1, a - 1); return [a, b, a - b];
      });
    } else values = scalarRows(mode === "count-constant" ? "constant" : mode.replace("count-", ""), mode === "count-constant" ? range(1, slotCount - 1) : counts, level, rnd);
    if (!values) return null;
    return { mode, rows: values.map((row) => row.map((count) => ({ count, mask: randomMask(count, slotCount, rnd) }))) };
  }
  if (mode === "pos-constant") return { mode, rows: range(0, 2).map(() => { const mask = randomMask(rnd.int(1, slotCount - 1), slotCount, rnd); return [cell(mask), cell(mask), cell(mask)]; }) };
  if (mode === "pos-progression") {
    const direction = rnd.item([1, -1]);
    return { mode, rows: range(0, 2).map(() => { const start = randomMask(rnd.int(1, 2), 4, rnd); return [start, ringShift(start, direction), ringShift(start, 2 * direction)].map(cell); }) };
  }
  if (mode === "pos-distribute") {
    const size = rnd.int(layoutKey === "grid3" ? 2 : 1, layoutKey === "grid3" ? 5 : 2);
    const masks = new Set();
    while (masks.size < 3) masks.add(randomMask(size, slotCount, rnd));
    const values = [...masks];
    const direction = rnd.item([1, 2]);
    return { mode, rows: range(0, 2).map((row) => [0, 1, 2].map((column) => cell(values[(column + row * direction) % 3]))) };
  }
  const rows = [];
  for (let row = 0; row < 3; row += 1) {
    let found = null;
    for (let tries = 0; tries < 40 && !found; tries += 1) {
      const a = randomMask(rnd.int(1, maxSubset), slotCount, rnd);
      const b = randomMask(rnd.int(1, maxSubset), slotCount, rnd);
      const c = mode === "pos-union" ? a | b : a ^ b;
      if (a !== b && c && c !== a && c !== b) found = [a, b, c].map(cell);
    }
    if (!found) return null;
    rows.push(found);
  }
  return { mode, rows };
}

// Every rule we know that fits rows 1-2 (and the start of row 3) — the answer is fair only if they all agree.
function scalarPredictions([r1, r2, r3], arithmetic) {
  const predictions = new Set();
  const flat = (row) => row[0] === row[1] && row[1] === row[2];
  if (flat(r1) && flat(r2) && r3[0] === r3[1]) predictions.add(r3[0]);
  const step = r1[1] - r1[0];
  if (step && r1[2] - r1[1] === step && r2[1] - r2[0] === step && r2[2] - r2[1] === step && r3[1] - r3[0] === step) predictions.add(r3[1] + step);
  const set = new Set(r1);
  if (set.size === 3 && r2.every((value) => set.has(value)) && new Set(r2).size === 3 && r3[0] !== r3[1] && set.has(r3[0]) && set.has(r3[1])) predictions.add([...set].find((value) => value !== r3[0] && value !== r3[1]));
  if (arithmetic) {
    if (r1[2] === r1[0] + r1[1] && r2[2] === r2[0] + r2[1]) predictions.add(r3[0] + r3[1]);
    if (r1[2] === r1[0] - r1[1] && r2[2] === r2[0] - r2[1]) predictions.add(r3[0] - r3[1]);
  }
  return predictions;
}
function maskPredictions([r1, r2, r3], ring) {
  const predictions = new Set();
  const flat = (row) => row[0] === row[1] && row[1] === row[2];
  if (flat(r1) && flat(r2) && r3[0] === r3[1]) predictions.add(r3[0]);
  const set = new Set(r1);
  if (set.size === 3 && new Set(r2).size === 3 && r2.every((value) => set.has(value)) && r3[0] !== r3[1] && set.has(r3[0]) && set.has(r3[1])) predictions.add([...set].find((value) => value !== r3[0] && value !== r3[1]));
  if (r1[2] === (r1[0] | r1[1]) && r2[2] === (r2[0] | r2[1])) predictions.add(r3[0] | r3[1]);
  if (r1[2] === (r1[0] ^ r1[1]) && r2[2] === (r2[0] ^ r2[1])) predictions.add(r3[0] ^ r3[1]);
  if (ring) [1, -1].forEach((direction) => {
    const fits = (row) => row[1] === ringShift(row[0], direction) && row[2] === ringShift(row[1], direction);
    if (fits(r1) && fits(r2) && r3[1] === ringShift(r3[0], direction)) predictions.add(ringShift(r3[1], direction));
  });
  return predictions;
}

function readRows(matrix, componentIndex, key) { return matrix.map((row) => row.map((panel) => panel.components[componentIndex][key])); }

function panelSignature(panel, factors) {
  return JSON.stringify(panel.components.map((component, index) => {
    const layoutFactor = factors.find((factor) => factor.ci === index && factor.attr === "layout");
    return [component.shape, component.size, component.fill, layoutFactor ? (layoutFactor.mode.startsWith("count") ? component.count : component.mask) : null];
  }));
}

function alternativeValues(factor, matrix, answer, count, rnd) {
  const component = answer.components[factor.ci];
  if (factor.attr === "layout" && !factor.mode.startsWith("count")) {
    const free = range(0, factor.slotCount - 1).filter((slot) => !(component.mask & (1 << slot)));
    const used = range(0, factor.slotCount - 1).filter((slot) => component.mask & (1 << slot));
    const moves = new Set();
    used.forEach((from) => free.forEach((to) => moves.add((component.mask & ~(1 << from)) | (1 << to))));
    // Only same-count moves: a distractor with a different number of entities would make the answer's count the
    // majority among the options, which gives it away without reading the matrix.
    [matrix[2][0], matrix[2][1], matrix[0][2], matrix[1][2]].forEach((panel) => { const mask = panel.components[factor.ci].mask; if (mask !== component.mask && bitCount(mask) === component.count) moves.add(mask); });
    const pool = rnd.shuffle([...moves]);
    return pool.length >= count ? pool.slice(0, count).map((mask) => ({ mask, count: bitCount(mask) })) : null;
  }
  const key = factor.attr === "layout" ? "count" : factor.attr;
  const domain = factor.attr === "layout" ? range(1, factor.slotCount) : factor.domain;
  const truth = component[key];
  const nearby = new Set([matrix[2][0], matrix[2][1], matrix[0][2], matrix[1][2]].map((panel) => panel.components[factor.ci][key]));
  const pool = domain.filter((value) => value !== truth).map((value) => ({ value, weight: 1 + (nearby.has(value) ? 3 : 0) + (Math.abs(value - truth) === 1 ? 2 : 0) }));
  if (pool.length < count) return null;
  const chosen = [];
  while (chosen.length < count) { const pick = rnd.weighted(pool.filter((entry) => !chosen.includes(entry.value))); chosen.push(pick.value); }
  return chosen.map((value) => (factor.attr === "layout" ? { count: value } : { [key]: value }));
}

function applyChange(panel, factor, change, rnd) {
  const next = { components: panel.components.map((component) => ({ ...component })) };
  const component = next.components[factor.ci];
  Object.assign(component, change);
  if (factor.attr === "layout" && change.mask === undefined) component.mask = randomMask(change.count, factor.slotCount, rnd);
  return next;
}

// One matrix at a level ("easy" | "medium" | "hard") with 4 or 6 answer options, from a seeded generator.
export function buildPuzzle(level, optionCount, random) {
  const rnd = makeRandomTools(random);
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const layoutKey = rnd.item(LAYOUTS_BY_LEVEL[level]);
    const specs = LAYOUTS[layoutKey];
    const factors = [];
    specs.forEach((spec, ci) => {
      const domains = domainsFor(layoutKey, spec);
      ["shape", "size", "fill"].forEach((attr) => factors.push({ ci, attr, domain: domains[attr] }));
      if (spec.kind === "grid") factors.push({ ci, attr: "layout", slotCount: spec.slots.length });
    });
    const canVary = factors.filter((factor) => factor.attr === "layout" || factor.domain.length >= 3);
    const varyingCount = Math.min(VARYING_COUNT[level], canVary.length);
    let varying = rnd.shuffle(canVary).slice(0, varyingCount);
    const gridFactor = canVary.find((factor) => factor.attr === "layout");
    if (gridFactor && !varying.includes(gridFactor) && rnd.int(0, 9) < 8) varying = [gridFactor, ...varying.slice(0, varyingCount - 1)];

    const matrix = range(0, 2).map(() => range(0, 2).map(() => ({ components: specs.map(() => ({})) })));
    let valid = true;
    for (const factor of factors) {
      factor.varying = varying.includes(factor);
      if (factor.attr === "layout") {
        const result = layoutRows(factor.varying, level, layoutKey, factor.slotCount, rnd);
        if (!result) { valid = false; break; }
        factor.mode = result.mode;
        result.rows.forEach((row, r) => row.forEach((value, c) => Object.assign(matrix[r][c].components[factor.ci], value)));
      } else {
        const rows = scalarRows(factor.varying ? rnd.item(["progression", "distribute"]) : "constant", factor.domain, level, rnd);
        if (!rows) { valid = false; break; }
        rows.forEach((row, r) => row.forEach((value, c) => { matrix[r][c].components[factor.ci][factor.attr] = value; }));
      }
    }
    if (!valid) continue;

    const determined = factors.filter((factor) => factor.attr === "layout" || factor.domain.length > 1);
    const fair = determined.every((factor) => {
      if (factor.attr !== "layout") return scalarPredictions(readRows(matrix, factor.ci, factor.attr), false).size === 1;
      const masks = readRows(matrix, factor.ci, "mask");
      if (factor.mode.startsWith("count")) return scalarPredictions(readRows(matrix, factor.ci, "count"), true).size === 1 && maskPredictions(masks, false).size === 0;
      return maskPredictions(masks, factor.slotCount === 4).size === 1;
    });
    if (!fair) continue;

    const answer = matrix[2][2];
    const ordered = [...rnd.shuffle(determined.filter((factor) => factor.varying)), ...rnd.shuffle(determined.filter((factor) => !factor.varying))];
    const primaryAlternatives = optionCount === 6 ? 2 : 1;
    const primary = ordered.find((factor) => alternativeValues(factor, matrix, answer, primaryAlternatives, rnd));
    const secondary = ordered.find((factor) => factor !== primary && alternativeValues(factor, matrix, answer, 1, rnd));
    if (!primary || !secondary) continue;
    const primaryChanges = [null, ...alternativeValues(primary, matrix, answer, primaryAlternatives, rnd)];
    const secondaryChanges = [null, ...alternativeValues(secondary, matrix, answer, 1, rnd)];
    const options = primaryChanges.flatMap((first) => secondaryChanges.map((second) => {
      let panel = answer;
      if (first) panel = applyChange(panel, primary, first, rnd);
      if (second) panel = applyChange(panel, secondary, second, rnd);
      return panel;
    }));
    if (new Set(options.map((panel) => panelSignature(panel, factors))).size !== options.length) continue;
    const shuffled = rnd.shuffle(options);
    return { level, layoutKey, panels: matrix.flat().slice(0, 8), answer, options: shuffled, answerIndex: shuffled.indexOf(answer) };
  }
  return null;
}

export function levelForIndex(difficulty, index, total) {
  if (difficulty !== "progressive") return difficulty;
  const progress = total <= 1 ? 1 : index / (total - 1);
  return progress < 1 / 3 ? "easy" : progress < 2 / 3 ? "medium" : "hard";
}

function puzzleFromSeed(level, optionCount, seed, index) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const puzzle = buildPuzzle(level, optionCount, createRandom(deriveSeed(seed, `matrix-${index}:${attempt}`)));
    if (puzzle) return { ...puzzle, optionCount };
  }
  return null;
}

// A Full Clearance session from a seed: `puzzleCount` matrices with `optionCount` options at the chosen
// difficulty ("progressive" goes easy to hard).
export function buildSession({ puzzleCount, optionCount, difficulty }, seed) {
  return Array.from({ length: puzzleCount }, (_, index) => puzzleFromSeed(levelForIndex(difficulty, index, puzzleCount), optionCount, seed, index)).filter(Boolean);
}

// Daily training: eight matrices for everyone, easy to hard: three easy with four options, three medium (four
// options, then six), two hard with six options. 125 points per right answer.
export const DAILY_MATRICES = [
  { level: "easy", optionCount: 4 }, { level: "easy", optionCount: 4 }, { level: "easy", optionCount: 4 },
  { level: "medium", optionCount: 4 }, { level: "medium", optionCount: 6 }, { level: "medium", optionCount: 6 },
  { level: "hard", optionCount: 6 }, { level: "hard", optionCount: 6 },
];
export const DAILY_POINTS_PER_MATRIX = 1000 / DAILY_MATRICES.length;
export function buildDailySession(seed) {
  return DAILY_MATRICES.map(({ level, optionCount }, index) => puzzleFromSeed(level, optionCount, seed, index)).filter(Boolean);
}

// The daily result from the answers ([{ correct, timeMs, level, layout, optionCount }]): a score out of 1000
// (125 per right answer), the metrics recorded, and the compact trial list.
export function dailyResult(entries) {
  const correct = entries.filter((entry) => entry.correct);
  const correctAt = (level) => correct.filter((entry) => entry.level === level).length;
  return {
    score: clamp(Math.round((correct.length / entries.length) * 1000), 0, 1000),
    metrics: {
      correct: correct.length, matrices: entries.length,
      easyCorrect: correctAt("easy"), mediumCorrect: correctAt("medium"), hardCorrect: correctAt("hard"),
      meanAnswerMs: entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.timeMs, 0) / entries.length) : 0,
    },
    trials: entries.map((entry) => ({ ok: entry.correct ? 1 : 0, ms: entry.timeMs, level: entry.level, layout: entry.layout, options: entry.optionCount })),
  };
}
