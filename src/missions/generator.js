import { createRandom, dailySeed, deriveSeed, randomTools } from "../utils/random";
import { GRID_COLS, GRID_ROWS, planLayout } from "./layout";
import { MODULES } from "./modules";

// Variants of the same module never fly together.
const FAMILY = { "anomaly-lite": "anomaly", "tracking-mini": "tracking", "mini-landing-split": "mini-landing", "codes-voice": "codes", "radio-callsign": "radio" };
const familyOf = (id) => FAMILY[id] ?? id;
const MAX_VOICE = 1;
const MAX_CONTINUOUS = 2;
// Sum of the modules' `load`: what one player can reasonably keep up with at once. To be tuned by playtesting.
const TARGET_LOAD = 9;
const MAX_LOAD = 11;
const ATTEMPTS = 30;
const TASK_ORDER = { continuous: 0, event: 1, opportunistic: 2 };
// Archive missions (Mission Mode) draw their seed from days before the first real daily mission, so they can
// never reveal an upcoming one.
const ARCHIVE_FROM = Date.UTC(2024, 0, 1);
const ARCHIVE_TO = Date.UTC(2026, 7, 31);

// The rules every mission obeys, whether generated or hand-picked. Returns a short message, or null when fine.
export function missionProblem(moduleIds) {
  const modules = moduleIds.map((id) => MODULES[id]);
  if (!modules.length) return "Pick at least one module.";
  if (new Set(moduleIds.map(familyOf)).size < moduleIds.length) return "Two versions of the same module.";
  if (modules.filter((module) => module.voice).length > MAX_VOICE) return "Only one voice module at a time.";
  if (modules.filter((module) => module.task === "continuous").length > MAX_CONTINUOUS) return "At most two continuous modules.";
  if (!planLayout(modules)) return "These modules don't fit on one screen.";
  return null;
}

// How much each competence weighs in a mission: a module counts for its load, fully for its main competence and
// partly for its secondary ones. Returns [{ competence, share }] sorted by share, shares summing to 1.
export function competenceShares(moduleIds) {
  const weights = {};
  moduleIds.map((id) => MODULES[id]).forEach((module) => {
    weights[module.competence] = (weights[module.competence] ?? 0) + module.load;
    module.secondary.forEach((key) => { weights[key] = (weights[key] ?? 0) + module.load * 0.4; });
  });
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0) || 1;
  return Object.entries(weights).map(([competence, weight]) => ({ competence, share: weight / total })).sort((a, b) => b.share - a.share);
}

// Continuous modules first, then events, then the "when you have time" ones: the order they are briefed in.
export function briefingOrder(moduleIds) {
  return [...moduleIds].sort((a, b) => TASK_ORDER[MODULES[a].task] - TASK_ORDER[MODULES[b].task]);
}

function scoreMission(moduleIds) {
  const modules = moduleIds.map((id) => MODULES[id]);
  const layout = planLayout(modules);
  const cells = modules.reduce((sum, module) => sum + module.blocks.reduce((area, block) => area + block.h * block.w, 0), 0);
  const load = modules.reduce((sum, module) => sum + module.load, 0);
  const competences = new Set(modules.map((module) => module.competence));
  // Varied, well filled (few holes in the rows it uses, and a good share of the screen), and close to the target load.
  return competences.size * 2 + (cells / (layout.rows * GRID_COLS)) * 3 + (cells / (GRID_ROWS * GRID_COLS)) * 2 - Math.abs(load - TARGET_LOAD) * 0.8;
}

// Same seed → same mission, on every phone.
export function generateMission(seed) {
  const rnd = randomTools(createRandom(deriveSeed(seed, "mission")));
  const pool = Object.values(MODULES);
  let best = null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    const wanted = rnd.int(3, 5);
    const chosen = [];
    // One module per competence, in a random order of competences, going round again if there is room left.
    const competences = rnd.shuffle([...new Set(pool.map((module) => module.competence))]);
    for (const competence of [...competences, ...competences]) {
      if (chosen.length >= wanted) break;
      const load = chosen.reduce((sum, id) => sum + MODULES[id].load, 0);
      const candidates = rnd.shuffle(pool.filter((module) => module.competence === competence && !chosen.includes(module.id) && load + module.load <= MAX_LOAD && !missionProblem([...chosen, module.id])));
      if (candidates.length) chosen.push(candidates[0].id);
    }
    if (chosen.length < 3) continue;
    const score = scoreMission(chosen);
    if (!best || score > best.score) best = { score, moduleIds: chosen };
  }
  return { seed, moduleIds: briefingOrder(best.moduleIds) };
}

// A random day from the archive range, for Mission Mode.
export function randomArchiveMission() {
  const date = new Date(ARCHIVE_FROM + Math.floor(Math.random() * ((ARCHIVE_TO - ARCHIVE_FROM) / 86400000 + 1)) * 86400000);
  const day = { year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
  const key = `${day.year}-${String(day.month + 1).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
  return { ...generateMission(dailySeed(key)), day };
}

// Development only: lets the test tooling generate missions from the browser console.
if (__DEV__) globalThis.__missionGenerator = { generateMission, missionProblem, competenceShares, planLayout, MODULES, dailySeed };
