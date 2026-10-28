// Logic panel: the logic. Pure JavaScript (no React): the module's spec, the panels drawn from the seed, and
// the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

export const logicGatesSpec = {
  id: "logic-gates",
  title: "Logic panel",
  competence: "logic",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 2,
  rule: "Each bulb follows its formula of the switches A, B and C. Set the switches so every bulb matches its ON or OFF target. A new panel arrives as soon as one is solved.",
  recap: "solve the logic panels",
  blocks: [{ key: "bulbs", role: "display", h: 1, w: 4, refresh: "slow" }, { key: "switches", role: "control", h: 2, w: 1 }],
};

export const SWITCHES = ["A", "B", "C"];
export const NEXT_PANEL_MS = 1500;
// The pace a perfect score asks for: one panel solved every 22 s of flight.
export const SECONDS_PER_PANEL_TARGET = 22;
// Panels in the stream: more than anyone can solve (a panel every 3 s), so it never runs dry.
const panelCount = (durationMs) => Math.ceil(durationMs / 3000) + 5;

// Small boolean expressions over three switches, written the way they read.
export const EXPRESSIONS = [];
[[0, 1], [0, 2], [1, 2]].forEach(([a, b]) => {
  const [x, y] = [SWITCHES[a], SWITCHES[b]];
  EXPRESSIONS.push(
    { text: `${x} AND ${y}`, test: (s) => s[a] && s[b] },
    { text: `${x} OR ${y}`, test: (s) => s[a] || s[b] },
    { text: `${x} XOR ${y}`, test: (s) => s[a] !== s[b] },
    { text: `${x} AND NOT ${y}`, test: (s) => s[a] && !s[b] },
    { text: `NOT ${x} AND ${y}`, test: (s) => !s[a] && s[b] },
  );
});
SWITCHES.forEach((name, index) => EXPRESSIONS.push({ text: `NOT ${name}`, test: (s) => !s[index] }));

export const ALL_STATES = Array.from({ length: 8 }, (_, mask) => [0, 1, 2].map((index) => Boolean((mask >> index) & 1)));
export const outputs = (panel, switches) => panel.map((expression) => Boolean(expression.test(switches)));
export const same = (a, b) => a.every((value, index) => value === b[index]);

// A panel is three bulbs with a target each; exactly one switch setting lights them all correctly, and it is never
// the setting the switches are already in (`current`: all off for the first panel, then the previous solution).
function buildPanel(rnd, current) {
  for (;;) {
    const panel = rnd.shuffle(EXPRESSIONS).slice(0, 3);
    const solution = rnd.item(ALL_STATES);
    const target = outputs(panel, solution);
    if (ALL_STATES.filter((state) => same(outputs(panel, state), target)).length !== 1) continue;
    if (same(outputs(panel, current), target)) continue;
    return { panel, target, solution };
  }
}

// The sequence of panels of the flight: since every panel has a single solution, the switches after a solve are
// known, so each panel is built against the state the player will be in when it arrives.
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const panels = [];
  let current = [false, false, false];
  for (let index = 0; index < panelCount(durationMs); index += 1) {
    const entry = buildPanel(rnd, current);
    panels.push(entry);
    current = entry.solution;
  }
  return panels;
}

export function emptyStats() { return { solved: 0, flips: 0 }; }

// The share of the expected pace: one panel every SECONDS_PER_PANEL_TARGET seconds scores 1.
export function moduleResult(spec, stats, { durationMs }) {
  const target = Math.max(1, durationMs / 1000 / SECONDS_PER_PANEL_TARGET);
  return { performance: Math.max(0, Math.min(1, stats.solved / target)), detail: `${stats.solved} panels solved · ${stats.flips} flips` };
}

// The flight nobody played: no panel solved.
export function idleStats() { return emptyStats(); }
