// The mission of the day: which modules fly together. Pure JavaScript (no React): it reads the catalogue of
// module specs (modules/specs.js), never the screens, so a mission can be generated and checked in plain Node.
//
// A mission is built with memory of the days before it, so the modules rotate:
// - a module that flew MAX_STREAK days in a row rests; at most MAX_THIRD_DAY_MODULES modules may be on their third
//   day in a row (one system repeating is fine, the same pair three days running is not);
// - a competence absent for COMPETENCE_GAP_DAYS days is required today, so every competence comes back within
//   COMPETENCE_GAP_DAYS + 1 days;
// - among the rest, the modules that have waited longest relative to their natural period (big systems fly less
//   often than small ones) are picked first, then the board is filled around them, preferring a competence that
//   is not on board yet.
// The memory has no database behind it: the days before are regenerated. To keep that bounded and identical
// on every phone, days come in blocks of BLOCK_DAYS from ANCHOR_DAY, and a day remembers the days of its block
// before it, nothing earlier (a longer memory would need the previous block's own memory, and so on without
// end). The first day of a block starts afresh: at most BLOCK_DAYS - 1 generations to rebuild a day's memory.

import { createRandom, dailySeed, deriveSeed, randomTools } from "../utils/random.js";
import { GRID_COLS, GRID_ROWS, planLayout } from "./layout.js";
import { SPECS } from "./modules/specs.js";

// The rules every mission obeys. Load is the sum of the modules' `load`: what one player can reasonably keep up
// with at once. To be tuned by playtesting.
export const MISSION_LIMITS = { minModules: 3, maxModules: 5, maxVoice: 1, maxContinuous: 2, targetLoad: 9, maxLoad: 11 };
// How often a day gets a mission of 3, 4 or 5 systems: drawn first, so that small missions (where one big system
// can take the board) really happen instead of always losing to five small ones.
export const SIZE_WEIGHTS = { 3: 0.15, 4: 0.35, 5: 0.5 };
// The rotation rules (see above).
export const ROTATION = { maxStreak: 3, maxThirdDayModules: 1, competenceGapDays: 2, blockDays: 28, anchorDay: "2026-10-04" };
// Variants of the same system never fly together.
const familyOf = (id) => SPECS[id].family ?? id;
const ATTEMPTS = 24;
// A module that has waited this many times its natural period is overdue and gets planted on the board.
const OVERDUE_NEED = 1.5;
const TASK_ORDER = { continuous: 0, event: 1, opportunistic: 2 };
// Archive missions (Mission Mode) are the missions of days before the first real daily mission, so they can
// never reveal an upcoming one.
export const ARCHIVE_RANGE = { from: "2024-01-01", to: "2026-08-31" };
const DAY_MS = 86400000;
const dayNumber = (dayKey) => Math.round(Date.parse(`${dayKey}T00:00:00Z`) / DAY_MS);
const dayKeyOf = (number) => new Date(number * DAY_MS).toISOString().slice(0, 10);
const cellsOf = (spec) => spec.blocks.reduce((sum, block) => sum + block.h * block.w, 0);

// Placing blocks is the expensive step and the same sets come back all the time (the greedy build tries every
// candidate against the modules already chosen, and a day's memory is rebuilt from its block's start), so every
// layout is computed once per set of modules.
const layoutCache = new Map();
export function layoutFor(moduleIds) {
  const key = [...moduleIds].sort().join("+");
  if (!layoutCache.has(key)) {
    const specs = moduleIds.map((id) => SPECS[id]);
    layoutCache.set(key, specs.reduce((sum, spec) => sum + cellsOf(spec), 0) > GRID_COLS * GRID_ROWS ? null : planLayout(specs));
  }
  return layoutCache.get(key);
}

// The rules every mission obeys, whether generated or hand-picked. Returns a short message, or null when fine.
// `withLayout: false` skips the (expensive) board placement, for the quick checks while a mission is being built.
export function missionProblem(moduleIds, { withLayout = true } = {}) {
  if (moduleIds.some((id) => !SPECS[id])) return "Unknown module.";
  const modules = moduleIds.map((id) => SPECS[id]);
  if (!modules.length) return "Pick at least one module.";
  if (new Set(moduleIds).size < moduleIds.length) return "The same module twice.";
  if (new Set(moduleIds.map(familyOf)).size < moduleIds.length) return "Two versions of the same module.";
  if (modules.filter((module) => module.voice).length > MISSION_LIMITS.maxVoice) return "Only one voice module at a time.";
  if (modules.filter((module) => module.task === "continuous").length > MISSION_LIMITS.maxContinuous) return "At most two continuous modules.";
  if (modules.reduce((sum, module) => sum + module.load, 0) > MISSION_LIMITS.maxLoad) return "Too much to handle at once.";
  if (modules.reduce((sum, module) => sum + cellsOf(module), 0) > GRID_COLS * GRID_ROWS) return "These modules don't fit on one screen.";
  if (withLayout && !layoutFor(moduleIds)) return "These modules don't fit on one screen.";
  return null;
}

// How much each competence weighs in a mission: a module counts for its load, fully for its main competence and
// partly for its secondary ones. Returns [{ competence, share }] sorted by share, shares summing to 1.
export function competenceShares(moduleIds) {
  const weights = {};
  moduleIds.map((id) => SPECS[id]).forEach((module) => {
    weights[module.competence] = (weights[module.competence] ?? 0) + module.load;
    module.secondary.forEach((key) => { weights[key] = (weights[key] ?? 0) + module.load * 0.4; });
  });
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.entries(weights).map(([competence, weight]) => ({ competence, share: weight / total })).sort((a, b) => b.share - a.share);
}

// Continuous modules first, then events, then the "when you have time" ones: the order they are briefed in.
export function briefingOrder(moduleIds) {
  return [...moduleIds].sort((a, b) => TASK_ORDER[SPECS[a].task] - TASK_ORDER[SPECS[b].task]);
}

// A module's natural period, in days: how often it would fly if everything were even. Big systems fill the
// board on their own, so they come round less often than small ones; a spec may set its own `period` instead.
export function naturalPeriod(spec) {
  return spec.period ?? Math.max(4, Math.min(10, Math.round(3 + cellsOf(spec) / 3)));
}

// What the days before tell us: for each module, how many days in a row it has just flown and how long ago it
// (or a variant of it) last flew; for each competence, how long since it was last on board. `history` lists the
// missions of the previous days, oldest first.
export function rotationState(history) {
  const lastFlown = {};
  const lastCompetence = {};
  history.forEach((mission, index) => {
    const daysAgo = history.length - index;
    mission.moduleIds.forEach((id) => { lastFlown[familyOf(id)] = daysAgo; lastCompetence[SPECS[id].competence] = daysAgo; });
  });
  const streak = (id) => {
    let count = 0;
    for (let index = history.length - 1; index >= 0 && history[index].moduleIds.includes(id); index -= 1) count += 1;
    return count;
  };
  const streaks = Object.fromEntries(Object.keys(SPECS).map((id) => [id, streak(id)]));
  // The need of a module: the days it has waited, relative to its natural period (a module that never flew, or
  // when there is no history yet, is simply "due").
  const need = (id) => {
    const spec = SPECS[id];
    const waited = lastFlown[familyOf(id)] ?? naturalPeriod(spec) * 2;
    return waited / naturalPeriod(spec);
  };
  const competences = [...new Set(Object.values(SPECS).map((spec) => spec.competence))];
  const required = history.length >= ROTATION.competenceGapDays ? competences.filter((competence) => (lastCompetence[competence] ?? Infinity) > ROTATION.competenceGapDays) : [];
  return { streaks, need, required, lastFlown };
}

// The rotation rules a mission must obey given the days before it. Returns a short message, or null when fine.
export function rotationProblem(moduleIds, history) {
  const { streaks, required } = rotationState(history);
  if (moduleIds.some((id) => streaks[id] >= ROTATION.maxStreak)) return "A module would fly too many days in a row.";
  if (moduleIds.filter((id) => streaks[id] === ROTATION.maxStreak - 1).length > ROTATION.maxThirdDayModules) return "Too many modules repeating from the days before.";
  const competences = new Set(moduleIds.map((id) => SPECS[id].competence));
  const missing = required.filter((competence) => !competences.has(competence));
  if (missing.length) return `Missing a competence that is due: ${missing.join(", ")}.`;
  return null;
}

function scoreMission(moduleIds, state) {
  const modules = moduleIds.map((id) => SPECS[id]);
  const layout = layoutFor(moduleIds);
  const cells = modules.reduce((sum, module) => sum + cellsOf(module), 0);
  const competences = new Set(modules.map((module) => module.competence));
  const need = moduleIds.reduce((sum, id) => sum + Math.min(3, state.need(id)), 0) / moduleIds.length;
  // Well filled (few holes in the rows it uses, and a good share of the screen), different competences when there
  // is room for them, and modules that have waited (the average need, so a mission of three due systems can beat
  // a mission of five fresh ones).
  return (cells / (layout.rows * GRID_COLS)) * 3 + (cells / (GRID_ROWS * GRID_COLS)) * 2 + competences.size * 0.6 + need * 1.5;
}

// Same seed and same days before → same mission, on every phone. `history` lists the missions of the previous
// days, oldest first (empty on the first day).
const missionCache = new Map();
export function generateMission(seed, history = []) {
  // A day's memory is rebuilt from its block's start, so the same (seed, memory) pairs come back: remembered.
  const cacheKey = `${seed}|${history.map((mission) => mission.moduleIds.join(",")).join(";")}`;
  if (missionCache.has(cacheKey)) return missionCache.get(cacheKey);
  const mission = buildMission(seed, history);
  missionCache.set(cacheKey, mission);
  return mission;
}
function buildMission(seed, history) {
  const rnd = randomTools(createRandom(deriveSeed(seed, "mission")));
  const state = rotationState(history);
  const pool = Object.values(SPECS).filter((spec) => state.streaks[spec.id] < ROTATION.maxStreak);
  // While building, only the cheap rules are checked; the board placement is checked once per attempt.
  const fits = (chosen, spec) => !missionProblem([...chosen, spec.id], { withLayout: false }) && !rotationTooRepetitive([...chosen, spec.id], state);
  const weightedPick = (candidates) => {
    const weights = candidates.map((spec) => 0.3 + Math.min(3, state.need(spec.id)));
    let roll = rnd.random() * weights.reduce((sum, weight) => sum + weight, 0);
    for (let index = 0; index < candidates.length; index += 1) { roll -= weights[index]; if (roll < 0) return candidates[index]; }
    return candidates.at(-1);
  };
  // The knapsack step: modules that have waited well past their period are planted first, one per attempt in
  // turn, and the board is filled around them.
  const overdue = pool.filter((spec) => state.need(spec.id) >= OVERDUE_NEED).sort((a, b) => state.need(b.id) - state.need(a.id));
  // The day's size comes first; every attempt then builds a mission of that size (one short when nothing more fits).
  const sizes = Object.keys(SIZE_WEIGHTS).map(Number);
  let roll = rnd.random() * sizes.reduce((sum, size) => sum + SIZE_WEIGHTS[size], 0);
  const wanted = sizes.find((size) => { roll -= SIZE_WEIGHTS[size]; return roll < 0; }) ?? sizes.at(-1);
  let best = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const chosen = [];
    if (overdue.length && attempt % 2 === 0) { const planted = overdue[(attempt / 2) % overdue.length]; if (fits(chosen, planted)) chosen.push(planted.id); }
    // The competences that are due go first, then a competence not yet on board when there is room for one,
    // then whatever still fits; each pick favours the modules that have waited longest.
    while (chosen.length < wanted) {
      const onBoard = new Set(chosen.map((id) => SPECS[id].competence));
      const candidates = pool.filter((spec) => !chosen.includes(spec.id) && fits(chosen, spec));
      if (!candidates.length) break;
      const due = candidates.filter((spec) => state.required.includes(spec.competence) && !onBoard.has(spec.competence));
      const fresh = candidates.filter((spec) => !onBoard.has(spec.competence));
      const pick = weightedPick(due.length ? due : fresh.length && rnd.chance(0.85) ? fresh : candidates);
      chosen.push(pick.id);
    }
    if (chosen.length < Math.max(MISSION_LIMITS.minModules, wanted - 1) || rotationProblem(chosen, history)) continue;
    // The blocks must really fit on the board; a set that does not is dropped (its modules usually come back in
    // another attempt, in another combination).
    if (!layoutFor(chosen)) continue;
    const score = scoreMission(chosen, state);
    if (!best || score > best.score) best = { score, moduleIds: chosen };
  }
  // No attempt satisfied the rotation (a crowded history): fall back to the rules of the board alone.
  if (!best) return buildMission(seed, []);
  return { seed, moduleIds: briefingOrder(best.moduleIds) };
}
function rotationTooRepetitive(moduleIds, state) {
  return moduleIds.filter((id) => state.streaks[id] === ROTATION.maxStreak - 1).length > ROTATION.maxThirdDayModules;
}

// The missions of the days a given day remembers: the days of its block before it, oldest first. Regenerated,
// not stored, so the result is the same on every phone.
export function missionHistory(dayKey) {
  const day = dayNumber(dayKey);
  const anchor = dayNumber(ROTATION.anchorDay);
  const blockStart = anchor + Math.floor((day - anchor) / ROTATION.blockDays) * ROTATION.blockDays;
  const history = [];
  for (let current = blockStart; current < day; current += 1) {
    const key = dayKeyOf(current);
    history.push({ dayKey: key, moduleIds: generateMission(dailySeed(key), history).moduleIds });
  }
  return history;
}

// The mission of a day: its seed, its modules and its durations.
export function missionForDay(dayKey) {
  const seed = dailySeed(dayKey);
  const mission = generateMission(seed, missionHistory(dayKey));
  return { seed, dayKey, moduleIds: mission.moduleIds, durations: missionDurations(seed, mission.moduleIds.length) };
}

// The two lengths of the daily mission. A mission with more systems lasts longer (they come in one at a time, so
// each needs its share of the flight), inside each format's range, with a small day-to-day variation (the same
// for everyone).
export const FORMATS = [
  { key: "short", label: "SHORT", baseSeconds: 90, secondsPerModule: 18, minSeconds: 120, maxSeconds: 180 },
  { key: "regular", label: "REGULAR", baseSeconds: 200, secondsPerModule: 30, minSeconds: 300, maxSeconds: 360 },
];
export function missionDurations(seed, moduleCount) {
  const rnd = randomTools(createRandom(deriveSeed(seed, "durations")));
  return Object.fromEntries(FORMATS.map((format) => {
    const seconds = format.baseSeconds + format.secondsPerModule * moduleCount + rnd.int(-3, 3) * 5;
    return [format.key, Math.max(format.minSeconds, Math.min(format.maxSeconds, Math.round(seconds / 5) * 5)) * 1000];
  }));
}

// An archive mission for Mission Mode: a day of the archive range picked from `seed` (the screen draws the seed
// with randomSeed()), and that day's mission exactly as it was.
export function archiveMission(seed) {
  const from = Date.parse(`${ARCHIVE_RANGE.from}T00:00:00Z`);
  const to = Date.parse(`${ARCHIVE_RANGE.to}T00:00:00Z`);
  const days = Math.round((to - from) / DAY_MS) + 1;
  const date = new Date(from + randomTools(createRandom(deriveSeed(seed, "archive"))).int(0, days - 1) * DAY_MS);
  const day = { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
  const dayKey = `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
  return { ...missionForDay(dayKey), day };
}

// Development only: lets the test tooling generate missions from the browser console. (`__DEV__` only exists in
// the app's bundler; plain Node, where the tests run, has no such global.)
if (typeof __DEV__ !== "undefined" && __DEV__) globalThis.__missionGenerator = { generateMission, missionForDay, missionHistory, archiveMission, missionProblem, rotationProblem, competenceShares, planLayout, SPECS, dailySeed };
