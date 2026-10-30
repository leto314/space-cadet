// Circuits: the logic. Pure JavaScript (no React, no React Native): the circuits (switches, gate layers,
// bulbs) and what each mode asks, the points of a circuit, the daily progression and the results. Every
// generator takes `random` (a Math.random-like function, see utils/random.js) so the same seed always gives
// the same circuits.

import { createRandom, deriveSeed, drawFresh, randomTools } from "../../utils/random.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const MODE_CYCLE = ["gate", "inputs", "outputs"];

const GATES = {
  AND: (a, b) => a & b, OR: (a, b) => a | b, XOR: (a, b) => a ^ b,
  NAND: (a, b) => 1 - (a & b), NOR: (a, b) => 1 - (a | b), XNOR: (a, b) => 1 - (a ^ b), NOT: (a) => 1 - a,
};
// Switches at the bottom, then gate layers; each gate in the top layer drives one bulb. The switch-flipping mode
// uses bigger boards (3 to 6 switches) so the answer can't be found by blind trial and error.
const TEMPLATES = [
  { inputs: 2, layers: [2, 1] }, { inputs: 3, layers: [2, 1] }, { inputs: 3, layers: [2, 2] }, { inputs: 3, layers: [3, 2] },
  { inputs: 4, layers: [3, 2] }, { inputs: 3, layers: [2, 2, 1] }, { inputs: 4, layers: [2, 2, 1] }, { inputs: 4, layers: [3, 2, 2] },
];
const INPUT_TEMPLATES = [
  { inputs: 3, layers: [2, 2] }, { inputs: 3, layers: [3, 2] }, { inputs: 4, layers: [2, 2] }, { inputs: 4, layers: [3, 2] }, { inputs: 4, layers: [2, 2, 1] },
  { inputs: 5, layers: [3, 2] }, { inputs: 5, layers: [3, 2, 2] }, { inputs: 5, layers: [3, 3, 2] },
  { inputs: 6, layers: [3, 2] }, { inputs: 6, layers: [3, 3, 2] }, { inputs: 6, layers: [4, 3, 2] },
];
const GENERATION_ATTEMPTS = 2500;
export const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

export function gateSetFor({ withXor, withNegated }) {
  const set = ["AND", "OR", "NOT"];
  if (withXor) set.push("XOR");
  if (withNegated) set.push("NAND", "NOR");
  if (withXor && withNegated) set.push("XNOR");
  return set;
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

// rows[0] = switch values, rows[k] = outputs of gate layer k-1; the last row is also the bulbs.
export function evaluate(circuit, inputs, override = null) {
  const rows = [inputs];
  circuit.layers.forEach((layer, layerIndex) => {
    rows.push(layer.map((gate, gateIndex) => {
      const type = override && override.layer === layerIndex && override.index === gateIndex ? override.type : gate.type;
      return GATES[type](...gate.sources.map((source) => rows[layerIndex][source]));
    }));
  });
  return rows;
}
export const bulbsOf = (circuit, inputs, override) => evaluate(circuit, inputs, override).at(-1);
const toBits = (mask, count) => range(0, count - 1).map((index) => (mask >> index) & 1);
export const sameBits = (a, b) => a.every((value, index) => value === b[index]);
const bitSum = (bits) => bits.reduce((sum, bit) => sum + bit, 0);

// Gates prefer sources roughly below them, so wiring stays local and readable instead of criss-crossing the board.
function buildWiring(template, gateSet, rnd) {
  const layers = [];
  let belowCount = template.inputs;
  for (const count of template.layers) {
    const layer = [];
    for (let index = 0; index < count; index += 1) {
      const type = rnd.item([...gateSet.filter((gate) => gate !== "NOT"), ...gateSet]);
      const center = ((index + 0.5) / count) * belowCount - 0.5;
      const sources = [];
      while (sources.length < (type === "NOT" ? 1 : 2)) {
        const pool = range(0, belowCount - 1).filter((source) => !sources.includes(source)).map((source) => ({ source, weight: 1 / (1 + (source - center) ** 2) }));
        sources.push(rnd.weighted(pool).source);
      }
      layer.push({ type, sources: sources.sort((a, b) => a - b) });
    }
    // Every switch/gate below must feed something, and no two gates may be identical twins.
    if (new Set(layer.flatMap((gate) => gate.sources)).size < belowCount) return null;
    if (new Set(layer.map((gate) => `${gate.type}:${gate.sources}`)).size < layer.length) return null;
    layers.push(layer);
    belowCount = count;
  }
  return { inputCount: template.inputs, layers };
}

// One circuit in a mode ("gate" | "inputs" | "outputs") with a gate set, from a seeded generator. `inputCount`
// pins the board's switch count (the daily progression grows it stage by stage). Otherwise, in the
// switch-setting mode the switch count is drawn first so 3, 4, 5 and 6 switches come up equally often (small
// boards pass the constraints more easily and would otherwise dominate); a rare dead end falls back to one
// switch fewer.
export function buildCircuit(mode, gateSet, random, { inputCount = null } = {}) {
  const rnd = makeRandomTools(random);
  if (mode !== "inputs") {
    const pinned = inputCount ? TEMPLATES.filter((template) => template.inputs === inputCount) : [];
    return generate(mode, gateSet, pinned.length ? pinned : TEMPLATES, rnd);
  }
  for (let switchCount = inputCount ?? rnd.int(3, 6); switchCount >= 3; switchCount -= 1) {
    const circuit = generate(mode, gateSet, INPUT_TEMPLATES.filter((template) => template.inputs === switchCount), rnd);
    if (circuit) return circuit;
  }
  return null;
}

function generate(mode, gateSet, templates, rnd) {
  const binaryGates = gateSet.filter((gate) => gate !== "NOT");
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const circuit = buildWiring(rnd.item(templates), gateSet, rnd);
    if (!circuit) continue;
    const combos = range(0, 2 ** circuit.inputCount - 1).map((mask) => toBits(mask, circuit.inputCount));
    const table = combos.map((inputs) => bulbsOf(circuit, inputs));
    // A bulb that is always on (or always off) whatever the switches is dead weight.
    if (table[0].some((_, bulb) => table.every((row) => row[bulb] === table[0][bulb]))) continue;

    if (mode === "inputs") {
      // Few enough solutions that blind flipping is hopeless: one for 3-4 switches, at most 2 for 5 and 4 for 6.
      const target = table[rnd.int(1, combos.length - 1)];
      const solutions = combos.filter((_, row) => sameBits(table[row], target));
      if (solutions.length > Math.max(1, Math.floor(combos.length / 16)) || sameBits(table[0], target)) continue;
      return { ...circuit, mode, inputs: solutions[0], target, minFlips: Math.min(...solutions.map(bitSum)), solutionCount: solutions.length };
    }

    const inputs = combos[rnd.int(1, combos.length - 1)];
    const target = bulbsOf(circuit, inputs);
    if (mode === "outputs") return { ...circuit, mode, inputs, target };

    // Missing gate: only a two-input gate can go missing (the choices must fit its slot). A gate outputs a single
    // bit, so two options with the same output always light the same bulbs: the distractors are therefore the
    // gates that output the opposite bit for these inputs, and exactly one offered gate can reproduce the target.
    const rows = evaluate(circuit, inputs);
    const candidates = rnd.shuffle(circuit.layers.flatMap((layer, layerIndex) => layer.map((gate, index) => ({ layer: layerIndex, index, gate })).filter(({ gate }) => gate.type !== "NOT")));
    for (const { layer, index, gate } of candidates) {
      const pins = gate.sources.map((source) => rows[layer][source]);
      const opposite = binaryGates.filter((type) => GATES[type](...pins) !== GATES[gate.type](...pins));
      const options = [gate.type, ...rnd.shuffle(opposite).slice(0, 3)];
      if (options.length < 2) continue;
      const working = options.filter((type) => sameBits(bulbsOf(circuit, inputs, { layer, index, type }), target));
      if (working.length !== 1) continue;
      return { ...circuit, mode, inputs, target, missing: { layer, index }, answerType: gate.type, options: rnd.shuffle(options) };
    }
  }
  return null;
}

function circuitFromSeed({ mode, gateSet, inputCount = null }, seed, index) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const circuit = buildCircuit(mode, gateSet, createRandom(deriveSeed(seed, `circuit-${index}:${attempt}`)), { inputCount });
    if (circuit) return { ...circuit, gateSet };
  }
  return null;
}

// What makes two circuits the same question: the same mode, wiring, switch positions and target.
export const circuitKey = (circuit) => (circuit ? JSON.stringify({ mode: circuit.mode, layers: circuit.layers, inputs: circuit.inputs, target: circuit.target }) : "none");

// A Full Clearance session from a seed: `circuitCount` circuits in the chosen mode ("mixed" draws each
// circuit's mode from the seed) with the chosen gate set, never the same circuit twice.
export function buildSession({ mode, circuitCount, gateSet }, seed) {
  const rnd = randomTools(createRandom(deriveSeed(seed, "modes")));
  const asked = new Set();
  return Array.from({ length: circuitCount }, (_, index) => {
    const settings = { mode: mode === "mixed" ? rnd.item(MODE_CYCLE) : mode, gateSet };
    let attempt = 0;
    return drawFresh(() => circuitFromSeed(settings, seed, attempt++ === 0 ? index : `${index}:${attempt - 1}`), circuitKey, asked);
  }).filter(Boolean);
}

// Flip budget of a switch-setting circuit. `par` is the fewest flips that light the target plus one for a
// correction; `cap` is the flip limit, two flips per switch beyond the minimum: a circuit still unsolved at the
// cap ends there.
export const FLIPS_PER_SWITCH = 2;
export function flipBudget(circuit) {
  return { par: circuit.minFlips + 1, cap: circuit.minFlips + FLIPS_PER_SWITCH * circuit.inputCount };
}

// Points of a circuit (0–100). Predicting the bulbs or finding the missing gate is all or nothing. Setting the
// switches scores 100 within par, falling evenly to SOLVED_FLOOR for a solve at the cap, 0 when the cap is
// reached without a solve.
export const SOLVED_FLOOR = 25;
export function circuitPoints(circuit, { correct, flips = 0 }) {
  if (!correct) return 0;
  if (circuit.mode !== "inputs") return 100;
  const { par, cap } = flipBudget(circuit);
  if (flips <= par) return 100;
  const share = clamp((cap - flips) / (cap - par), 0, 1);
  return Math.round(SOLVED_FLOOR + (100 - SOLVED_FLOOR) * share);
}

// Daily training: six circuits for everyone, bigger boards and more gates as they go. Predict the bulbs with
// the basic gates (three switches), find the missing gate, predict with XOR (four switches), find the gate
// among all seven, then set the switches: four switches with XOR, five with all seven gates. Each circuit is
// worth 0–100 points; the score is the six scaled to 1000.
export const DAILY_CIRCUITS = [
  { mode: "outputs", gateSet: gateSetFor({ withXor: false, withNegated: false }), inputCount: 3, label: "PREDICT" },
  { mode: "gate", gateSet: gateSetFor({ withXor: false, withNegated: false }), inputCount: 3, label: "MISSING GATE" },
  { mode: "outputs", gateSet: gateSetFor({ withXor: true, withNegated: false }), inputCount: 4, label: "PREDICT" },
  { mode: "gate", gateSet: gateSetFor({ withXor: true, withNegated: true }), inputCount: 4, label: "MISSING GATE" },
  { mode: "inputs", gateSet: gateSetFor({ withXor: true, withNegated: false }), inputCount: 4, label: "SET THE SWITCHES" },
  { mode: "inputs", gateSet: gateSetFor({ withXor: true, withNegated: true }), inputCount: 5, label: "SET THE SWITCHES" },
];
export const DAILY_POINTS_PER_CIRCUIT = 1000 / DAILY_CIRCUITS.length;
export function buildDailySession(seed) {
  return DAILY_CIRCUITS.map((stage, index) => { const circuit = circuitFromSeed(stage, seed, index); return circuit ? { ...circuit, label: stage.label } : null; }).filter(Boolean);
}

// One finished circuit: what was played and its points.
export function circuitEntry(circuit, { correct, timeMs, flips = null }) {
  return { mode: circuit.mode, correct, timeMs, flips, minFlips: circuit.mode === "inputs" ? circuit.minFlips : null, inputCount: circuit.inputCount, gates: circuit.gateSet.length, points: circuitPoints(circuit, { correct, flips: flips ?? 0 }) };
}

// The daily result from the circuit entries: the points scaled to 1000, the metrics recorded, and the compact
// trial list.
export function dailyResult(entries) {
  const points = entries.reduce((sum, entry) => sum + entry.points, 0);
  const correct = entries.filter((entry) => entry.correct);
  const pointsIn = (mode) => entries.filter((entry) => entry.mode === mode).reduce((sum, entry) => sum + entry.points, 0);
  const flipEntries = entries.filter((entry) => entry.mode === "inputs" && entry.correct);
  return {
    score: clamp(Math.round(points * (1000 / (entries.length * 100))), 0, 1000),
    metrics: {
      correct: correct.length, circuits: entries.length,
      predictPoints: pointsIn("outputs"), gatePoints: pointsIn("gate"), switchPoints: pointsIn("inputs"),
      extraFlips: flipEntries.reduce((sum, entry) => sum + Math.max(0, entry.flips - entry.minFlips), 0),
      meanCircuitMs: entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.timeMs, 0) / entries.length) : 0,
    },
    trials: entries.map((entry) => ({ ok: entry.correct ? 1 : 0, ms: entry.timeMs, pts: entry.points, mode: entry.mode, flips: entry.flips, minFlips: entry.minFlips, switches: entry.inputCount, gates: entry.gates })),
  };
}
