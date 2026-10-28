// Radio calls: the logic. Pure JavaScript (no React): the two specs (single channel, and the callsign variant
// with two channels and calls for other aircraft), the calls scripted from the seed, and the scoring.

import { createRandom, randomTools } from "../../../utils/random.js";

const base = {
  competence: "memory",
  secondary: ["attention"],
  task: "event",
  voice: true,
  family: "radio",
};

export const radioSpec = {
  ...base,
  id: "radio",
  title: "Radio calls",
  load: 3,
  rule: "Listen for radio calls. When a frequency is announced, slide the tuner to it and release. The frequency is only said once.",
  recap: "follow the radio calls",
  blocks: [{ key: "tuner", role: "control", h: 1, w: 4 }],
  options: { channels: 1, callsigns: false },
};

// The MATB-style version: your own callsign, two channels, and calls for other aircraft to ignore.
export const radioCallsignSpec = {
  ...base,
  id: "radio-callsign",
  title: "Radio traffic",
  load: 4,
  rule: "You have a callsign and two radios. Calls are addressed to several aircraft, some with callsigns close to yours. Only when a call is for you, set the named radio (COM 1 or COM 2) to the frequency and release. Following someone else's call counts as an error.",
  recap: "answer your radio calls only",
  blocks: [{ key: "tuner", role: "control", h: 2, w: 4 }],
  options: { channels: 2, callsigns: true },
};

// VHF band excerpt, in 0.5 steps: 118.0 → 127.5 (20 positions, wide enough apart to set precisely by thumb).
export const FREQUENCIES = Array.from({ length: 20 }, (_, index) => 118 + index * 0.5);
export const RESPONSE_WINDOW_MS = 16000;
export const DECOY_COST = 0.15;
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const NAMES = ["ALPHA", "BRAVO", "DELTA", "ECHO", "FOXTROT", "KILO", "LIMA", "OSCAR", "SIERRA", "TANGO"];

export const formatFrequency = (value) => value.toFixed(1);
const spellDigits = (text) => text.split("").map((char) => (char === "." ? "point" : DIGIT_WORDS[Number(char)])).join(" ");
// "121.5" → "one two one point five": digit by digit, the way controllers read frequencies.
const spellFrequency = (value) => spellDigits(formatFrequency(value));
const spellCallsign = ({ name, number }) => `${name.charAt(0)}${name.slice(1).toLowerCase()} ${spellDigits(number)}`;
export const showCallsign = ({ name, number }) => `${name} ${number}`;

// Single channel: every call is for the player. Callsign mode: the player has a callsign and two channels; calls
// also go to look-alike callsigns (same name, digits swapped or another name) and must be ignored.
export function buildContent(spec, seed, { durationMs }) {
  const { channels, callsigns } = spec.options;
  const rnd = randomTools(createRandom(seed));
  const starts = Array.from({ length: channels }, () => rnd.int(2, 17));
  const me = { name: rnd.item(NAMES), number: String(rnd.int(12, 98)) };
  if (me.number[0] === me.number[1]) me.number = `${me.number[0]}${(Number(me.number[1]) + 3) % 10}`;
  const others = [
    { name: me.name, number: `${me.number[1]}${me.number[0]}` },
    { name: rnd.item(NAMES.filter((name) => name !== me.name)), number: me.number },
    { name: me.name, number: String((Number(me.number) + rnd.item([1, 10])) % 100).padStart(2, "0") },
  ];
  const calls = [];
  const previous = [...starts];
  const gaps = callsigns ? [15000, 22000] : [24000, 34000];
  for (let at = rnd.int(7000, 10000); at < durationMs - 10000; at += rnd.int(gaps[0], gaps[1])) {
    const channel = rnd.int(0, channels - 1);
    let target;
    do target = rnd.int(0, FREQUENCIES.length - 1); while (Math.abs(target - previous[channel]) < 2);
    const mine = !callsigns || rnd.chance(0.5);
    const to = mine ? me : rnd.item(others);
    if (mine) previous[channel] = target;
    const address = callsigns ? `${spellCallsign(to)}, set com ${channel + 1} to` : "Radio. Set frequency";
    calls.push({ at, channel, target, mine, message: `${address} ${spellFrequency(FREQUENCIES[target])}.` });
  }
  return { starts, calls, me };
}

// outcomes: one entry per call for the player, { hit, reactionMs } when tuned in time, { hit: false } when not;
// obeyedDecoys: calls for another aircraft that the player followed.
export function emptyStats() { return { outcomes: [], obeyedDecoys: 0 }; }

// A call tuned within 4 s is worth 1, then down to 0.4 at the end of the window; a missed call 0; each decoy
// followed costs DECOY_COST. No call measured yet scores 0.
export function moduleResult(spec, stats) {
  const outcomes = stats.outcomes.filter((outcome) => outcome && typeof outcome === "object");
  const scores = outcomes.map((outcome) => (outcome.hit ? Math.max(0.4, 1 - Math.max(0, (outcome.reactionMs ?? 0) - 4000) / 12000 * 0.6) : 0));
  const hits = outcomes.filter((outcome) => outcome.hit);
  const average = hits.length ? hits.reduce((sum, outcome) => sum + (outcome.reactionMs ?? 0), 0) / hits.length / 1000 : null;
  const mean = scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0;
  return {
    performance: Math.max(0, Math.min(1, mean - DECOY_COST * stats.obeyedDecoys)),
    detail: `${hits.length}/${outcomes.length} calls tuned${average !== null ? ` · ${average.toFixed(1)} s avg` : ""}${stats.obeyedDecoys ? ` · ${stats.obeyedDecoys} wrong callsign` : ""}`,
  };
}

// The flight nobody answered: every call for the player missed, no decoy followed.
export function idleStats(spec, plan) {
  return { outcomes: plan.calls.filter((call) => call.mine).map(() => ({ hit: false })), obeyedDecoys: 0 };
}
