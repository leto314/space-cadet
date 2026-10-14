import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import Svg, { Circle, Defs, Path, Pattern, Polygon } from "react-native-svg";

import { ChoiceButton, ChoiceRow, GameSetupShell, PickerSetting, SettingCard } from "../../components/GameSetupShell";
import { PulsingPrompt } from "../../components/PulsingPrompt";
import { useMissionTransition } from "../../hooks/useMissionTransition";
import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";

const ACCENT = SPACE_CADET.logic;
const SUCCESS = "#34D399";
const ERROR = SPACE_CADET.attention;
const INK = SPACE_CADET.white;
const CORRECT_PAUSE_MS = 1100;
const WRONG_PAUSE_MS = 2400;
const MATRIX_GAP = 8;
const LEVEL_LABELS = { easy: "EASY", medium: "MEDIUM", hard: "HARD" };

// ---- Puzzle generator (pure, no React) -----------------------------------------------------------------
// Adapted from the RAVEN grammar (Zhang et al., CVPR 2019): each panel is a layout of entities whose shape,
// size and fill (and, in grids, count or positions) follow one rule per attribute along every row: constant,
// progression, distribute-three or arithmetic. Answer sets follow I-RAVEN (Hu et al., AAAI 2021): options are
// the cross product of a few single-attribute changes, so every attribute value appears equally often and
// "pick the most common option" never works.
const SHAPES = ["triangle", "square", "pentagon", "hexagon", "circle"];
const FILLS = ["outline", "dots", "hatch", "crosshatch", "solid"];
const SIZE_SCALES = [0.42, 0.6, 0.78, 0.96];
const GRID2_RING = [0, 1, 3, 2];
const VARYING_COUNT = { easy: 1, medium: 2, hard: 3 };
const GENERATION_ATTEMPTS = 400;
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

const grid3Slots = [18, 50, 82].flatMap((y) => [18, 50, 82].map((x) => [x, y, 13]));
const LAYOUTS = {
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

// `random` is injectable for the seeded daily challenge.
export function buildPuzzle(level, optionCount, random = Math.random) {
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
// ---------------------------------------------------------------------------------------------------------

let patternIdCounter = 0;
function usePatternId() {
  const ref = useRef(null);
  if (!ref.current) { patternIdCounter += 1; ref.current = `pm${patternIdCounter}`; }
  return ref.current;
}

function polygonPoints(sides, cx, cy, radius, startDegrees) {
  return range(0, sides - 1).map((index) => {
    const angle = ((startDegrees + (360 / sides) * index) * Math.PI) / 180;
    return `${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  }).join(" ");
}

// Each shape is nudged so they read as the same visual size (a square's corners reach further than a circle).
function Entity({ shape, fill, cx, cy, radius, strokeWidth, patternId }) {
  const paint = FILLS[fill] === "outline" ? "none" : FILLS[fill] === "solid" ? INK : `url(#${patternId}-${FILLS[fill]})`;
  const common = { fill: paint, stroke: INK, strokeWidth, strokeLinejoin: "round" };
  const name = SHAPES[shape];
  if (name === "circle") return <Circle cx={cx} cy={cy} r={radius * 0.9} {...common} />;
  if (name === "triangle") return <Polygon points={polygonPoints(3, cx, cy + radius * 0.16, radius * 1.04, -90)} {...common} />;
  if (name === "square") return <Polygon points={polygonPoints(4, cx, cy, radius * 1.1, -45)} {...common} />;
  if (name === "pentagon") return <Polygon points={polygonPoints(5, cx, cy + radius * 0.05, radius, -90)} {...common} />;
  return <Polygon points={polygonPoints(6, cx, cy, radius, 0)} {...common} />;
}

function PanelArt({ panel, layoutKey, size }) {
  const patternId = usePatternId();
  const specs = LAYOUTS[layoutKey];
  return <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs>
      <Pattern id={`${patternId}-dots`} patternUnits="userSpaceOnUse" width="5" height="5"><Circle cx="2.5" cy="2.5" r="0.95" fill={INK} /></Pattern>
      <Pattern id={`${patternId}-hatch`} patternUnits="userSpaceOnUse" width="5" height="5"><Path d="M-1,1 l2,-2 M0,5 l5,-5 M4,6 l2,-2" stroke={INK} strokeWidth="0.9" /></Pattern>
      <Pattern id={`${patternId}-crosshatch`} patternUnits="userSpaceOnUse" width="5" height="5"><Path d="M-1,1 l2,-2 M0,5 l5,-5 M4,6 l2,-2 M-1,4 l2,2 M0,0 l5,5 M4,-1 l2,2" stroke={INK} strokeWidth="0.75" /></Pattern>
    </Defs>
    {panel.components.map((component, ci) => {
      const spec = specs[ci];
      const slots = spec.kind === "grid" ? range(0, spec.slots.length - 1).filter((slot) => component.mask & (1 << slot)) : [0];
      return slots.map((slot) => {
        const [cx, cy, half] = spec.slots[slot];
        return <Entity key={`${ci}-${slot}`} shape={component.shape} fill={component.fill} cx={cx} cy={cy} radius={half * SIZE_SCALES[component.size]} strokeWidth={half >= 30 ? 1.7 : 1.3} patternId={patternId} />;
      });
    })}
  </Svg>;
}

function MatrixBoard({ puzzle, size, reveal }) {
  const cell = (size - MATRIX_GAP * 2) / 3;
  return <View style={[styles.matrix, { width: size, height: size, gap: MATRIX_GAP }]}>
    {[...puzzle.panels, null].map((panel, index) => panel
      ? <View key={index} style={[styles.matrixCell, { width: cell, height: cell }]}><PanelArt panel={panel} layoutKey={puzzle.layoutKey} size={cell} /></View>
      : <View key={index} style={[styles.matrixCell, styles.missingCell, reveal && styles.missingRevealed, { width: cell, height: cell }]}>
        {reveal ? <PanelArt panel={puzzle.answer} layoutKey={puzzle.layoutKey} size={cell} /> : <Text style={styles.missingMark}>?</Text>}
      </View>)}
  </View>;
}

function formatSeconds(ms) { return (ms / 1000).toFixed(1); }

export function PatternMatrixGame({ onExit }) {
  const [puzzleCount, setPuzzleCount] = useState(5);
  const [optionCount, setOptionCount] = useState(4);
  const [difficulty, setDifficulty] = useState("medium");
  const [phase, setPhase] = useState("preflight");
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [results, setResults] = useState([]);
  const phaseRef = useRef("preflight");
  const settingsRef = useRef(null);
  const puzzlesRef = useRef([]);
  const resultsRef = useRef([]);
  const sessionStartedAt = useRef(0);
  const puzzleStartedAt = useRef(0);
  const intervalRef = useRef(null);
  const timeouts = useRef([]);
  const { width, height } = useWindowDimensions();
  const { isReturning, missionStyle, preflightStyle, startMission, returnToPreflight } = useMissionTransition({ onPrepareReturn: clearTimers, onReturnComplete: resetToPreflight });

  useEffect(() => () => clearTimers(), []);
  function clearTimers() { clearInterval(intervalRef.current); intervalRef.current = null; timeouts.current.forEach(clearTimeout); timeouts.current = []; }
  function goTo(nextPhase) { phaseRef.current = nextPhase; setPhase(nextPhase); }
  function resetToPreflight() { clearTimers(); puzzlesRef.current = []; setResults([]); goTo("preflight"); }
  function resetToReady() { clearTimers(); resultsRef.current = []; setResults([]); setIndex(0); setSelected(null); setElapsed(0); goTo("ready"); }
  function prepareRun() { settingsRef.current = { puzzleCount, optionCount, difficulty }; startMission(resetToReady); }
  function showPuzzle(nextIndex) { setIndex(nextIndex); setSelected(null); puzzleStartedAt.current = Date.now(); goTo("question"); }
  function beginRun() {
    void triggerSelectionHaptic();
    const { puzzleCount: total, optionCount: options, difficulty: mode } = settingsRef.current;
    puzzlesRef.current = range(0, total - 1).map((position) => buildPuzzle(levelForIndex(mode, position, total), options)).filter(Boolean);
    sessionStartedAt.current = Date.now();
    intervalRef.current = setInterval(() => setElapsed(Date.now() - sessionStartedAt.current), 100);
    showPuzzle(0);
  }
  function answer(optionIndex) {
    if (phaseRef.current !== "question") return;
    const puzzle = puzzlesRef.current[index];
    const correct = optionIndex === puzzle.answerIndex;
    resultsRef.current = [...resultsRef.current, { correct, timeMs: Date.now() - puzzleStartedAt.current, level: puzzle.level, layout: puzzle.layoutKey }];
    setResults(resultsRef.current); setSelected(optionIndex); goTo("feedback");
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    timeouts.current.push(setTimeout(() => {
      if (index + 1 < puzzlesRef.current.length) showPuzzle(index + 1);
      else { clearInterval(intervalRef.current); intervalRef.current = null; goTo("summary"); }
    }, correct ? CORRECT_PAUSE_MS : WRONG_PAUSE_MS));
  }

  const preflight = <GameSetupShell title="Pattern Matrix" categoryKey="logic" onExit={onExit} onStart={prepareRun} rules="Tests abstract reasoning. Along each row of the matrix, shapes, sizes, fills, counts or positions change according to hidden rules. Work out the rules and pick the panel that completes the matrix.Easy: A single attribute changes along each row.Medium: Two rules at once, with split and nested layouts.Hard: Three rules at once, including additions and overlays. Progressive starts easy and ends hard.">
    <PickerSetting label="Matrices" hint="Number of matrices in the session" options={[3, 5, 8].map((value) => ({ value, label: String(value) }))} value={puzzleCount} onChange={setPuzzleCount} />
    <SettingCard label="Options" hint="Answer panels to choose from">
      <ChoiceRow>{[4, 6].map((value) => <ChoiceButton key={value} label={String(value)} selected={optionCount === value} accent={ACCENT} onPress={() => setOptionCount(value)} />)}</ChoiceRow>
    </SettingCard>
    <PickerSetting label="Difficulty" hint={difficulty === "progressive" ? "Starts easy, ends hard" : undefined} options={["easy", "medium", "hard", "progressive"].map((value) => ({ value, label: value.toUpperCase() }))} value={difficulty} onChange={setDifficulty} />
  </GameSetupShell>;

  const settings = settingsRef.current ?? { puzzleCount, optionCount, difficulty };
  const puzzle = puzzlesRef.current[index];
  const inPuzzle = (phase === "question" || phase === "feedback") && puzzle;
  const lastResult = results.at(-1);
  const correctCount = results.filter((entry) => entry.correct).length;
  const correctTimes = results.filter((entry) => entry.correct).map((entry) => entry.timeMs);
  const optionColumns = puzzle?.options.length === 6 ? 3 : 4;
  // Six options take two rows, so the matrix gives up some height to keep everything on screen (down to an iPhone SE).
  const matrixSize = Math.min(width - 40, 340, height * (optionColumns === 3 ? 0.37 : 0.42));
  const optionSize = (matrixSize - MATRIX_GAP * (optionColumns - 1)) / optionColumns;
  const levelBreakdown = ["easy", "medium", "hard"].map((level) => ({ level, entries: results.filter((entry) => entry.level === level) })).filter((group) => group.entries.length);

  return <View style={styles.container}>
    {phase === "preflight" || isReturning ? <Animated.View style={[styles.preflightLayer, isReturning && preflightStyle]}>{preflight}</Animated.View> : null}
    {phase !== "preflight" ? <Animated.View pointerEvents={isReturning ? "none" : "auto"} style={[styles.missionLayer, missionStyle]}>
      <View style={styles.header}><Pressable onPress={returnToPreflight} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}><Text style={styles.backArrow}>←</Text></Pressable></View>

      {phase === "ready" ? <Pressable onPress={beginRun} style={styles.readyScreen}>
        <Text style={styles.kicker}>LOGIC</Text>
        <Text style={styles.readyTitle}>Ready to find the pattern?</Text>
        <Text style={styles.readyText}>Each row follows hidden rules. Pick the panel that completes the matrix.</Text>
        <View style={styles.cueCard}>
          <Text style={styles.cueLabel}>{settings.puzzleCount} MATRICES · {settings.optionCount} OPTIONS</Text>
          <Text style={styles.cueText}>{settings.difficulty === "progressive" ? "Difficulty rises from easy to hard." : `${LEVEL_LABELS[settings.difficulty]} difficulty`}</Text>
        </View>
        <PulsingPrompt color={ACCENT} style={styles.beginPrompt}>TAP ANYWHERE TO BEGIN</PulsingPrompt>
      </Pressable> : null}

      {inPuzzle ? <Animated.View key={index} entering={FadeIn.duration(180)} style={styles.playScreen}>
        <View style={styles.statusRow}>
          <View><Text style={styles.statusLabel}>MATRIX</Text><Text style={styles.statusValue}>{index + 1}<Text style={styles.statusTotal}> / {puzzlesRef.current.length}</Text></Text></View>
          <View style={styles.statusRight}><Text style={styles.statusLabel}>TIME</Text><Text style={styles.statusValue}>{formatSeconds(elapsed)}</Text></View>
        </View>
        <View style={styles.board}>
          {settings.difficulty === "progressive" ? <Text style={styles.levelTag}>{LEVEL_LABELS[puzzle.level]}</Text> : null}
          <MatrixBoard puzzle={puzzle} size={matrixSize} reveal={phase === "feedback"} />
          <Text style={[styles.sectionLabel, phase === "feedback" && { color: lastResult?.correct ? SUCCESS : ERROR }]}>{phase === "feedback" ? (lastResult?.correct ? "CORRECT" : "NOT QUITE") : "SELECT THE MISSING PANEL"}</Text>
          <View style={[styles.optionGrid, { width: matrixSize, gap: MATRIX_GAP }]}>
            {puzzle.options.map((option, optionIndex) => {
              const state = phase !== "feedback" ? null : optionIndex === puzzle.answerIndex ? "correct" : optionIndex === selected ? "wrong" : null;
              return <Pressable key={optionIndex} disabled={phase !== "question"} onPress={() => answer(optionIndex)} style={({ pressed }) => [styles.option, { width: optionSize, height: optionSize }, pressed && styles.optionPressed, state === "correct" && styles.optionCorrect, state === "wrong" && styles.optionWrong]}>
                <PanelArt panel={option} layoutKey={puzzle.layoutKey} size={optionSize - 2} />
              </Pressable>;
            })}
          </View>
        </View>
      </Animated.View> : null}

      {phase === "summary" ? <Animated.View entering={FadeIn.duration(180)} style={styles.summaryScreen}>
        <Text style={styles.kicker}>SESSION ENDED</Text>
        <Text style={styles.summaryTitle}>Matrices complete</Text>
        <Text style={styles.summaryScore}>{correctCount}<Text style={styles.summaryScoreTotal}> / {results.length}</Text></Text>
        <Text style={styles.summaryCaption}>correct answers</Text>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>{settings.difficulty.toUpperCase()} · {settings.optionCount} OPTIONS</Text>
          <Text style={styles.statLine}>Accuracy <Text style={styles.statStrong}>{results.length ? Math.round((correctCount / results.length) * 100) : 0}%</Text></Text>
          <Text style={styles.statLine}>Average per matrix <Text style={styles.statStrong}>{results.length ? formatSeconds(results.reduce((sum, entry) => sum + entry.timeMs, 0) / results.length) : "0.0"} s</Text></Text>
          <Text style={styles.statLine}>Fastest correct <Text style={styles.statStrong}>{correctTimes.length ? `${formatSeconds(Math.min(...correctTimes))} s` : "—"}</Text></Text>
          {settings.difficulty === "progressive" ? <Text style={styles.statLine}>By level <Text style={styles.statStrong}>{levelBreakdown.map(({ level, entries }) => `${LEVEL_LABELS[level].charAt(0)}${LEVEL_LABELS[level].slice(1).toLowerCase()} ${entries.filter((entry) => entry.correct).length}/${entries.length}`).join(" · ")}</Text></Text> : null}
        </View>
        <View style={styles.actions}>
          <TouchableOpacity activeOpacity={0.88} onPress={resetToReady} style={styles.primaryButton}><Text style={styles.primaryText}>Play again</Text></TouchableOpacity>
          <TouchableOpacity activeOpacity={0.88} onPress={returnToPreflight} style={styles.secondaryButton}><Text style={styles.secondaryText}>Change settings</Text></TouchableOpacity>
        </View>
      </Animated.View> : null}
    </Animated.View> : null}
  </View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: SPACE_CADET.black }, preflightLayer: { ...StyleSheet.absoluteFill, zIndex: 1 }, missionLayer: { flex: 1, backgroundColor: SPACE_CADET.black, zIndex: 2 },
  header: { height: 64, paddingHorizontal: 20, justifyContent: "center" }, backButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" }, backArrow: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 32, lineHeight: 36 }, pressed: { transform: [{ scale: 0.97 }] },
  kicker: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.9, textAlign: "center" },
  readyScreen: { flex: 1, alignItems: "center", paddingHorizontal: 28, paddingTop: 54 }, readyTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 30, marginTop: 9, textAlign: "center" }, readyText: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, maxWidth: 300, textAlign: "center", marginTop: 12 },
  cueCard: { width: "100%", borderRadius: 22, paddingVertical: 22, paddingHorizontal: 22, alignItems: "center", backgroundColor: SPACE_CADET.surface1, marginTop: 52 }, cueLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6 }, cueText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 12 },
  beginPrompt: { marginTop: 48, textAlign: "center" },
  playScreen: { flex: 1, paddingHorizontal: 20, paddingBottom: 48 }, statusRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 16 }, statusRight: { alignItems: "flex-end" }, statusLabel: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.5 }, statusValue: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 28, marginTop: 3 }, statusTotal: { color: SPACE_CADET.textTertiary, fontSize: 18 },
  board: { flex: 1, alignItems: "center", justifyContent: "center" }, levelTag: { color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6, marginBottom: 12 },
  matrix: { flexDirection: "row", flexWrap: "wrap" }, matrixCell: { borderRadius: 14, backgroundColor: SPACE_CADET.surface1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  missingCell: { backgroundColor: "transparent", borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(94,235,235,0.55)" }, missingRevealed: { borderStyle: "solid", borderColor: ACCENT, backgroundColor: "#0C2626" }, missingMark: { color: ACCENT, fontFamily: "Gontserrat-Light", fontSize: 34 },
  sectionLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.7, marginTop: 24, marginBottom: 14, textAlign: "center" },
  optionGrid: { flexDirection: "row", flexWrap: "wrap" }, option: { borderRadius: 14, backgroundColor: SPACE_CADET.surface1, borderWidth: 1, borderColor: SPACE_CADET.borderSubtle, alignItems: "center", justifyContent: "center", overflow: "hidden" }, optionPressed: { borderColor: ACCENT, transform: [{ scale: 0.97 }] }, optionCorrect: { borderColor: SUCCESS, backgroundColor: "#0C2B23" }, optionWrong: { borderColor: ERROR, backgroundColor: "#3D101D" },
  summaryScreen: { flex: 1, alignItems: "center", paddingHorizontal: 20, paddingTop: 58, paddingBottom: 48 }, summaryTitle: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Light", fontSize: 31, marginTop: 8 }, summaryScore: { color: ACCENT, fontFamily: "Garet-Book", fontSize: 82, lineHeight: 94, marginTop: 18 }, summaryScoreTotal: { color: SPACE_CADET.textTertiary, fontSize: 36 }, summaryCaption: { color: SPACE_CADET.textSecondary, fontFamily: "Garet-Book", fontSize: 16, textAlign: "center", marginTop: -2 },
  statCard: { width: "100%", backgroundColor: SPACE_CADET.surface1, borderRadius: 22, padding: 18, gap: 10, marginTop: 30 }, statLabel: { color: ACCENT, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.6, marginBottom: 4 }, statLine: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-Regular", fontSize: 13 }, statStrong: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 15 },
  actions: { width: "100%", gap: 12, marginTop: "auto" }, primaryButton: { minHeight: 54, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: SPACE_CADET.white }, primaryText: { color: SPACE_CADET.black, fontFamily: "Gontserrat-Regular", fontSize: 16 }, secondaryButton: { minHeight: 52, borderRadius: 999, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" }, secondaryText: { color: SPACE_CADET.white, fontFamily: "Gontserrat-Regular", fontSize: 15 },
});
