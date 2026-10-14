// Shapes of everything the app records (see STATS.md). The same shapes will become the Supabase tables, so the
// local data can simply be uploaded once accounts exist. Bump SCHEMA_VERSION whenever a shape changes.

export const SCHEMA_VERSION = 1;
// Per-trial details are kept, but capped, so a long session never weighs more than a few kilobytes.
export const MAX_TRIALS = 200;

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// One played game: daily training, or a free Full Clearance session (never counted in the radar).
//   source       "daily" | "clearance"
//   dayKey       "YYYY-MM-DD" (Paris day from trusted time, see utils/random.js)
//   gameKey      e.g. "cube-nets" (data/exercises.js)
//   competence   e.g. "spatial"
//   tier         "simple" | "standard" | "experienced" | null (adaptive games)
//   seed         the content seed, so the exact same session can be rebuilt
//   settings     the game settings (Full Clearance), or the daily variant
//   score        0–1000 for daily games, null when a game has no score yet
//   metrics      the game's summary numbers (accuracy, meanRtMs, falseAlarms, levelReached…)
//   trials       optional compact per-trial list, e.g. [{ ok: 1, rt: 640 }], at most MAX_TRIALS
export function sessionRecord({ source, dayKey, gameKey, competence, tier = null, seed = null, settings = {}, startedAt, endedAt, completed = true, score = null, metrics = {}, trials = null }) {
  return {
    kind: "session",
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    source, dayKey, gameKey, competence, tier, seed, settings,
    startedAt, durationMs: Math.max(0, endedAt - startedAt), completed,
    score, metrics,
    trials: trials ? trials.slice(0, MAX_TRIALS) : null,
  };
}

// One flown mission: the daily mission, or a Mission Mode flight (never counted in the cadet score).
//   source   "daily" | "mode"
//   format   "short" | "regular" (daily), null (Mission Mode)
//   score    0–1000 for the whole mission
//   modules  [{ moduleId, competence, share, performance (0–1), points, metrics }]
export function missionRecord({ source, dayKey, format = null, seed, moduleIds, durationMs, progressive, startedAt, endedAt, completed = true, score, modules }) {
  return {
    kind: "mission",
    id: newId(),
    schemaVersion: SCHEMA_VERSION,
    source, dayKey, format, seed, moduleIds, durationMs, progressive,
    startedAt, flownMs: Math.max(0, endedAt - startedAt), completed,
    score, modules,
  };
}

// One competence's state after a day of training, kept day by day so the radar can show any period.
export function competencePoint({ competence, dayKey, score, days, todayScore, tier }) {
  return { kind: "competence", competence, dayKey, score, days, todayScore, tier };
}

// The day's cadet points, from training and from the mission.
export function cadetDay({ dayKey, trainingPoints = 0, missionPoints = 0 }) {
  return { kind: "cadet-day", dayKey, trainingPoints, missionPoints, total: trainingPoints + missionPoints };
}
