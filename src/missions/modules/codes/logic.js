// Access codes: the logic. Pure JavaScript (no React): the two specs (codes shown, codes heard), the traffic
// scripted from the seed, and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

const base = {
  competence: "memory",
  secondary: ["attention"],
  task: "event",
  family: "codes",
  recap: "keep track of your access code",
  blocks: [{ key: "strip", role: "control", h: 1, w: 4, use: "rare" }],
};

export const codesSpec = {
  ...base,
  id: "codes",
  title: "Access codes",
  voice: false,
  load: 2,
  rule: "Codes are sent to several callsigns. Only remember the codes sent to you: each new one replaces the last. From time to time you will be asked for your current code.",
  options: { listen: false },
};

// The audio variant: messages are only heard (every one of them, mine or not), never shown.
export const codesVoiceSpec = {
  ...base,
  id: "codes-voice",
  title: "Radio codes",
  voice: true,
  load: 3,
  rule: "Codes are read out over the radio to several callsigns. Only remember the codes sent to you: each new one replaces the last. Nothing is written down. From time to time you will be asked for your current code.",
  options: { listen: true },
};

const CALLSIGNS = ["ALPHA", "BRAVO", "DELTA", "ECHO", "FOXTROT", "HOTEL", "KILO", "LIMA", "OSCAR", "SIERRA", "TANGO", "VICTOR"];
export const MESSAGE_MS = 4500;
export const QUERY_MS = 10000;
// When the player is asked, as shares of the flight.
export const QUERY_POINTS = [0.42, 0.72, 0.94];
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
export const spell = (code) => code.split("").map((digit) => DIGIT_WORDS[Number(digit)]).join(", ");

const randomCode = (rnd) => Array.from({ length: 4 }, () => rnd.int(0, 9)).join("");
// A decoy looks like the real thing: two digits swapped or one digit changed.
function nearCode(rnd, code) {
  const digits = code.split("");
  if (rnd.chance(0.5)) { const i = rnd.int(0, 2); [digits[i], digits[i + 1]] = [digits[i + 1], digits[i]]; }
  else { const i = rnd.int(0, 3); digits[i] = String((Number(digits[i]) + rnd.int(1, 9)) % 10); }
  const result = digits.join("");
  return result === code ? nearCode(rnd, code) : result;
}

// The whole traffic is scripted from the seed: who is talking to whom, which codes, and when the player is asked.
export function buildContent(spec, seed, { durationMs }) {
  const rnd = randomTools(createRandom(seed));
  const [me, ...others] = rnd.shuffle(CALLSIGNS);
  const events = [];
  let code = randomCode(rnd);
  events.push({ at: 1500, type: "message", to: me, code, mine: true });
  const queryTimes = QUERY_POINTS.map((point) => Math.round(point * durationMs));
  let lastDecoy = nearCode(rnd, code);
  for (let at = 9000; at < durationMs - 3000; at += rnd.int(8000, 13000)) {
    // Keep the strip free while a question is on screen (and don't let a message end right as it appears).
    if (queryTimes.some((time) => at > time - MESSAGE_MS && at < time + QUERY_MS)) continue;
    if (rnd.chance(0.3)) { code = randomCode(rnd); events.push({ at, type: "message", to: me, code, mine: true }); }
    else { lastDecoy = nearCode(rnd, code); events.push({ at, type: "message", to: rnd.item(others), code: lastDecoy, mine: false }); }
  }
  queryTimes.forEach((at) => events.push({ at, type: "query" }));
  events.sort((a, b) => a.at - b.at);
  // Each query offers the current code, plus the codes that could be mistaken for it at that moment.
  let current = null;
  const seen = [];
  events.forEach((event) => {
    if (event.type === "message") { if (event.mine) { if (current) seen.push(current); current = event.code; } else seen.push(event.code); return; }
    const options = new Set([current]);
    [...seen].reverse().forEach((candidate) => { if (options.size < 4) options.add(candidate); });
    while (options.size < 4) options.add(nearCode(rnd, current));
    event.answer = current;
    event.options = rnd.shuffle([...options]);
  });
  return { me, events };
}

// outcomes: one boolean per question asked (true when the right code was picked).
export function emptyStats() { return { outcomes: [] }; }

// Each of the QUERY_POINTS questions is worth a third.
export function moduleResult(spec, stats) {
  const correct = stats.outcomes.filter(Boolean).length;
  return { performance: Math.max(0, Math.min(1, correct / QUERY_POINTS.length)), detail: `${correct}/${QUERY_POINTS.length} codes recalled` };
}

// The flight nobody answered: every question asked within the flight left unanswered.
export function idleStats(spec, script, { durationMs }) {
  return { outcomes: script.events.filter((event) => event.type === "query" && event.at <= durationMs).map(() => false) };
}
