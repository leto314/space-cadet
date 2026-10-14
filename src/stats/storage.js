// Local stats storage for the test phase (see STATS.md), on AsyncStorage (localStorage on the web). Everything
// goes through `backend`, so moving to Supabase later changes nothing else.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { COMPETENCES, trainingPoints as computeTrainingPoints, updateCompetence } from "./formulas";
import { cadetDay, competencePoint } from "./records";

// Until accounts exist, everything recorded on this device belongs to this test profile; records carry it so
// they can be attached to the right account when they are uploaded.
export const LOCAL_PLAYER = "leo314";
const KEY = `space-cadet:stats:v1:${LOCAL_PLAYER}`;
const backend = { get: (key) => AsyncStorage.getItem(key), set: (key, value) => AsyncStorage.setItem(key, value) };

const empty = () => ({ sessions: [], missions: [], competences: [], cadetDays: [] });
let cache = null;

async function load() {
  if (cache) return cache;
  try { cache = { ...empty(), ...JSON.parse((await backend.get(KEY)) ?? "{}") }; } catch { cache = empty(); }
  return cache;
}
async function save() { await backend.set(KEY, JSON.stringify(cache)); }

export async function saveSession(record) {
  const data = await load();
  record.playerId = LOCAL_PLAYER;
  data.sessions.push(record);
  await save();
  return record;
}
export async function saveMission(record) {
  const data = await load();
  record.playerId = LOCAL_PLAYER;
  data.missions.push(record);
  await save();
  return record;
}

// The latest state of each competence: { [competence]: { score, days, dayKey } } (score null if never trained).
export async function competenceStates() {
  const data = await load();
  return Object.fromEntries(COMPETENCES.map((competence) => {
    const last = data.competences.filter((point) => point.competence === competence).at(-1);
    return [competence, last ? { score: last.score, days: last.days, dayKey: last.dayKey } : { score: null, days: 0, dayKey: null }];
  }));
}

// Applies one daily game to its competence (once per competence per day: later sessions that day are ignored)
// and refreshes the day's training points. Returns the new competence point, or null if already counted.
export async function applyDailyGame({ dayKey, competence, score, tier }) {
  const data = await load();
  const history = data.competences.filter((point) => point.competence === competence);
  if (history.some((point) => point.dayKey === dayKey)) return null;
  const last = history.at(-1);
  const next = updateCompetence(last ? { score: last.score, days: last.days } : { score: 0, days: 0 }, score, tier ?? "standard");
  const point = competencePoint({ competence, dayKey, score: next.score, days: next.days, todayScore: score, tier });
  data.competences.push(point);
  const games = data.competences.filter((entry) => entry.dayKey === dayKey).map((entry) => ({ score: entry.todayScore, tier: entry.tier ?? "standard" }));
  setCadetDay(data, dayKey, { trainingPoints: computeTrainingPoints(games) });
  await save();
  return point;
}

// Records the day's mission points (the first daily mission of the day only).
export async function applyDailyMission({ dayKey, points }) {
  const data = await load();
  const day = data.cadetDays.find((entry) => entry.dayKey === dayKey);
  if (day && day.missionPoints) return null;
  setCadetDay(data, dayKey, { missionPoints: points });
  await save();
  return points;
}

function setCadetDay(data, dayKey, change) {
  const index = data.cadetDays.findIndex((entry) => entry.dayKey === dayKey);
  const current = index >= 0 ? data.cadetDays[index] : { trainingPoints: 0, missionPoints: 0 };
  const next = cadetDay({ dayKey, ...current, ...change });
  if (index >= 0) data.cadetDays[index] = next; else data.cadetDays.push(next);
}

export async function cadetScore() {
  const data = await load();
  return data.cadetDays.reduce((sum, day) => sum + day.total, 0);
}

// Sessions of one game, oldest first (optionally only one source: "daily" or "clearance").
export async function sessionsOf(gameKey, source = null) {
  const data = await load();
  return data.sessions.filter((session) => session.gameKey === gameKey && (!source || session.source === source));
}

export async function allData() { return load(); }
export async function clearAll() { cache = empty(); await save(); }
