// Landing Order: the logic. Pure JavaScript (no React, no React Native): the scenarios (a hidden landing order,
// a minimal set of true clues, one question), the daily progression and the results. Every generator takes
// `random` (a Math.random-like function, see utils/random.js) so the same seed always gives the same scenarios.

import { createRandom, deriveSeed } from "../../utils/random.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const CALLSIGNS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliett", "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango", "Uniform", "Victor", "Whiskey", "X-ray", "Yankee", "Zulu"];
const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth"];
const ORDINAL_SHORT = ["1st", "2nd", "3rd", "4th", "5th", "6th"];
const NUMBER_WORDS = ["no", "one", "two", "three", "four"];
const MIN_CLUES = { 3: 2, 4: 3, 5: 3, 6: 4 };
const MAX_CLUES = { 3: 4, 4: 5, 5: 6, 6: 7 };
const GENERATION_ATTEMPTS = 400;

const permutationCache = {};
// Every possible landing order for n aircraft, stored as position arrays (pos[aircraft] = landing slot).
function allPositions(count) {
  if (permutationCache[count]) return permutationCache[count];
  const orders = [];
  const walk = (prefix, rest) => {
    if (!rest.length) { orders.push(prefix); return; }
    rest.forEach((value, index) => walk([...prefix, value], [...rest.slice(0, index), ...rest.slice(index + 1)]));
  };
  walk([], Array.from({ length: count }, (_, index) => index));
  permutationCache[count] = orders.map((order) => { const pos = []; order.forEach((aircraft, slot) => { pos[aircraft] = slot; }); return pos; });
  return permutationCache[count];
}

function makeRandomTools(random) {
  const int = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const item = (items) => items[Math.floor(random() * items.length)];
  const shuffle = (items) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) { const swapIndex = Math.floor(random() * (index + 1)); [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]; }
    return copy;
  };
  return { int, item, shuffle };
}

// Each maker reads the hidden order and returns a TRUE clue: a sentence template with {A}/{B}/{C} slots, the
// aircraft filling them, a `test` over any candidate order, and a `key` so the same fact is never given twice.
const CLUE_MAKERS = [
  { weight: 3, make: ({ pos, pick, rnd }) => {
    const [a, b] = pick(2).sort((x, y) => pos[x] - pos[y]);
    return { key: `before:${a}:${b}`, template: rnd.item(["{A} lands before {B}.", "{B} lands after {A}.", "{A} lands earlier than {B}.", "{B} lands later than {A}."]), actors: { A: a, B: b }, test: (p) => p[a] < p[b] };
  } },
  { weight: 2, make: ({ order, count, rnd }) => {
    const slot = rnd.int(0, count - 2); const a = order[slot]; const b = order[slot + 1];
    return { key: `next:${a}:${b}`, template: rnd.item(["{B} lands right after {A}.", "{A} lands immediately before {B}."]), actors: { A: a, B: b }, test: (p) => p[b] === p[a] + 1 };
  } },
  { weight: 1, make: ({ order, count, rnd }) => {
    const last = rnd.int(0, 1) === 1; const a = order[last ? count - 1 : 0]; const slot = last ? count - 1 : 0;
    return { key: `at:${a}:${slot}`, template: last ? "{A} is the last to land." : "{A} lands first.", actors: { A: a }, test: (p) => p[a] === slot };
  } },
  { weight: 2, make: ({ pos, count, pick, rnd }) => {
    const [a] = pick(1);
    const edges = [0, count - 1].filter((slot) => slot !== pos[a]);
    const others = Array.from({ length: count }, (_, slot) => slot).filter((slot) => slot !== pos[a]);
    const slot = edges.length && rnd.int(0, 9) < 7 ? rnd.item(edges) : rnd.item(others);
    const template = slot === count - 1 ? "{A} is not the last to land." : `{A} does not land ${ORDINALS[slot]}.`;
    return { key: `notat:${a}:${slot}`, template, actors: { A: a }, test: (p) => p[a] !== slot };
  } },
  { weight: 2, minCount: 3, make: ({ pos, pick }) => {
    const [b, a, c] = pick(3).sort((x, y) => pos[x] - pos[y]);
    return { key: `between:${a}:${b}:${c}`, template: "{A} lands after {B} but before {C}.", actors: { A: a, B: b, C: c }, test: (p) => p[b] < p[a] && p[a] < p[c] };
  } },
  { weight: 1.5, minCount: 3, make: ({ pos, pick }) => {
    const [a, b] = pick(2); const gap = Math.abs(pos[a] - pos[b]) - 1;
    if (gap < 1 || gap > 2) return null;
    return { key: `gap:${Math.min(a, b)}:${Math.max(a, b)}`, template: `Exactly ${NUMBER_WORDS[gap]} aircraft ${gap === 1 ? "lands" : "land"} between {A} and {B}.`, actors: { A: a, B: b }, test: (p) => Math.abs(p[a] - p[b]) - 1 === gap };
  } },
  { weight: 1, make: ({ order, count, rnd }) => {
    const slot = rnd.int(0, count - 2); const [a, b] = rnd.shuffle([order[slot], order[slot + 1]]);
    return { key: `adj:${Math.min(a, b)}:${Math.max(a, b)}`, template: "{A} and {B} land one after the other.", actors: { A: a, B: b }, test: (p) => Math.abs(p[a] - p[b]) === 1 };
  } },
  { weight: 1, minCount: 4, make: ({ pos, pick }) => {
    const [a, b] = pick(2);
    if (Math.abs(pos[a] - pos[b]) === 1) return null;
    return { key: `adj:${Math.min(a, b)}:${Math.max(a, b)}`, template: "{A} and {B} do not land one after the other.", actors: { A: a, B: b }, test: (p) => Math.abs(p[a] - p[b]) !== 1 };
  } },
  { weight: 1, minCount: 4, make: ({ pos, pick, rnd }) => {
    const trio = pick(3).sort((x, y) => pos[x] - pos[y]); const latest = rnd.int(0, 1) === 1;
    const a = latest ? trio[2] : trio[0]; const [b, c] = rnd.shuffle(latest ? trio.slice(0, 2) : trio.slice(1));
    return latest
      ? { key: `afterboth:${a}:${Math.min(b, c)}:${Math.max(b, c)}`, template: "{A} lands after both {B} and {C}.", actors: { A: a, B: b, C: c }, test: (p) => p[a] > p[b] && p[a] > p[c] }
      : { key: `beforeboth:${a}:${Math.min(b, c)}:${Math.max(b, c)}`, template: "{A} lands before both {B} and {C}.", actors: { A: a, B: b, C: c }, test: (p) => p[a] < p[b] && p[a] < p[c] };
  } },
];

function aircraftOptions(names, exclude = -1) { return names.map((name, index) => ({ value: index, label: name })).filter((option) => option.value !== exclude); }

const QUESTION_MAKERS = [
  { weight: 3, make: ({ count, names, rnd }) => {
    const slot = rnd.int(0, count - 1);
    const template = slot === 0 ? "Which aircraft lands first?" : slot === count - 1 ? "Which aircraft lands last?" : `Which aircraft lands ${ORDINALS[slot]}?`;
    return { type: "aircraft-at", template, actors: {}, options: aircraftOptions(names), answerOf: (p) => p.indexOf(slot) };
  } },
  { weight: 2, make: ({ count, pick }) => {
    const [a] = pick(1);
    return { type: "position-of", template: "In which position does {A} land?", actors: { A: a }, options: ORDINAL_SHORT.slice(0, count).map((label, value) => ({ value, label })), answerOf: (p) => p[a] };
  } },
  { weight: 2, make: ({ pos, count, names, pick }) => {
    const [a] = pick(1);
    if (pos[a] === count - 1) return null;
    return { type: "next-after", template: "Which aircraft lands right after {A}?", actors: { A: a }, options: aircraftOptions(names, a), answerOf: (p) => p.indexOf(p[a] + 1) };
  } },
  { weight: 1, minCount: 4, make: ({ count, pick }) => {
    const [a, b] = pick(2);
    return { type: "gap-count", template: "How many aircraft land between {A} and {B}?", actors: { A: a, B: b }, options: Array.from({ length: count - 1 }, (_, value) => ({ value, label: String(value) })), answerOf: (p) => Math.abs(p[a] - p[b]) - 1 };
  } },
];

function weightedMaker(makers, count, rnd) {
  const usable = makers.filter((maker) => !maker.minCount || count >= maker.minCount);
  let roll = rnd.int(0, 999) / 1000 * usable.reduce((sum, maker) => sum + maker.weight, 0);
  for (const maker of usable) { roll -= maker.weight; if (roll < 0) return maker; }
  return usable.at(-1);
}

function answersFor(candidates, question) { return new Set(candidates.map(question.answerOf)); }
function candidatesFor(clues, count) { return allPositions(count).filter((p) => clues.every((clue) => clue.test(p))); }

// Adds true clues until the question has exactly one possible answer, then strips every clue that isn't needed.
// The result is a minimal clue set: each clue is necessary, so no single clue ever gives the answer away.
// `random` is a seeded generator (the mission module draws several scenarios from one stream; the sessions
// below give each scenario its own).
export function buildScenario(count, random) {
  const rnd = makeRandomTools(random);
  for (let attempt = 0; attempt < GENERATION_ATTEMPTS; attempt += 1) {
    const names = rnd.shuffle(CALLSIGNS).slice(0, count).sort();
    const order = rnd.shuffle(names.map((_, index) => index));
    const pos = []; order.forEach((aircraft, slot) => { pos[aircraft] = slot; });
    const context = { pos, order, count, names, rnd, pick: (size) => rnd.shuffle(names.map((_, index) => index)).slice(0, size) };
    const question = weightedMaker(QUESTION_MAKERS, count, rnd).make(context);
    if (!question) continue;

    let clues = [];
    let candidates = allPositions(count);
    const keys = new Set();
    for (let tries = 0; tries < 60 && answersFor(candidates, question).size > 1; tries += 1) {
      const clue = weightedMaker(CLUE_MAKERS, count, rnd).make(context);
      if (!clue || keys.has(clue.key)) continue;
      const narrowed = candidates.filter(clue.test);
      if (narrowed.length === candidates.length) continue;
      keys.add(clue.key); clues.push(clue); candidates = narrowed;
    }
    if (answersFor(candidates, question).size !== 1) continue;

    for (const clue of rnd.shuffle(clues)) {
      const without = clues.filter((entry) => entry !== clue);
      if (answersFor(candidatesFor(without, count), question).size === 1) clues = without;
    }
    if (clues.length < MIN_CLUES[count] || clues.length > MAX_CLUES[count]) continue;
    return { names, pos, question, answer: question.answerOf(pos), clues: rnd.shuffle(clues) };
  }
  return null;
}

// Whether a question's options are aircraft names (false) or numbers (true).
export function isNumericQuestion(question) { return question.type !== "aircraft-at" && question.type !== "next-after"; }

function scenarioFromSeed({ aircraftCount, memorise }, seed, index) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const scenario = buildScenario(aircraftCount, createRandom(deriveSeed(seed, `scenario-${index}:${attempt}`)));
    if (scenario) return { ...scenario, aircraftCount, memorise };
  }
  return null;
}

// A Full Clearance session: `scenarioCount` scenarios of `aircraftCount` aircraft, from a seed.
export function buildSession({ aircraftCount, scenarioCount, memorise }, seed) {
  return Array.from({ length: scenarioCount }, (_, index) => scenarioFromSeed({ aircraftCount, memorise }, seed, index)).filter(Boolean);
}

// Daily training: eight scenarios for everyone, more aircraft as they go: six with the briefing on screen
// (3, 4, 4, 5, 5, 6 aircraft), then two to memorise before the question appears (4, then 5 aircraft).
// 125 points per right answer.
export const DAILY_SCENARIOS = [
  { aircraftCount: 3, memorise: false }, { aircraftCount: 4, memorise: false }, { aircraftCount: 4, memorise: false },
  { aircraftCount: 5, memorise: false }, { aircraftCount: 5, memorise: false }, { aircraftCount: 6, memorise: false },
  { aircraftCount: 4, memorise: true }, { aircraftCount: 5, memorise: true },
];
export const DAILY_POINTS_PER_SCENARIO = 1000 / DAILY_SCENARIOS.length;
export function buildDailySession(seed) {
  return DAILY_SCENARIOS.map((settings, index) => scenarioFromSeed(settings, seed, index)).filter(Boolean);
}

// The daily result from the answers ([{ correct, timeMs, clues, questionType, aircraftCount, memorise }]): a
// score out of 1000 (125 per right answer), the metrics recorded, and the compact trial list.
export function dailyResult(entries) {
  const correct = entries.filter((entry) => entry.correct);
  return {
    score: clamp(Math.round((correct.length / entries.length) * 1000), 0, 1000),
    metrics: {
      correct: correct.length, scenarios: entries.length,
      visibleCorrect: correct.filter((entry) => !entry.memorise).length, memorisedCorrect: correct.filter((entry) => entry.memorise).length,
      meanAnswerMs: entries.length ? Math.round(entries.reduce((sum, entry) => sum + entry.timeMs, 0) / entries.length) : 0,
      cluesRead: entries.reduce((sum, entry) => sum + entry.clues, 0),
    },
    trials: entries.map((entry) => ({ ok: entry.correct ? 1 : 0, ms: entry.timeMs, aircraft: entry.aircraftCount, clues: entry.clues, question: entry.questionType, memorise: entry.memorise ? 1 : 0 })),
  };
}
