// Switchboard: the logic. Pure JavaScript (no React, no React Native): the panels (switch wirings and targets),
// the points of a panel, the daily progression and the results. Every generator takes `random` (a
// Math.random-like function, see utils/random.js) so the same seed always gives the same panels.

import { createRandom, deriveSeed } from "../../utils/random.js";

export const SWITCH_LABELS = ["A", "B", "C", "D", "E"];
export const MAX_TARGET_DEPTH = 5;
const GENERATION_ATTEMPTS = 80;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function randomInt(min, max, random) { return Math.floor(random() * (max - min + 1)) + min; }
function pickDistinct(count, total, random) {
  const pool = Array.from({ length: total }, (_, index) => index);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, count);
}
function bit(mask, index) { return (mask >> index) & 1; }
export function maskToLights(mask, count) { return Array.from({ length: count }, (_, index) => bit(mask, index) === 1); }

// Lights are a bitmask (bit i = light i). Every action is a pure mask -> mask function, so the whole puzzle
// can be solved exactly by BFS: with at most 6 lights there are only 64 states.
export function applyAction(mask, action, count) {
  if (action.type === "toggle") return action.cells.reduce((next, index) => next ^ (1 << index), mask);
  if (action.type === "swap") {
    const [a, b] = action.cells;
    return bit(mask, a) === bit(mask, b) ? mask : mask ^ (1 << a) ^ (1 << b);
  }
  if (action.type === "shift") {
    let next = 0;
    for (let index = 0; index < count; index += 1) if (bit(mask, index)) next |= 1 << ((index + action.direction + count) % count);
    return next;
  }
  const [from, to] = action.cells;
  return bit(mask, from) ? mask | (1 << to) : mask & ~(1 << to);
}

function actionSignature(action) {
  if (action.type === "toggle") return `t:${[...action.cells].sort().join(",")}`;
  if (action.type === "swap") return `s:${[...action.cells].sort().join(",")}`;
  if (action.type === "shift") return `r:${action.direction}`;
  return `c:${action.cells.join(">")}`;
}

function randomAction(type, count, random) {
  if (type === "toggle") return { type, cells: pickDistinct(randomInt(1, Math.min(3, count - 1), random), count, random) };
  if (type === "shift") return { type, direction: random() < 0.5 ? -1 : 1 };
  return { type, cells: pickDistinct(2, count, random) };
}

// Everything starts dark, so a panel needs at least one toggle to light anything; the other switches draw from
// all four action types. Duplicate wirings are rejected so every switch does something distinct.
function buildSwitches(lightCount, switchCount, random) {
  const actions = [randomAction("toggle", lightCount, random)];
  const seen = new Set([actionSignature(actions[0])]);
  const types = ["toggle", "toggle", "swap", "shift", "copy"];
  while (actions.length < switchCount) {
    const candidate = randomAction(types[Math.floor(random() * types.length)], lightCount, random);
    const signature = actionSignature(candidate);
    if (seen.has(signature)) continue;
    seen.add(signature);
    actions.push(candidate);
  }
  return pickDistinct(actions.length, actions.length, random).map((index) => actions[index]);
}

function explore(actions, count) {
  const distance = new Map([[0, 0]]);
  const parent = new Map();
  const queue = [0];
  while (queue.length) {
    const mask = queue.shift();
    actions.forEach((action, actionIndex) => {
      const next = applyAction(mask, action, count);
      if (distance.has(next)) return;
      distance.set(next, distance.get(mask) + 1);
      parent.set(next, { from: mask, actionIndex });
      queue.push(next);
    });
  }
  return { distance, parent };
}

function shortestPath(parent, target) {
  const path = [];
  let cursor = target;
  while (parent.has(cursor)) { const step = parent.get(cursor); path.unshift(step.actionIndex); cursor = step.from; }
  return path;
}

// Picks a target that is deep enough to need thought (and, when possible, one that can't be reached with the
// toggle switches alone, so the swap/shift/copy switches actually matter). `random` is a seeded generator (the
// mission modules draw several panels from one stream; the sessions below give each panel its own).
export function buildPanel({ lightCount, switchCount }, random) {
  const minDepth = lightCount <= 3 ? 2 : 3;
  let best = null;
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const switches = buildSwitches(lightCount, switchCount, random);
    const { distance, parent } = explore(switches, lightCount);
    const toggleOnly = explore(switches.filter((action) => action.type === "toggle"), lightCount).distance;
    const candidates = [...distance.entries()]
      .filter(([, depth]) => depth >= 2 && depth <= MAX_TARGET_DEPTH)
      .map(([mask, depth]) => ({ mask, depth, score: depth + (!toggleOnly.has(mask) || toggleOnly.get(mask) > depth ? 1.5 : 0) }))
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) continue;
    const choice = candidates[Math.floor(random() * Math.min(3, candidates.length))];
    const panel = { lightCount, switchCount, switches, target: choice.mask, optimal: choice.depth, solution: shortestPath(parent, choice.mask) };
    if (choice.depth >= minDepth) return panel;
    if (!best || choice.depth > best.optimal) best = panel;
  }
  return best;
}

function listLights(cells) {
  const labels = cells.map((index) => index + 1).sort((a, b) => a - b);
  return labels.length === 1 ? `light ${labels[0]}` : `lights ${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
export function describeAction(action) {
  if (action.type === "toggle") return `Toggles ${listLights(action.cells)}`;
  if (action.type === "swap") return `Swaps ${listLights(action.cells)}`;
  if (action.type === "shift") return `Shifts the row ${action.direction > 0 ? "right" : "left"}`;
  return `Copies light ${action.cells[0] + 1} onto light ${action.cells[1] + 1}`;
}
export function shortAction(action) {
  const lights = (action.cells ?? []).map((index) => index + 1);
  if (action.type === "toggle") return `Toggle ${[...lights].sort((a, b) => a - b).join(" · ")}`;
  if (action.type === "swap") return `Swap ${lights[0]} and ${lights[1]}`;
  if (action.type === "shift") return `Shift ${action.direction > 0 ? "right" : "left"}`;
  return `Copy ${lights[0]} to ${lights[1]}`;
}

// Move budget of a panel, all in multiples of its shortest route. When the wiring is hidden, `revealAt` is the
// number of moves after which the switches show what they do (twice the shortest route: enough to press every
// switch and see it, and past that point a hidden wiring is only a guessing game); it is null when the wiring
// is shown from the start. `par` is the number of moves a perfect solve needs: the shortest route, plus the
// discovery moves when the wiring is hidden (so a player who reads the revealed wiring and then plays the
// shortest route is still on budget). `cap` is the move limit: a panel still unsolved at the cap ends there.
export const REVEAL_FACTOR = 2;
export function moveBudget(panel) {
  const revealAt = panel.showWiring ? null : REVEAL_FACTOR * panel.optimal;
  const par = panel.optimal + (revealAt ?? 0);
  return { revealAt, par, cap: 2 * par + 2 };
}
// Whether the wiring is visible after `moves` moves.
export function wiringVisible(panel, moves) {
  const { revealAt } = moveBudget(panel);
  return revealAt === null || moves >= revealAt;
}

// Points of a panel (0–100): 100 when solved within par, falling evenly to SOLVED_FLOOR for a solve at the
// cap, 0 when the cap is reached without a solve. Resets are free.
export const SOLVED_FLOOR = 25;
export function panelPoints(panel, moves, solved) {
  if (!solved) return 0;
  const { par, cap } = moveBudget(panel);
  if (moves <= par) return 100;
  const share = clamp((cap - moves) / (cap - par), 0, 1);
  return Math.round(SOLVED_FLOOR + (100 - SOLVED_FLOOR) * share);
}

function panelFromSeed(settings, seed, index) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const panel = buildPanel(settings, createRandom(deriveSeed(seed, `panel-${index}:${attempt}`)));
    if (panel) return { ...panel, showWiring: settings.showWiring, label: settings.label ?? null };
  }
  return null;
}

// A Full Clearance session: one panel with the chosen lights, switches and wiring visibility, from a seed.
export function buildSession({ lightCount, switchCount, showWiring }, seed) {
  return [panelFromSeed({ lightCount, switchCount, showWiring }, seed, 0)].filter(Boolean);
}

// Daily training: five panels for everyone, harder as they go: two with the wiring shown (planning only), then
// three with it hidden (discover, then plan; the wiring is revealed after twice the shortest route), up to five
// lights and four switches (beyond that a hidden panel is only guesswork). Each panel is worth 0–100 points
// against its move budget; the score is the five scaled to 1000.
export const DAILY_PANELS = [
  { lightCount: 3, switchCount: 3, showWiring: true, label: "WIRING SHOWN" },
  { lightCount: 4, switchCount: 4, showWiring: true, label: "WIRING SHOWN" },
  { lightCount: 4, switchCount: 3, showWiring: false, label: "WIRING HIDDEN" },
  { lightCount: 4, switchCount: 4, showWiring: false, label: "WIRING HIDDEN" },
  { lightCount: 5, switchCount: 4, showWiring: false, label: "WIRING HIDDEN" },
];
export const DAILY_POINTS_PER_PANEL = 1000 / DAILY_PANELS.length;
export function buildDailySession(seed) {
  return DAILY_PANELS.map((settings, index) => panelFromSeed(settings, seed, index)).filter(Boolean);
}

// One finished panel: what was played and its points.
export function panelEntry(panel, { solved, moves, resets, timeMs }) {
  const { revealAt, par, cap } = moveBudget(panel);
  return { solved, moves, resets, timeMs, optimal: panel.optimal, revealAt, par, cap, wiringRevealed: !panel.showWiring && moves >= revealAt, lightCount: panel.lightCount, switchCount: panel.switches.length, showWiring: panel.showWiring, points: panelPoints(panel, moves, solved) };
}

// The daily result from the panel entries: the points scaled to 1000, the metrics recorded, and the compact
// trial list.
export function dailyResult(entries) {
  const points = entries.reduce((sum, entry) => sum + entry.points, 0);
  const solved = entries.filter((entry) => entry.solved);
  return {
    score: clamp(Math.round(points * (1000 / (entries.length * 100))), 0, 1000),
    metrics: {
      solved: solved.length, panels: entries.length,
      totalMoves: entries.reduce((sum, entry) => sum + entry.moves, 0),
      extraMoves: solved.reduce((sum, entry) => sum + Math.max(0, entry.moves - entry.optimal), 0),
      resets: entries.reduce((sum, entry) => sum + entry.resets, 0),
      wiringsRevealed: entries.filter((entry) => entry.wiringRevealed).length,
      meanPanelMs: entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.timeMs, 0) / entries.length) : 0,
      shownPoints: entries.filter((entry) => entry.showWiring).reduce((sum, entry) => sum + entry.points, 0),
      hiddenPoints: entries.filter((entry) => !entry.showWiring).reduce((sum, entry) => sum + entry.points, 0),
    },
    trials: entries.map((entry) => ({ ok: entry.solved ? 1 : 0, ms: entry.timeMs, pts: entry.points, moves: entry.moves, optimal: entry.optimal, lights: entry.lightCount, wiring: entry.showWiring ? "shown" : "hidden" })),
  };
}
