import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SPACE_CADET } from "../../theme/spaceCadet";
import { triggerErrorHaptic, triggerSelectionHaptic, triggerSuccessHaptic } from "../../utils/haptics";
import { createRandom, randomTools } from "../../utils/random";
import { BlockKicker, ModuleBlock, SUCCESS, tint, useFeedbackFlash } from "../kit";

const CALLSIGNS = ["ALPHA", "BRAVO", "DELTA", "ECHO", "FOXTROT", "HOTEL", "KILO", "LIMA", "OSCAR", "SIERRA", "TANGO", "VICTOR"];
const MESSAGE_MS = 4500;
const QUERY_MS = 10000;
const QUERY_POINTS = [0.42, 0.72, 0.94];
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const spell = (code) => code.split("").map((digit) => DIGIT_WORDS[Number(digit)]).join(", ");

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
function buildScript(seed, durationMs) {
  const rnd = randomTools(createRandom(seed));
  const [me, ...others] = rnd.shuffle(CALLSIGNS);
  const events = [];
  let code = randomCode(rnd);
  const history = [code];
  events.push({ at: 1500, type: "message", to: me, code, mine: true });
  const queryTimes = QUERY_POINTS.map((point) => Math.round(point * durationMs));
  let lastDecoy = nearCode(rnd, code);
  for (let at = 9000; at < durationMs - 3000; at += rnd.int(8000, 13000)) {
    // Keep the strip free while a question is on screen (and don't let a message end right as it appears).
    if (queryTimes.some((time) => at > time - MESSAGE_MS && at < time + QUERY_MS)) continue;
    if (rnd.chance(0.3)) { code = randomCode(rnd); history.push(code); events.push({ at, type: "message", to: me, code, mine: true }); }
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

// `listen`: the audio variant, where messages are only heard (every one of them, mine or not), never shown.
export function CodesModule({ rects, runtime, color, listen = false }) {
  const script = useMemo(() => buildScript(runtime.seed, runtime.durationMs), [runtime.seed, runtime.durationMs]);
  const [message, setMessage] = useState(null);
  const [query, setQuery] = useState(null);
  const [answered, setAnswered] = useState(null);
  const cursor = useRef({ next: 0, messageUntil: 0, query: null, spoken: null });
  const outcomes = useRef([]);
  const feedback = useFeedbackFlash(color);
  const running = runtime.status === "running";

  useEffect(() => runtime.register(() => {
    const correct = outcomes.current.filter(Boolean).length;
    return { performance: outcomes.current.length ? correct / QUERY_POINTS.length : 0, detail: `${correct}/${QUERY_POINTS.length} codes recalled` };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) return undefined;
    const state = cursor.current;
    // Back from a pause: a message that was being read out is read again (the voice was cut).
    if (listen && state.spoken && state.messageUntil > runtime.elapsed()) { state.messageUntil = runtime.elapsed() + MESSAGE_MS; runtime.speak(state.spoken); }
    const timer = setInterval(() => {
      const now = runtime.elapsed();
      if (state.query && now - state.query.at > QUERY_MS) { outcomes.current.push(false); state.query = null; setQuery(null); feedback.flash(false); }
      if (state.messageUntil && now > state.messageUntil) { state.messageUntil = 0; setMessage(null); }
      if (state.query || state.next >= script.events.length || script.events[state.next].at > now) return;
      const event = script.events[state.next];
      state.next += 1;
      if (event.type === "query") {
        state.query = { ...event, at: now };
        setMessage(null); setAnswered(null); setQuery(event);
        void triggerSelectionHaptic();
      } else {
        state.messageUntil = now + MESSAGE_MS;
        setMessage(event);
        if (listen) { state.spoken = `${event.to.toLowerCase()}, ${event.mine && state.next === 1 ? "your code is" : "new code"}: ${spell(event.code)}.`; runtime.speak(state.spoken); }
      }
    }, 100);
    return () => clearInterval(timer);
  }, [running]); // eslint-disable-line react-hooks/exhaustive-deps

  function answer(option) {
    const state = cursor.current;
    if (!running || !state.query) return;
    const correct = option === state.query.answer;
    outcomes.current.push(correct);
    state.query = null;
    setAnswered({ option, correct });
    feedback.flash(correct);
    void (correct ? triggerSuccessHaptic() : triggerErrorHaptic());
    setTimeout(() => { setQuery(null); setAnswered(null); }, 900);
  }

  return <ModuleBlock rect={rects.strip} color={color} flash={feedback.style} style={styles.block}>
    {query ? <>
      <View style={styles.label}><BlockKicker color={color}>ENTER</BlockKicker><BlockKicker color={color}>YOUR CODE</BlockKicker></View>
      <View style={styles.options}>
        {query.options.map((option) => {
          const state = answered && (option === query.answer ? "right" : option === answered.option ? "wrong" : null);
          return <Pressable key={option} disabled={!running || Boolean(answered)} onPress={() => answer(option)} style={({ pressed }) => [styles.option, pressed && { backgroundColor: tint(color, 0.16) }, state === "right" && { borderColor: SUCCESS }, state === "wrong" && { borderColor: SPACE_CADET.attention }]}>
            <Text style={styles.optionText}>{option}</Text>
          </Pressable>;
        })}
      </View>
    </> : <>
      <View style={styles.label}>
        <BlockKicker color={color}>CODES</BlockKicker>
        <Text style={styles.identity}>YOU: {script.me}</Text>
      </View>
      {message && listen ? <Text style={[styles.idle, { color }]}>TRANSMISSION</Text> : message ? <View style={styles.message}>
        <Text style={[styles.to, message.to === script.me && { color }]}>TO {message.to}</Text>
        <Text style={styles.code}>{message.code}</Text>
      </View> : <Text style={styles.idle}>{running ? "LISTENING" : "—"}</Text>}
    </>}
  </ModuleBlock>;
}

const codesBase = {
  competence: "memory",
  task: "event",
  recap: "keep track of your access code",
  blocks: [{ key: "strip", role: "control", h: 1, w: 4, use: "rare" }],
};

export const codesVoiceModule = {
  ...codesBase,
  id: "codes-voice",
  title: "Radio codes",
  secondary: ["attention"],
  voice: true,
  load: 3,
  rule: "Codes are read out over the radio to several callsigns. Only remember the codes sent to you: each new one replaces the last. Nothing is written down. From time to time you will be asked for your current code.",
  Component: (props) => <CodesModule {...props} listen />,
};

export const codesModule = {
  id: "codes",
  title: "Access codes",
  competence: "memory",
  secondary: ["attention"],
  task: "event",
  voice: false,
  load: 2,
  rule: "Codes are sent to several callsigns. Only remember the codes sent to you: each new one replaces the last. From time to time you will be asked for your current code.",
  recap: "keep track of your access code",
  blocks: [{ key: "strip", role: "control", h: 1, w: 4, use: "rare" }],
  Component: CodesModule,
};

const styles = StyleSheet.create({
  block: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16 },
  label: { width: 78, gap: 5 },
  identity: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.2 },
  message: { flex: 1, flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingLeft: 8 },
  to: { color: SPACE_CADET.textSecondary, fontFamily: "Gontserrat-SemiBold", fontSize: 10, letterSpacing: 1.3 },
  code: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 26, letterSpacing: 3 },
  idle: { flex: 1, textAlign: "right", color: SPACE_CADET.textTertiary, fontFamily: "Gontserrat-SemiBold", fontSize: 9, letterSpacing: 1.6 },
  options: { flex: 1, flexDirection: "row", gap: 6 },
  option: { flex: 1, height: 40, borderRadius: 12, borderWidth: 1, borderColor: SPACE_CADET.borderDefault, alignItems: "center", justifyContent: "center" },
  optionText: { color: SPACE_CADET.white, fontFamily: "Garet-Book", fontSize: 14, letterSpacing: 1 },
});
