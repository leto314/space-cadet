// Deterministic randomness: the same seed always produces the same sequence, on every device. This is what lets
// every player get the exact same daily mission (and lets a past mission be replayed from its seed).

// FNV-1a: turns any string into a 32-bit seed.
export function hashString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// mulberry32: small, fast, good enough for gameplay. Returns a Math.random-like function.
export function createRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Derives an independent stream (e.g. one per mission module) from a parent seed.
export function deriveSeed(seed, label) {
  return hashString(`${seed}:${label}`);
}

// Everyone switches to the next daily content at the same moment: midnight in France (Europe/Paris, CET/CEST).
// Pass a trusted UTC timestamp (see trustedTime.js), never the phone's own clock.
function parisOffsetMinutes(utcMs) {
  const year = new Date(utcMs).getUTCFullYear();
  // EU summer time runs from the last Sunday of March to the last Sunday of October, switching at 01:00 UTC.
  const lastSunday = (month) => {
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    return Date.UTC(year, month, lastDay.getUTCDate() - lastDay.getUTCDay(), 1);
  };
  return utcMs >= lastSunday(2) && utcMs < lastSunday(9) ? 120 : 60;
}

export function missionDay(utcMs) {
  const paris = new Date(utcMs + parisOffsetMinutes(utcMs) * 60000);
  const year = paris.getUTCFullYear();
  const month = paris.getUTCMonth();
  const day = paris.getUTCDate();
  return { key: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`, year, month, day };
}

export function dailySeed(dayKey) {
  return hashString(`space-cadet:${dayKey}`);
}

export function randomTools(random) {
  const int = (min, max) => Math.floor(random() * (max - min + 1)) + min;
  const float = (min, max) => min + random() * (max - min);
  const item = (items) => items[Math.floor(random() * items.length)];
  const chance = (probability) => random() < probability;
  const shuffle = (items) => {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index -= 1) { const swapIndex = Math.floor(random() * (index + 1)); [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]; }
    return copy;
  };
  return { random, int, float, item, chance, shuffle };
}

// Draws a question that has not been asked yet in this session: calls `draw()` until `keyOf` gives a key not in
// `seen` (the set of keys asked so far), records that key and returns the question. When every try comes back
// already asked, the pool is used up: `seen` starts over from this question, so repeats only come once
// everything has been asked. Draws only consume randomness when they are made, so a session without repeats is
// exactly the one it was before.
export function drawFresh(draw, keyOf, seen, attempts = 200) {
  let item = draw();
  for (let attempt = 1; attempt < attempts && seen.has(keyOf(item)); attempt += 1) item = draw();
  if (seen.has(keyOf(item))) seen.clear();
  seen.add(keyOf(item));
  return item;
}

// A fresh seed for a free (Full Clearance) session: the one place where the app draws on Math.random. Games never
// call Math.random themselves; they pass a seed to their logic, so any session can be rebuilt from its seed.
export function randomSeed() {
  return Math.floor(Math.random() * 4294967296);
}
