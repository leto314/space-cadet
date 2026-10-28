// The small logic puzzles: the logic. Pure JavaScript (no React): the specs of the Switch panel and of the
// Landing order (wide and split layouts), their puzzles drawn from the seed through the games' own generators,
// and the scoring.

import { buildScenario } from "../../../games/landing-order/logic.js";
import { applyAction, buildPanel } from "../../../games/switchboard/logic.js";
import { createRandom } from "../../../utils/random.js";

// ---- Switch panel ----------------------------------------------------------------------------------------
// Same rules as the full game (toggle / swap / shift / copy, everything starts dark), on a small panel: three
// switches, three lights for the first two panels, then four.
export const miniSwitchboardSpec = {
  id: "mini-switchboard",
  title: "Switch panel",
  competence: "logic",
  secondary: [],
  task: "opportunistic",
  voice: false,
  load: 2,
  rule: "All lights start off. Each switch does one thing: toggle lights, swap two lights, shift the row, or copy one light onto another. Make the lights match the target row. A new panel comes as soon as you solve one; RESET turns everything off.",
  recap: "match the target lights",
  blocks: [{ key: "lights", role: "display", h: 2, w: 2 }, { key: "switches", role: "control", h: 2, w: 2 }],
};

// The pace a perfect score asks for: one panel every 22 s of flight; each extra press beyond the shortest route
// costs a little.
export const PANEL_SECONDS = 22;
export const EXTRA_PRESS_COST = 0.01;
const panelCount = (durationMs) => Math.ceil(durationMs / 4000) + 5;
export { applyAction };

export function switchLabel(action) {
  const lights = (action.cells ?? []).map((index) => index + 1);
  if (action.type === "toggle") return `TOGGLE ${[...lights].sort((a, b) => a - b).join(" · ")}`;
  if (action.type === "swap") return `SWAP ${lights[0]} ↔ ${lights[1]}`;
  if (action.type === "shift") return `SHIFT ${action.direction > 0 ? "→" : "←"}`;
  return `COPY ${lights[0]} → ${lights[1]}`;
}

function buildSwitchboardContent(seed, { durationMs }) {
  const random = createRandom(seed);
  return Array.from({ length: panelCount(durationMs) }, (_, index) => buildPanel({ lightCount: index >= 2 ? 4 : 3, switchCount: 3 }, random));
}
function switchboardResult(stats, { durationMs }) {
  const target = Math.max(1, durationMs / 1000 / PANEL_SECONDS);
  return { performance: Math.max(0, Math.min(1, Math.min(1, stats.panels / target) - EXTRA_PRESS_COST * stats.extra)), detail: `${stats.panels} panels solved${stats.extra ? ` · ${stats.extra} extra presses` : ""}` };
}

// ---- Landing order ---------------------------------------------------------------------------------------
// Three aircraft, a minimal set of clues, one question. A wrong tap costs half a good answer.
const landingBase = {
  competence: "logic",
  secondary: ["memory"],
  task: "opportunistic",
  voice: false,
  load: 2,
  family: "mini-landing",
  rule: "Three aircraft are about to land. Read the clues, work out the landing order and answer the question below them. A new puzzle comes after each answer. Wrong answers cost points, so don't guess.",
  recap: "answer the landing puzzles",
};

// "wide" is one full-width block with the answers stacked on the right; "split" puts the clues in a square block
// and the answers on a strip.
export const miniLandingSpec = {
  ...landingBase,
  id: "mini-landing",
  title: "Landing order",
  blocks: [{ key: "board", role: "display", h: 2, w: 4, refresh: "slow" }],
  options: { layout: "wide" },
};
export const miniLandingSplitSpec = {
  ...landingBase,
  id: "mini-landing-split",
  title: "Landing order (split)",
  blocks: [{ key: "clues", role: "display", h: 2, w: 2, refresh: "slow" }, { key: "answers", role: "control", h: 1, w: 4 }],
  options: { layout: "split" },
};

export const LANDING_SECONDS = 26;
export const WRONG_ANSWER_COST = 0.5;
const scenarioCount = (durationMs) => Math.ceil(durationMs / 5000) + 5;

function buildLandingContent(seed, { durationMs }) {
  const random = createRandom(seed);
  const scenarios = [];
  while (scenarios.length < scenarioCount(durationMs)) { const scenario = buildScenario(3, random); if (scenario) scenarios.push(scenario); }
  return scenarios;
}
function landingResult(stats, { durationMs }) {
  const target = Math.max(1, durationMs / 1000 / LANDING_SECONDS);
  const { right, wrong } = stats;
  return { performance: Math.max(0, Math.min(1, (right - wrong * WRONG_ANSWER_COST) / target)), detail: `${right} right${wrong ? ` · ${wrong} wrong` : ""}` };
}

// ---- The shared contract ---------------------------------------------------------------------------------
const isSwitchboard = (spec) => spec.id === miniSwitchboardSpec.id;
export function buildContent(spec, seed, context) {
  return isSwitchboard(spec) ? buildSwitchboardContent(seed, context) : buildLandingContent(seed, context);
}
// Switch panel: panels solved and presses beyond the shortest route. Landing order: right and wrong answers.
export function emptyStats(spec) {
  return isSwitchboard(spec) ? { panels: 0, extra: 0 } : { right: 0, wrong: 0 };
}
export function moduleResult(spec, stats, context) {
  return isSwitchboard(spec) ? switchboardResult(stats, context) : landingResult(stats, context);
}

// The flight nobody played: nothing solved, nothing answered.
export function idleStats(spec) { return emptyStats(spec); }
